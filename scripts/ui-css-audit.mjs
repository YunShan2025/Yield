// 阶段 2 · 桌面端 CSS 验收审计
// 用法: node scripts/ui-css-audit.mjs
//
// 输出：
//   1. 逐文件硬编码色值 / !important / var() 统计
//   2. §5.3 验收目标的 PASS/FAIL
//   3. 真正会失效的 token 引用（无 fallback、也无内联定义）
//   4. 四主题 token 集对齐
//   5. 被引用但从未定义的 token（含 fallback / 内联定义标注）
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const STYLES = join(ROOT, "src", "styles");
const SRC = join(ROOT, "src");

function walk(dir, exts) {
  const out = [];
  if (!exists(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e === ".git") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (!exts || exts.includes(extname(p))) out.push(p);
  }
  return out;
}
function exists(p) { try { statSync(p); return true; } catch { return false; } }

const cssFiles = walk(STYLES, [".css"]).sort();
const codeFiles = walk(SRC, [".tsx", ".ts", ".jsx", ".js", ".html"]).sort();

const HEX = /(?<![0-9a-fA-F])#[0-9a-fA-F]{3,8}\b/g;
const RGB = /rgba?\([^)]*\)/g;
const IMP = /!\s*important/g;
// 捕获 token 与紧随其后的字符：`,` 表示 var(--x, fallback) 有回退值
const VAR = /var\(\s*(--[A-Za-z0-9-]+)\s*([,)])/g;
const DEF = /(?<![-\w])(--[A-Za-z0-9-]+)\s*:/g;

const defined = new Map();       // token -> Set(files)  CSS 内定义
const inlineDefined = new Map(); // token -> Set(files)  TSX 内联 style 定义
const used = new Map();          // token -> {count, refs:[{file,line,hasFallback}]}
const broken = new Map();        // token -> [{file,line}]

