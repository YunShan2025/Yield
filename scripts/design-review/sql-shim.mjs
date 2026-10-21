/**
 * 设计评审用的 SQLite 桥（浏览器侧）。
 *
 * 只在 YOUQIU_DESIGN_REVIEW=1 时由 vite.config.ts 别名到 @tauri-apps/plugin-sql，
 * 让浏览器预览能读到真实数据；生产构建不经过这条路径。
 *
 * 与 tauri-plugin-sql 的差异：SQL 走 HTTP 到 dev server，由 node:sqlite 执行。
 * 占位符 $1/$2 会被翻译成 ?（tauri-plugin-sql 也是按出现顺序位置绑定）。
 */

const ENDPOINT = "/__design-review/sql";

async function query(kind, sql, bindValues) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, sql, bindValues: bindValues ?? [] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[design-review] ${kind} 失败：${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

export default class Database {
  constructor(path) {
    this.path = path;
  }

  static async load(path) {
    return new Database(path);
  }

  static get(path) {
    return new Database(path);
  }

  async select(sql, bindValues) {
    const out = await query("select", sql, bindValues);
    return out.rows;
  }

  async execute(sql, bindValues) {
    const out = await query("execute", sql, bindValues);
    return { rowsAffected: out.rowsAffected ?? 0, lastInsertId: out.lastInsertId ?? 0 };
  }

  async close() {
    return true;
  }
}

