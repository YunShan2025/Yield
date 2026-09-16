/**
 * JSONL 同步日志：格式、序列化、解析与按水位增量读取。
 *
 * 文件首行是 header（含设备 id 与生成时间），用于识别「远端重新生成过文件」——
 * header 变化或行数变少都会把水位重置为 0，靠合并引擎的幂等性重新全量合并。
 * 每台设备只写自己的文件，上传是整文件覆盖，因此远端文件只会追加、不会改写。
 */

import { parseHlc, type Hlc } from "./hlc";
import { isSyncTable, SYNC_SCHEMA_VERSION, type SyncTableName } from "./tables";

export type SyncOp = "upsert" | "delete";

export interface SyncLogEntry {
  hlc: Hlc;
  /** 写日志时的 schema 版本；对端版本更高时合并闸门拒绝合并。 */
  schema_v: number;
  op: SyncOp;
  table: SyncTableName;
  row_id: string;
  /** upsert 必带全行字段；delete 无。 */
  data?: Record<string, unknown>;
}

export const LOG_FORMAT_VERSION = 1;

export interface LogHeader {
  kind: "header";
  format_v: number;
  device: string;
  created_at: string;
  schema_v: number;
}

/** 日志文件首行：标识设备与格式版本。 */
export function buildLogHeader(deviceId: string, nowIso: string): string {
  const header: LogHeader = {
    kind: "header",
    format_v: LOG_FORMAT_VERSION,
    device: deviceId,
    created_at: nowIso,
    schema_v: SYNC_SCHEMA_VERSION,
  };
  return JSON.stringify(header);
}

export function parseHeaderLine(line: string | undefined): LogHeader | null {
  if (!line) return null;
  try {
    const v = JSON.parse(line) as Partial<LogHeader>;
    if (v.kind !== "header") return null;
    if (typeof v.device !== "string" || !v.device) return null;
    if (typeof v.created_at !== "string") return null;
    if (typeof v.schema_v !== "number") return null;
    return {
      kind: "header",
      format_v: typeof v.format_v === "number" ? v.format_v : 1,
      device: v.device,
      created_at: v.created_at,
      schema_v: v.schema_v,
    };
  } catch {
    return null;
  }
}

export function serializeEntry(entry: SyncLogEntry): string {
  return JSON.stringify(entry);
}

/** 单行 → 日志条目；结构不合法返回 null（坏行跳过，不拖垮整个文件）。 */
export function parseEntryLine(line: string): SyncLogEntry | null {
  if (!line || line.startsWith("{") === false) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  const hlc = parseHlc(v.hlc);
  if (!hlc) return null;
  if (v.schema_v !== SYNC_SCHEMA_VERSION) return null;
  if (v.op !== "upsert" && v.op !== "delete") return null;
  if (typeof v.table !== "string" || !isSyncTable(v.table)) return null;
  if (typeof v.row_id !== "string" || !v.row_id) return null;
  const entry: SyncLogEntry = {
    hlc,
    schema_v: SYNC_SCHEMA_VERSION,
    op: v.op,
    table: v.table,
    row_id: v.row_id,
  };
  if (v.op === "upsert") {
    if (!v.data || typeof v.data !== "object") return null;
    entry.data = v.data as Record<string, unknown>;
  }
  return entry;
}

/** 多行日志文本 → 全部条目与坏行计数（合并入口/测试用）。 */
export function parseLogText(text: string): {
  header: LogHeader | null;
  entries: SyncLogEntry[];
  corrupt: number;
} {
  let header: LogHeader | null = null;
  const entries: SyncLogEntry[] = [];
  let corrupt = 0;
  let first = true;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line.trim()) continue;
    if (first) {
      first = false;
      header = parseHeaderLine(line);
      if (header) continue;
      // 无 header 的行按数据行处理（header 缺失不致命）
    }
    const entry = parseEntryLine(line);
    if (entry) entries.push(entry);
    else corrupt += 1;
  }
  return { header, entries, corrupt };
}

export type LogReadState = {
  /** 已完整消费的行数（不含 header 行）。 */
  consumedLines: number;
  /** 远端文件的 header 行，用于识别重新生成。 */
  header: string | null;
};

export type LogIncrement = {
  entries: SyncLogEntry[];
  next: LogReadState;
  /** 因 header 变化或行数回退而从头重读。 */
  reset: boolean;
  corrupt: number;
};

/**
 * 按水位增量读取远端日志。
 * 同一远端文件只会追加新行，因此行数水位即可定位新条目；
 * header 变化或行数少于水位说明对端重建了文件，整档重读（合并幂等，安全）。
 */
export function readLogIncremental(text: string, prev: LogReadState): LogIncrement {
  const lines: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim()) lines.push(line);
  }
  const remoteHeader = parseHeaderLine(lines[0]);
  const headerLine = remoteHeader ? lines[0] : null;
  const start = headerLine ? 1 : 0;
  const headerChanged =
    headerLine !== null && prev.header !== null && prev.header !== headerLine;
  const reset =
    headerChanged ||
    (headerLine !== null && prev.header === null) ||
    lines.length - start < prev.consumedLines;
  // 正常增量：跳过已消费的数据行；重置（对端重建文件）：从头消费，合并幂等。
  const from = reset ? start : Math.min(start + prev.consumedLines, lines.length);
  const entries: SyncLogEntry[] = [];
  let corrupt = 0;
  for (let i = from; i < lines.length; i++) {
    const entry = parseEntryLine(lines[i]);
    if (entry) entries.push(entry);
    else corrupt += 1;
  }
  return {
    entries,
    reset,
    corrupt,
    next: {
      consumedLines: Math.max(0, lines.length - start),
      header: headerLine,
    },
  };
}

/** 组装上传用日志文本：header + 数据行，\n 结尾。 */
export function joinLogText(headerLine: string, entryLines: string[]): string {
  if (entryLines.length === 0) return `${headerLine}\n`;
  return `${headerLine}\n${entryLines.join("\n")}\n`;
}
