/**
 * 同步引擎编排：排水 outbox → 追加本地日志 → 拉取远端日志 → LWW 合并 →
 * 整文件上传。触发点（启动 / resume / 手动 / 防抖 / 退出）由上层 SyncService 接线。
 *
 * 引擎不直接触文件系统与设置表：本地日志持久化经 SyncFileStore，
 * 状态持久化（HLC 快照、远端水位、最近同步结果）经持久化回调，
 * 单测用内存替身即可驱动完整双端流程。
 *
 * 失败纪律：任何传输错误只影响远端交互，不碰本地数据。
 * 排水失败则条目留在 outbox（本地数据库的权威载体），下次再排。
 */

import { nowIso } from "@/lib/dates";
import { buildLogHeader, parseHeaderLine, readLogIncremental, joinLogText, type LogReadState } from "./log";
import type { HlcClock } from "./hlc";
import { createSqliteMergeBackend, drainOutbox, type SqlClient } from "./outbox";
import { mergeEntries } from "./merge";
import { SYNC_SCHEMA_VERSION } from "./tables";
import type { SyncTransport } from "./transport";

/** 本设备日志文件的持久化（plugin-fs 实现挂应用数据目录；测试用内存）。 */
export interface SyncFileStore {
  readLocal(): Promise<string | null>;
  /** 追加若干数据行（不含 header；实现保证换行与原子性）。 */
  appendLocal(lines: string[]): Promise<void>;
  /** 整文件重写（header 升版重排用）。 */
  rewriteLocal(text: string): Promise<void>;
}

export interface SyncPersistHooks {
  persistClock(state: { p: number; l: number }): Promise<void>;
  persistRemoteState(file: string, state: LogReadState): Promise<void>;
  persistLastSync(summary: SyncSummary): Promise<void>;
  loadRemoteState(file: string): Promise<LogReadState | null>;
}

export interface SyncSummary {
  ok: boolean;
  pushed: number;
  pulled: number;
  errors: string[];
  finishedAt: string;
}

export type SyncTrigger = "startup" | "resume" | "manual" | "debounce" | "exit";

export interface SyncDeps {
  db: SqlClient;
  clock: HlcClock;
  /** 本设备日志文件名，如 "desktop.jsonl"。 */
  ownFileName: string;
  store: SyncFileStore;
  /** null = 未配置凭据/离线模式：只排水，不联网。 */
  transport: SyncTransport | null;
  hooks: SyncPersistHooks;
  trigger: SyncTrigger;
}

const encoder = new TextEncoder();

/**
 * 单轮同步。本地优先：先落日志再远端交互；上传是幂等的整文件覆盖，
 * 失败只报告，下次整文件重传。
 */
export async function runSync(deps: SyncDeps): Promise<SyncSummary> {
  const errors: string[] = [];
  let pushed = 0;
  let pulled = 0;

  // 1) 排水 outbox → 本地日志
  try {
    const drained = await drainOutbox(deps.db, (ts) => deps.clock.tick(ts));
    if (drained.lines.length > 0) {
      await deps.store.appendLocal(drained.lines);
      pushed = drained.lines.length;
    }
  } catch (err) {
    errors.push(`本地日志写入失败：${errText(err)}`);
  }

  // 2) 拉取远端日志并合并
  if (deps.transport) {
    try {
      const files = await deps.transport.list();
      for (const file of files) {
        if (file.name === deps.ownFileName || !file.name.endsWith(".jsonl")) continue;
        const bytes = await deps.transport.download(file.name);
        if (!bytes) continue;
        const text = new TextDecoder().decode(bytes);
        const remoteHeader = parseHeaderLine(text.split("\n", 1)[0] ?? "");
        if (remoteHeader && remoteHeader.schema_v > SYNC_SCHEMA_VERSION) {
          errors.push(`远端 ${file.name} 数据版本更高（v${remoteHeader.schema_v}），请先升级本端`);
          continue;
        }
        const prev = (await deps.hooks.loadRemoteState(file.name)) ?? {
          consumedLines: 0,
          header: null,
        };
        const inc = readLogIncremental(text, prev);
        if (inc.entries.length > 0) {
          const { backend, cleanupSeen } = createSqliteMergeBackend(deps.db);
          const outcome = await mergeEntries(inc.entries, backend);
          await cleanupSeen();
          pulled += outcome.applied;
          for (const entry of inc.entries) deps.clock.update(entry.hlc);
          if (outcome.failed > 0) {
            errors.push(
              `合并 ${file.name}：${outcome.failed} 条失败（${outcome.failures[0] ?? ""}）`,
            );
          }
        }
        await deps.hooks.persistRemoteState(file.name, inc.next);
      }
    } catch (err) {
      errors.push(`拉取失败：${errText(err)}`);
    }

    // 3) 整文件上传自己的日志（header + 全部条目）
    try {
      let local = (await deps.store.readLocal()) ?? "";
      const firstLine = local.split("\n", 1)[0] ?? "";
      const ownHeader = parseHeaderLine(firstLine);
      if (!ownHeader || ownHeader.schema_v < SYNC_SCHEMA_VERSION) {
        // 日志文件缺失/无 header，或 header 还是升版前的旧格式：补写新
        // header 重排并落回本地，数据行不丢。对端看到 header 变化会把
        // 水位清零重读（合并幂等）；旧版本对端则被 schema 闸门拒收并
        // 提示升级，避免其用旧列白名单消费新格式、静默丢掉新增字段
        // （如 projects.tag_id）。
        const entryLines = local.trim()
          ? local.replace(/\n+$/, "").split("\n").slice(ownHeader ? 1 : 0)
          : [];
        local = joinLogText(buildLogHeader(deps.clock.deviceId, nowIso()), entryLines);
        await deps.store.rewriteLocal(local);
      }
      await deps.transport.upload(deps.ownFileName, encoder.encode(local));
    } catch (err) {
      errors.push(`上传失败：${errText(err)}`);
    }
  }

  await deps.hooks.persistClock(deps.clock.snapshot());
  return {
    ok: errors.length === 0,
    pushed,
    pulled,
    errors,
    finishedAt: nowIso(),
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
