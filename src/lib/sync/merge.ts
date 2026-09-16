/**
 * 合并引擎：按 (table, row_id) 整行 LWW，HLC 大者胜。
 *
 * - 删除是墓碑条目（op:"delete"），记录在 sync_state 后，旧 upsert 不能复活该行；
 *   更新的 upsert（HLC 更大）合法重建。
 * - 应用顺序按外键依赖序（SYNC_TABLES 顺序）：父表先落库，子表引用不悬空；
 *   个别行应用失败（如孤儿行）不中断整批，最后汇总报告。
 * - 引擎本身不触库：通过 MergeBackend 适配真实 SQLite 或内存实现（单测/集成测试）。
 */

import type { Hlc } from "./hlc";
import { compareHlc } from "./hlc";
import { SYNC_TABLES, SYNC_SCHEMA_VERSION, type SyncTableName } from "./tables";
import type { SyncLogEntry } from "./log";

export interface MergeBackend {
  /** 该键最后应用过的 HLC（本地写或远端合并，含墓碑）；无记录返回 null。 */
  getState(table: SyncTableName, rowId: string): Promise<Hlc | null>;
  /** 插入或整行覆盖（列白名单校验在真实后端做）。 */
  upsert(table: SyncTableName, rowId: string, data: Record<string, unknown>): Promise<void>;
  /** 物理删除行；行不存在时静默成功（墓碑仍记录）。 */
  remove(table: SyncTableName, rowId: string): Promise<void>;
  /** 记录/推进该键的已应用 HLC（含墓碑）。 */
  setState(table: SyncTableName, rowId: string, hlc: Hlc): Promise<void>;
}

export interface MergeOutcome {
  applied: number;
  skipped: number;
  failed: number;
  failures: string[];
}

/** 远端 schema 版本高于本地时整批拒绝合并。 */
export class SchemaGateError extends Error {
  readonly remoteSchemaV: number;
  constructor(remoteSchemaV: number) {
    super(`远端数据版本（v${remoteSchemaV}）高于本端，请先升级本端应用`);
    this.name = "SchemaGateError";
    this.remoteSchemaV = remoteSchemaV;
  }
}

export async function mergeEntries(
  entries: SyncLogEntry[],
  backend: MergeBackend,
): Promise<MergeOutcome> {
  // schema 闸门：任何条目声明了比本地更新的 schema 即拒绝整批。
  for (const entry of entries) {
    if (entry.schema_v > SYNC_SCHEMA_VERSION) {
      throw new SchemaGateError(entry.schema_v);
    }
  }

  // 外键依赖序分桶；桶内按 HLC 升序，新状态最后落库。
  const byTable = new Map<SyncTableName, SyncLogEntry[]>();
  for (const entry of entries) {
    if (entry.schema_v > SYNC_SCHEMA_VERSION) continue; // 保险，上方已整批拦截
    const bucket = byTable.get(entry.table);
    if (bucket) bucket.push(entry);
    else byTable.set(entry.table, [entry]);
  }

  const outcome: MergeOutcome = { applied: 0, skipped: 0, failed: 0, failures: [] };
  for (const table of SYNC_TABLES) {
    const bucket = byTable.get(table);
    if (!bucket) continue;
    bucket.sort((a, b) =>
      a.hlc.p !== b.hlc.p
        ? a.hlc.p - b.hlc.p
        : a.hlc.l !== b.hlc.l
          ? a.hlc.l - b.hlc.l
          : a.hlc.d < b.hlc.d
            ? -1
            : 1,
    );
    for (const entry of bucket) {
      try {
        const current = await backend.getState(table, entry.row_id);
        if (current && compareHlc(current, entry.hlc) >= 0) {
          outcome.skipped += 1;
          continue;
        }
        if (entry.op === "upsert" && entry.data) {
          await backend.upsert(table, entry.row_id, entry.data);
        } else if (entry.op === "delete") {
          await backend.remove(table, entry.row_id);
        } else {
          outcome.skipped += 1;
          continue;
        }
        await backend.setState(table, entry.row_id, entry.hlc);
        outcome.applied += 1;
      } catch (err) {
        outcome.failed += 1;
        if (outcome.failures.length < 10) {
          outcome.failures.push(
            `${table}/${entry.row_id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
  }
  return outcome;
}
