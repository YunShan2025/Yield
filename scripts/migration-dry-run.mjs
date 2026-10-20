/**
 * 迁移演练：把 src-tauri/src/lib.rs 里尚未落库的 migration 跑在**真实数据库的副本**上。
 *
 * 用途：桌面端跑不起来、没法点着验收时，先证明"升级这一步"本身是安全的——
 * SQL 不报错、校验和对得上、数据不丢、列结构与前端预期一致。绝不碰原库。
 *
 * 它会复刻 sqlx 的两件事：
 * 1. 校验和比对：已应用的 migration 若与 lib.rs 里的 SQL 不一致，sqlx 会在
 *    启动时直接失败（"migration N was previously applied but has been modified"），
 *    应用根本起不来。这里提前报出来。
 * 2. 只跑未应用的 migration，且迁移 SQL 原样执行（含首行换行，校验和按原文算）。
 *
 * 用法：
 *   node scripts/migration-dry-run.mjs                # 用默认的本机数据库副本
 *   node scripts/migration-dry-run.mjs <db 路径>       # 指定数据库
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = new URL("../", import.meta.url);
const rustSource = readFileSync(new URL("src-tauri/src/lib.rs", repoRoot), "utf8").replace(
  /\r\n/g,
  "\n",
);

/**
 * 按 lib.rs::migrations() 的顺序抽出每条 migration。
 * 注意 sql 用原始字符串原文（含首行换行）——sqlx 的校验和就是它原文的 SHA-384。
 */
function extractMigrations() {
  const list = [];
  const re = /version:\s*(\d+),\s*description:\s*"([^"]+)",[\s\S]*?sql:\s*r#"([\s\S]*?)"#,/g;
  for (const match of rustSource.matchAll(re)) {
    list.push({
      version: Number(match[1]),
      description: match[2],
      sql: match[3],
      checksum: createHash("sha384").update(match[3]).digest(),
    });
  }
  return list.sort((a, b) => a.version - b.version);
}

const argDb = process.argv[2];
const sourceDb =
  argDb ??
  join(
    process.env.APPDATA ?? join(homedir(), ".config"),
    "com.yunshan.yield",
    "app.db",
  );

if (!existsSync(sourceDb)) {
  console.error(`找不到数据库：${sourceDb}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), "yield-migration-"));
const copy = join(workDir, "app.db");
copyFileSync(sourceDb, copy);
for (const suffix of ["-wal", "-shm"]) {
  if (existsSync(sourceDb + suffix)) copyFileSync(sourceDb + suffix, copy + suffix);
}
console.log(`源库：${sourceDb}`);
console.log(`副本：${copy}\n`);

const db = new DatabaseSync(copy);
const migrations = extractMigrations();
const appliedRows = db
  .prepare("SELECT version, checksum FROM _sqlx_migrations")
  .all();
const applied = new Map(appliedRows.map((row) => [Number(row.version), row.checksum]));

const countOf = (table) => {
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
  } catch {
    return null;
  }
};
const columnsOf = (table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);

const before = {};
for (const table of ["tasks", "habits", "habit_checks", "goals", "goal_entries", "projects", "tags"]) {
  before[table] = countOf(table);
}
console.log("迁移前行数：", JSON.stringify(before));

// ── 校验和比对（与 sqlx 的 validate_applied_migrations 同口径）────────────
let checksumBroken = false;
for (const migration of migrations) {
  const stored = applied.get(migration.version);
  if (!stored) continue;
  const storedBuf = Buffer.from(stored);
  const same =
    storedBuf.length === migration.checksum.length &&
    storedBuf.equals(migration.checksum);
  if (!same) {
    checksumBroken = true;
    console.error(
      `✗ v${migration.version}（${migration.description}）已应用，但 SQL 与 lib.rs 不一致。`,
    );
    console.error("  sqlx 启动时会因校验和不符直接失败，应用起不来。");
    console.error("  修法：把 lib.rs 里的这条 migration 还原成已应用的那一版，" +
      "把新增的语句拆成新的更高版本 migration。");
  }
}
if (checksumBroken) {
  rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
}
console.log("校验和：全部一致 ✓\n");

const pending = migrations.filter((m) => !applied.has(m.version));
if (!pending.length) {
  console.log("没有待应用的 migration，库已是最新。");
} else {
  for (const migration of pending) {
    console.log(`── 应用 migration v${migration.version} · ${migration.description} ──`);
    try {
      db.exec(migration.sql);
    } catch (error) {
      console.error(`✗ v${migration.version} 失败：${error.message}`);
      console.error("（副本已损坏，原库未受影响）");
      process.exit(1);
    }
    console.log(`✓ v${migration.version} 执行成功`);
  }
}

console.log("\n── 迁移后校验 ──");
console.log("完整性：", db.prepare("PRAGMA integrity_check").get().integrity_check);
const after = {};
for (const table of Object.keys(before)) {
  after[table] = countOf(table);
  if (before[table] !== null && after[table] !== null && before[table] !== after[table]) {
    console.log(`  ! ${table}: ${before[table]} → ${after[table]}`);
  }
}
console.log("迁移后行数：", JSON.stringify(after));

console.log("\n关键列：");
for (const [table, expect] of [
  ["habits", ["repeat_rule"]],
  ["tasks", ["repeat_rule", "generated_from_id"]],
  ["goals", ["weekly_target", "project_id"]],
]) {
  const cols = columnsOf(table);
  for (const col of expect) {
    console.log(`  ${table}.${col}: ${cols.includes(col) ? "仍在" : "已删除"}`);
  }
}

console.log(
  "\n目标类型分布：",
  JSON.stringify(db.prepare("SELECT goal_type, COUNT(*) AS c FROM goals GROUP BY goal_type").all()),
);
console.log(
  "带排期规则的习惯：",
  Number(db.prepare("SELECT COUNT(*) AS c FROM habits WHERE repeat_rule IS NOT NULL").get().c),
);
console.log(
  "残留的旧来源目标记录：",
  Number(
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM goal_entries WHERE source_type IN ('task','habit','focus')",
      )
      .get().c,
  ),
);

db.close();
rmSync(workDir, { recursive: true, force: true });
console.log("\n演练结束（原库未被修改，副本已清理）。");