import { describe, expect, it } from "vitest";
import { compareHlc, type Hlc } from "./hlc";
import {
  buildLogHeader,
  joinLogText,
  parseEntryLine,
  parseLogText,
  readLogIncremental,
  serializeEntry,
  type LogReadState,
  type SyncLogEntry,
} from "./log";

const h = (p: number, l: number, d = "a"): Hlc => ({ p, l, d });

function upsert(table: SyncLogEntry["table"], rowId: string, data: Record<string, unknown>, clock: Hlc): SyncLogEntry {
  return { hlc: clock, schema_v: 2, op: "upsert", table, row_id: rowId, data };
}

const del = (table: SyncLogEntry["table"], rowId: string, clock: Hlc): SyncLogEntry => ({
  hlc: clock,
  schema_v: 2,
  op: "delete",
  table,
  row_id: rowId,
});

describe("条目序列化与解析", () => {
  it("upsert 条目往返无损", () => {
    const entry = upsert("tasks", "t1", { id: "t1", title: "写作业" }, h(100, 0, "desktop"));
    const parsed = parseEntryLine(serializeEntry(entry));
    expect(parsed).toEqual(entry);
  });

  it("delete 条目不含 data 也能解析", () => {
    const parsed = parseEntryLine(serializeEntry(del("memos", "m1", h(200, 3, "android"))));
    expect(parsed?.op).toBe("delete");
    expect(parsed?.data).toBeUndefined();
  });

  it("拒绝非法条目", () => {
    expect(parseEntryLine("not json")).toBeNull();
    expect(parseEntryLine('{"op":"upsert"}')).toBeNull();
    // schema_v 不匹配 → 拒绝（版本闸门在传输侧另有整档判断，这里挡脏行）
    expect(
      parseEntryLine(JSON.stringify({ hlc: h(1, 0), schema_v: 3, op: "upsert", table: "tasks", row_id: "x", data: {} })),
    ).toBeNull();
    expect(
      parseEntryLine(JSON.stringify({ hlc: h(1, 0), schema_v: 2, op: "rename", table: "tasks", row_id: "x" })),
    ).toBeNull();
    expect(
      parseEntryLine(JSON.stringify({ hlc: h(1, 0), schema_v: 2, op: "upsert", table: "nope", row_id: "x", data: {} })),
    ).toBeNull();
    // upsert 缺 data
    expect(
      parseEntryLine(JSON.stringify({ hlc: h(1, 0), schema_v: 2, op: "upsert", table: "tasks", row_id: "x" })),
    ).toBeNull();
  });
});

describe("整档解析 parseLogText", () => {
  it("header + 数据行 + 坏行", () => {
    const header = buildLogHeader("desktop-01", "2026-09-16T00:00:00.000Z");
    const text = [
      header,
      serializeEntry(upsert("tasks", "t1", { id: "t1" }, h(1, 0))),
      "garbage line",
      serializeEntry(del("tags", "g1", h(2, 0))),
      "",
    ].join("\n");
    const { header: parsedHeader, entries, corrupt } = parseLogText(text);
    expect(parsedHeader?.device).toBe("desktop-01");
    expect(entries).toHaveLength(2);
    expect(corrupt).toBe(1);
  });

  it("容忍 CRLF 与空行", () => {
    const text = `${buildLogHeader("d", "x")}\r\n${serializeEntry(upsert("tasks", "t1", {}, h(1, 0)))}\r\n\r\n`;
    const { entries, corrupt } = parseLogText(text);
    expect(entries).toHaveLength(1);
    expect(corrupt).toBe(0);
  });
});

