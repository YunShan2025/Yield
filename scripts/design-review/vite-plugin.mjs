/**
 * 设计评审用的 SQLite 桥（服务端）。
 *
 * 开 YOUQIU_DESIGN_REVIEW=1 启动 vite 时启用：
 *   - 把 @tauri-apps/plugin-sql 别名到浏览器侧的 shim
 *   - 在 dev server 上挂 /__design-review/sql，用 node:sqlite 执行真实 SQL
 *
 * 数据来自 prepare-db.mjs 拷出的 app.db 副本，绝不碰原库。
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REVIEW_DB = resolve(HERE, "..", "..", ".tmp-design-review", "app.db");
const SHIM = join(HERE, "sql-shim.mjs");

// tauri-plugin-sql 用 $1/$2 位置绑定；node:sqlite 只认 ?，按出现顺序翻译
const toPositional = (sql) => sql.replace(/\$(\d+)/g, "?");

export function designReview() {
  let db = null;
  const open = () => {
    if (!db) {
      if (!existsSync(REVIEW_DB)) {
        throw new Error(
          `[design-review] 缺少评审数据库：${REVIEW_DB}\n` +
          `先跑：node scripts/design-review/prepare-db.mjs`,
        );
      }
      db = new DatabaseSync(REVIEW_DB);
    }
    return db;
  };

  return {
    name: "youqiu-design-review",
    config() {
      return { resolve: { alias: { "@tauri-apps/plugin-sql": SHIM } } };
    },
    configureServer(server) {
      server.middlewares.use("/__design-review/sql", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end("method not allowed");
          return;
        }
        let raw = "";
        req.on("data", (chunk) => { raw += chunk; });
        req.on("end", () => {
          try {
            const { kind, sql, bindValues } = JSON.parse(raw || "{}");
            const database = open();
            const stmt = database.prepare(toPositional(sql));
            if (kind === "select") {
              const rows = stmt.all(...(bindValues ?? []));
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({ rows: rows.map((r) => ({ ...r })) }));
            } else {
              const info = stmt.run(...(bindValues ?? []));
              res.setHeader("content-type", "application/json");
              res.end(JSON.stringify({
                rowsAffected: Number(info.changes ?? 0),
                lastInsertId: Number(info.lastInsertRowid ?? 0),
              }));
            }
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error?.message ?? error));
          }
        });
      });
    },
  };
}
