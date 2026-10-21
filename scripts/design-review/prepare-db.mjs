/**
 * 从本机应用数据目录拷一份 app.db 到 .tmp-design-review/，供设计评审使用。
 * 用 VACUUM INTO 取一致快照，原库只读、不改。
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "..", ".tmp-design-review");
const OUT_DB = join(OUT_DIR, "app.db");

const srcDir = process.env.YOUQIU_APP_DATA_DIR
  || join(process.env.APPDATA || "", "com.yunshan.yield");
const srcDb = join(srcDir, "app.db");

if (!existsSync(srcDb)) {
  console.error(`找不到原库：${srcDb}`);
  console.error("可用 YOUQIU_APP_DATA_DIR 环境变量指定目录。");
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(OUT_DB)) rmSync(OUT_DB);

const src = new DatabaseSync(srcDb, { readOnly: true });
src.exec(`VACUUM INTO '${OUT_DB.replace(/'/g, "''")}'`);
src.close();

const db = new DatabaseSync(OUT_DB, { readOnly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(`评审库已就绪：${OUT_DB}`);
console.log(`表 ${tables.length} 张：` + tables.map((t) => t.name).join(", "));
for (const t of ["tasks", "ledger_transactions", "projects", "tags", "memos", "habits", "goals", "anniversaries", "settings"]) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get();
    console.log(`  ${t.padEnd(20)} ${row.c} 行`);
  } catch { /* 表不存在 */ }
}
db.close();