describe("按水位增量读取 readLogIncremental", () => {
  const header = buildLogHeader("android-01", "2026-09-16T00:00:00.000Z");
  const lines = [
    h(10, 0),
    h(20, 0),
    h(30, 0),
  ].map((clock, i) => serializeEntry(upsert("tasks", `t${i}`, { id: `t${i}` }, clock)));
  const fileText = joinLogText(header, lines);

  it("首次读取消费全部数据行", () => {
    const fresh: LogReadState = { consumedLines: 0, header: null };
    const r1 = readLogIncremental(fileText, fresh);
    expect(r1.entries).toHaveLength(3);
    expect(r1.reset).toBe(true);
    expect(r1.next.consumedLines).toBe(3);
    expect(r1.next.header).toBe(header);
  });

  it("同一文件重复读取不产生新条目", () => {
    const r1 = readLogIncremental(fileText, { consumedLines: 0, header: null });
    const r2 = readLogIncremental(fileText, r1.next);
    expect(r2.entries).toHaveLength(0);
    expect(r2.reset).toBe(false);
  });

  it("追加后只读出新行", () => {
    const r1 = readLogIncremental(fileText, { consumedLines: 0, header: null });
    const appended = joinLogText(header, [...lines, serializeEntry(upsert("tasks", "t9", { id: "t9" }, h(40, 0)))]);
    const r2 = readLogIncremental(appended, r1.next);
    expect(r2.entries).toHaveLength(1);
    expect(r2.entries[0].row_id).toBe("t9");
    expect(r2.next.consumedLines).toBe(4);
  });

  it("header 变化时整档重读", () => {
    const r1 = readLogIncremental(fileText, { consumedLines: 0, header: null });
    const newHeader = buildLogHeader("android-01", "2026-10-01T00:00:00.000Z");
    const rebuilt = joinLogText(newHeader, [serializeEntry(upsert("tasks", "x1", {}, h(99, 0)))]);
    const r2 = readLogIncremental(rebuilt, r1.next);
    expect(r2.reset).toBe(true);
    expect(r2.entries).toHaveLength(1);
    expect(r2.entries[0].row_id).toBe("x1");
  });

  it("行数回退（对端重建）时整档重读", () => {
    const r1 = readLogIncremental(fileText, { consumedLines: 0, header: null });
    expect(r1.next.consumedLines).toBe(3);
    const shrunk = joinLogText(header, [serializeEntry(upsert("tasks", "only", {}, h(50, 0)))]);
    const r2 = readLogIncremental(shrunk, r1.next);
    expect(r2.reset).toBe(true);
    expect(r2.entries).toHaveLength(1);
    expect(r2.next.consumedLines).toBe(1);
  });

  it("跳过坏行但推进水位", () => {
    const text = joinLogText(header, [
      serializeEntry(upsert("tasks", "t1", {}, h(10, 0))),
      "corrupt",
      serializeEntry(upsert("tasks", "t2", {}, h(11, 0))),
    ]);
    const r1 = readLogIncremental(text, { consumedLines: 0, header: null });
    expect(r1.entries).toHaveLength(2);
    expect(r1.corrupt).toBe(1);
    const r2 = readLogIncremental(text, r1.next);
    expect(r2.entries).toHaveLength(0);
  });
});

describe("joinLogText", () => {
  it("空日志只有 header 且以换行结尾", () => {
    const header = buildLogHeader("d", "x");
    expect(joinLogText(header, [])).toBe(`${header}\n`);
  });

  it("带数据行时以换行结尾，可再被完整解析", () => {
    const header = buildLogHeader("d", "x");
    const entryLines = [serializeEntry(upsert("tasks", "t1", {}, h(1, 0)))];
    const text = joinLogText(header, entryLines);
    expect(text.endsWith("\n")).toBe(true);
    const parsed = parseLogText(text);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.header?.device).toBe("d");
  });

  it("条目按 HLC 全序可排序", () => {
    const entries = [
      upsert("tasks", "t1", {}, h(100, 0, "b")),
      upsert("tasks", "t2", {}, h(100, 0, "a")),
      upsert("tasks", "t3", {}, h(99, 9, "a")),
    ];
    const sorted = [...entries].sort((x, y) => compareHlc(x.hlc, y.hlc));
    expect(sorted.map((e) => e.row_id)).toEqual(["t3", "t2", "t1"]);
  });
});