// ---- 1. CSS 内定义 ----
for (const f of cssFiles) {
  const raw = readFileSync(f, "utf8");
  for (const m of raw.matchAll(DEF)) {
    if (!defined.has(m[1])) defined.set(m[1], new Set());
    defined.get(m[1]).add(relative(ROOT, f));
  }
}
// ---- 2. TSX/HTML 内联 style 定义： "--x": value  或  "--x":  ----
for (const f of codeFiles) {
  const raw = readFileSync(f, "utf8");
  for (const m of raw.matchAll(/["'`](--[A-Za-z0-9-]+)["'`]\s*:/g)) {
    if (!inlineDefined.has(m[1])) inlineDefined.set(m[1], new Set());
    inlineDefined.get(m[1]).add(relative(ROOT, f));
  }
}
// ---- 3. 使用处 ----
const rows = [];
for (const f of cssFiles) {
  const raw = readFileSync(f, "utf8");
  const lines = raw.split(/\r?\n/);
  const rel = relative(ROOT, f);
  const hex = (raw.match(HEX) || []).length;
  const rgb = (raw.match(RGB) || []).length;
  const imp = (raw.match(IMP) || []).length;
  const vars = raw.match(VAR) || [];
  rows.push({ file: rel, lines: lines.length, hex, rgb, hard: hex + rgb, imp, vars: vars.length });
  for (const m of raw.matchAll(VAR)) {
    const tok = m[1], hasFallback = m[2] === ",";
    if (!used.has(tok)) used.set(tok, { count: 0, refs: [] });
    const u = used.get(tok);
    u.count++;
    const line = raw.slice(0, m.index).split(/\r?\n/).length;
    u.refs.push({ file: rel, line, hasFallback });
    if (!defined.has(tok) && !inlineDefined.has(tok) && !hasFallback) {
      if (!broken.has(tok)) broken.set(tok, []);
      broken.get(tok).push({ file: rel, line });
    }
  }
}

const isTokenFile = (f) => f.endsWith("tokens.css");
const content = rows.filter((r) => !isTokenFile(r.file));
const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);

const P = (s) => console.log(s);
P("=".repeat(74));
P("UI CSS AUDIT");
P("=".repeat(74));

P("\n## 1. 逐文件");
P("file".padEnd(46) + "lines".padStart(6) + "hex".padStart(5) + "rgb".padStart(5) + "hard".padStart(6) + "!imp".padStart(6) + "var".padStart(6));
for (const r of rows) {
  P(r.file.padEnd(46) + String(r.lines).padStart(6) + String(r.hex).padStart(5) + String(r.rgb).padStart(5) + String(r.hard).padStart(6) + String(r.imp).padStart(6) + String(r.vars).padStart(6));
}
P("-".repeat(74));
P("NON-TOKEN CONTENT".padEnd(46) + String(sum(content, "lines")).padStart(6) + String(sum(content, "hex")).padStart(5) + String(sum(content, "rgb")).padStart(5) + String(sum(content, "hard")).padStart(6) + String(sum(content, "imp")).padStart(6) + String(sum(content, "vars")).padStart(6));

P("\n## 2. 验收目标（阶段 2 §5.3）");
const targets = [
  ["非 token 文件硬编码色值", sum(content, "hard"), 0],
  ["!important", sum(content, "imp"), 0],
  ["global-*/polish-* 残留文件", rows.filter((r) => /global-|polish-/.test(r.file)).length, 0],
  ["失效的 token 引用（无 fallback 无定义）", broken.size, 0],
];
for (const [name, cur, want] of targets) {
  P(`  ${cur === want ? "PASS" : "FAIL"}  ${name.padEnd(36)} current=${String(cur).padStart(4)}  target=${want}`);
}

P("\n## 3. 失效的 token 引用（var 无 fallback，且 CSS/TSX 均未定义 → 整条声明失效）");
if (broken.size === 0) P("  (none)");
for (const [tok, refs] of [...broken].sort((a, b) => b[1].length - a[1].length)) {
  P(`  ${tok}  x${refs.length}`);
  for (const r of refs) P(`      ${r.file}:${r.line}`);
}

P("\n## 4. 被引用但「CSS 未定义」的 token（按来源分类）");
const unresolved = [...used.keys()].filter((t) => !defined.has(t)).sort();
for (const t of unresolved) {
  const u = used.get(t);
  const src = inlineDefined.has(t) ? `内联定义 [${[...inlineDefined.get(t)].join(", ")}]` : "仅靠 var() 回退值";
  P(`  ${t.padEnd(22)} x${String(u.count).padStart(3)}  ${src}`);
}

P("\n## 5. 四主题 token 集对齐");
const tokenRaw = readFileSync(join(STYLES, "tokens.css"), "utf8");
function region(startMark, endMark) {
  const a = tokenRaw.indexOf(startMark);
  const b = tokenRaw.indexOf(endMark);
  return a < 0 || b < 0 ? "" : tokenRaw.slice(a, b);
}
// 主题无关层：字体 / 间距 / 字号 / 圆角 / 动效 / 布局，四套主题共用
const independentRaw = region("/* @theme-independent:start */", "/* @theme-independent:end */");
const independent = new Set([...independentRaw.matchAll(DEF)].map((m) => m[1]));
// 别名层：过渡期旧名，不参与对齐判定
const aliasRaw = region("/* @legacy-alias:start */", "/* @legacy-alias:end */");
const alias = new Set([...aliasRaw.matchAll(DEF)].map((m) => m[1]));

function blockOf(sel) {
  const i = tokenRaw.indexOf(sel);
  if (i < 0) return null;
  let depth = 0;
  const start = tokenRaw.indexOf("{", i);
  for (let j = start; j < tokenRaw.length; j++) {
    if (tokenRaw[j] === "{") depth++;
    else if (tokenRaw[j] === "}") { depth--; if (depth === 0) return tokenRaw.slice(start + 1, j); }
  }
  return null;
}
const themeSets = {};
// 取某个选择器后面第一个 {...} 块（花括号配平）
function blockAfter(sel, from = 0) {
  const i = tokenRaw.indexOf(sel, from);
  if (i < 0) return null;
  let depth = 0;
  const start = tokenRaw.indexOf("{", i);
  for (let j = start; j < tokenRaw.length; j++) {
    if (tokenRaw[j] === "{") depth++;
    else if (tokenRaw[j] === "}") { depth--; if (depth === 0) return tokenRaw.slice(start + 1, j); }
  }
  return null;
}
// 清昼：语义层标题之后的第一个 :root 块（跳过主题无关层）
const lightStart = tokenRaw.indexOf("语义层 · 清昼");
themeSets[":root"] = new Set(
  [...(blockAfter(":root {", lightStart) || "").matchAll(DEF)].map((m) => m[1]).filter((t) => !independent.has(t))
);
for (const t of ["dark", "dawn", "glass"]) {
  const b = blockAfter(`:root[data-theme="${t}"]`);
  themeSets[t] = new Set(b ? [...b.matchAll(DEF)].map((m) => m[1]) : []);
}
const sysBlock = blockAfter(":root[data-theme=\"system\"]");
themeSets.system = new Set(sysBlock ? [...sysBlock.matchAll(DEF)].map((m) => m[1]) : []);
const base = themeSets[":root"];
let alignOk = true;
for (const t of [":root", "dark", "dawn", "glass", "system"]) {
  const set = themeSets[t];
  const missing = [...base].filter((x) => !set.has(x));
  const extra = [...set].filter((x) => !base.has(x));
  if (missing.length || extra.length) alignOk = false;
  P(`  ${t.padEnd(9)} count=${String(set.size).padStart(3)}  missing=${missing.length}${missing.length ? " [" + missing.join(", ") + "]" : ""}${extra.length ? "  extra=[" + extra.join(", ") + "]" : ""}`);
}
P(`  → 四主题 token 集${alignOk ? "完全对齐 ✅" : "未对齐 ❌"}`);
P(`  主题无关层 ${independent.size} 个（字体/间距/字号/圆角/动效/布局），别名层 ${alias.size} 个（过渡期）`);

P("\n## 6. 已定义但从未被引用");
const unused = [...defined.keys()].filter((t) => !used.has(t));
P(unused.length ? "  " + unused.join(", ") : "  (none)");
