// CSS 孤儿类名扫描：styles 里定义了、但源码里找不到字样的类名候选。
// 用法: node scripts/ui-css-orphans.mjs
//
// 只出候选、不下结论：动态拼接的类（`p${priority}` / `is-${tone}` / `theme-preview-${t}` /
// `level-0..4`）认不出具体取值，脚本按“去掉尾部数字/段后词干带 ${”豁免并标注，剩余候选
// 要人工确认（含 e2e 选择器、字符串拼装、对外 HTML）后再删。删除后必跑：
// ui-shot 四主题 + 移动壳回归 + npm test + build —— 死代码删除的正确性是“零像素变化”，
// 截图对不上就是删错了，不是截图错了。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
function walk(dir, exts) {
  const out = [];
  if (!exists(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(extname(p))) out.push(p);
  }
  return out;
}
function exists(p) { try { statSync(p); return true; } catch { return false; } }

const cssFiles = walk(join(ROOT, "src", "styles"), [".css"]).sort();
// scripts/ 也算“引用面”：ui-shot 的默认 --steps、验收脚本的选择器都在真实点击它们。
const srcFiles = [
  ...walk(join(ROOT, "src"), [".tsx", ".ts", ".jsx", ".js", ".html"]),
  join(ROOT, "index.html"),
  ...walk(join(ROOT, "scripts"), [".mjs", ".js"]),
].filter(exists);
const srcText = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// CSS 类名 → 定义处（只在“选择器位置”取类名：上一个 {}/换行边界之后、下一个 { 之前）
const cssRefs = new Map();
for (const f of cssFiles) {
  const raw = readFileSync(f, "utf8");
  const noComment = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  let inSelector = true;
  const lines = noComment.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const braceIdx = line.search(/[{}]/);
    const chunk = inSelector ? (braceIdx === -1 ? line : line.slice(0, braceIdx)) : "";
    for (const m of chunk.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      const cls = m[1];
      if (!cssRefs.has(cls)) cssRefs.set(cls, new Set());
      cssRefs.get(cls).add(`${relative(ROOT, f)}:${i + 1}`);
    }
    for (const ch of line) {
      if (ch === "{") inSelector = false;
      else if (ch === "}") inSelector = true;
    }
  }
}

const dynamicExempt = [];
const orphans = [];
for (const [cls, refs] of [...cssRefs.entries()].sort()) {
  if (srcText.includes(cls)) continue;
  // 尾部数字段：level-0…4 / p1…4 / pr1…4 —— 词干在源码里带 ${ 拼接嫌疑则豁免
  const stem = cls.replace(/-?\d+$/, "");
  if (stem !== cls && (srcText.includes(`${stem}\${`) || srcText.includes(`${stem}-\${`))) {
    dynamicExempt.push([cls, stem]);
    continue;
  }
  // 任意前缀段拼 class（is-soon ← `is-${tone}`、glass ← `theme-preview-${t}`）：
  // 去掉尾段字母数字（保留连接符）后 + "${" 出现则豁免并标注
  const head = cls.replace(/[A-Za-z0-9]+$/, "");
  if (head && srcText.includes(`${head}\${`)) {
    dynamicExempt.push([cls, head]);
    continue;
  }
  orphans.push([cls, [...refs]]);
}

if (dynamicExempt.length) {
  console.log(`动态拼接豁免 ${dynamicExempt.length} 个（词干带 \${…}，取值需人工核对是否仍存在）:`);
  console.log(`  ${dynamicExempt.map(([c, s]) => `${c}←${s}$` ).join("  ")}`);
  console.log("");
}
for (const [cls, refs] of orphans) {
  console.log(`.${cls}`.padEnd(34), refs.slice(0, 6).join("  ") + (refs.size > 6 ? `  (+${refs.size - 6})` : ""));
}
console.log(`\n共 ${orphans.length} 个候选（CSS 类总数 ${cssRefs.size}）。删除前逐个 grep 全仓确认。`);
