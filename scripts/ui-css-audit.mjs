import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const STYLES = join(ROOT, "src", "styles");

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (extname(p) === ".css") out.push(p);
  }
  return out;
}

const files = walk(STYLES).sort();
const HEX = /(?<![0-9a-fA-F])#[0-9a-fA-F]{3,8}\b/g;
const RGB = /rgba?\([^)]*\)/g;
const IMP = /!\s*important/g;
const VAR = /var\(\s*(--[A-Za-z0-9-]+)/g;
const DEF = /(?<![-\w])(--[A-Za-z0-9-]+)\s*:/g;
const THEME_SEL = /:root\[data-theme="([^"]+)"\]|@media[^{]*\{\s*:root\[data-theme="system"\]/g;

const rows = [];
const defined = new Map();   // token -> Set(files)
const used = new Map();      // token -> count
const undefinedRefs = new Map(); // token -> [{file,line}]

// pass 1: collect every definition in the tree
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  for (const m of raw.matchAll(DEF)) {
    if (!defined.has(m[1])) defined.set(m[1], new Set());
    defined.get(m[1]).add(relative(ROOT, f));
  }
}
// pass 2: count usage; flag references with no definition anywhere
for (const f of files) {
  const raw = readFileSync(f, "utf8");
  const lines = raw.split(/\r?\n/);
  const rel = relative(ROOT, f);
  const hex = (raw.match(HEX) || []).length;
  const rgb = (raw.match(RGB) || []).length;
  const imp = (raw.match(IMP) || []).length;
  const vars = raw.match(VAR) || [];
  rows.push({ file: rel, lines: lines.length, hex, rgb, hard: hex + rgb, imp, vars: vars.length });
  for (const m of raw.matchAll(VAR)) {
    used.set(m[1], (used.get(m[1]) || 0) + 1);
    if (!defined.has(m[1])) {
      if (!undefinedRefs.has(m[1])) undefinedRefs.set(m[1], []);
      const line = raw.slice(0, m.index).split(/\r?\n/).length;
      undefinedRefs.get(m[1]).push({ file: rel, line });
    }
  }
}

const isTokenFile = (f) => f.endsWith("tokens.css");
const content = rows.filter((r) => !isTokenFile(r.file));
const tokenRow = rows.find((r) => isTokenFile(r.file));

// --- theme token sets ---
const tokenRaw = readFileSync(join(STYLES, "tokens.css"), "utf8");
function themeBlock(sel) {
  const i = tokenRaw.indexOf(sel);
  if (i < 0) return null;
  let depth = 0, start = tokenRaw.indexOf("{", i);
  for (let j = start; j < tokenRaw.length; j++) {
    if (tokenRaw[j] === "{") depth++;
    else if (tokenRaw[j] === "}") { depth--; if (depth === 0) return tokenRaw.slice(start + 1, j); }
  }
  return null;
}
const themeNames = ["dark", "dawn", "glass"];
const themeSets = {};
themeSets[":root"] = new Set([...tokenRaw.matchAll(DEF)].map((m) => m[1]));
for (const t of themeNames) {
  const b = themeBlock(`:root[data-theme="${t}"]`);
  themeSets[t] = new Set(b ? [...b.matchAll(DEF)].map((m) => m[1]) : []);
}
const sysBlock = tokenRaw.slice(tokenRaw.indexOf('@media (prefers-color-scheme: dark)'));
themeSets.system = new Set([...sysBlock.matchAll(DEF)].map((m) => m[1]));

const base = themeSets[":root"];
console.log("=".repeat(72));
console.log("UI CSS AUDIT  —", relative(ROOT, ROOT));
console.log("=".repeat(72));
console.log("\n## 1. 逐文件");
console.log("file".padEnd(46), "lines".padStart(6), "hex".padStart(5), "rgb".padStart(5), "hard".padStart(6), "!imp".padStart(6), "var".padStart(6));
for (const r of rows) {
  console.log(
    r.file.padEnd(46),
    String(r.lines).padStart(6),
    String(r.hex).padStart(5),
    String(r.rgb).padStart(5),
    String(r.hard).padStart(6),
    String(r.imp).padStart(6),
    String(r.vars).padStart(6)
  );
}
const sum = (a, k) => a.reduce((s, r) => s + r[k], 0);
console.log("-".repeat(72));
console.log("TOTAL (incl tokens.css)".padEnd(46), String(sum(rows, "lines")).padStart(6), String(sum(rows, "hex")).padStart(5), String(sum(rows, "rgb")).padStart(5), String(sum(rows, "hard")).padStart(6), String(sum(rows, "imp")).padStart(6), String(sum(rows, "vars")).padStart(6));
console.log("NON-TOKEN CONTENT".padEnd(46), String(sum(content, "lines")).padStart(6), String(sum(content, "hex")).padStart(5), String(sum(content, "rgb")).padStart(5), String(sum(content, "hard")).padStart(6), String(sum(content, "imp")).padStart(6), String(sum(content, "vars")).padStart(6));
console.log(`  token file only: ${tokenRow.file}  lines=${tokenRow.lines}  defs=${defined.size}`);

console.log("\n## 2. 验收目标 (阶段 2 §5.3)");
const targets = [
  ["非 token 文件硬编码色值", sum(content, "hard"), 0],
  ["!important", sum(content, "imp"), 0],
  ["global-*/polish-* 残留文件", rows.filter((r) => /global-|polish-/.test(r.file)).length, 0],
];
for (const [name, cur, want] of targets) {
  const ok = cur === want;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(30)} current=${String(cur).padStart(4)}  target=${want}`);
}

console.log("\n## 3. 未定义 token 引用 (var() 无 fallback → 声明失效)");
if (undefinedRefs.size === 0) console.log("  (none)");
for (const [tok, refs] of [...undefinedRefs].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${tok}  x${refs.length}`);
  for (const r of refs) console.log(`      ${r.file}:${r.line}`);
}

console.log("\n## 4. 四主题 token 集对齐");
const allThemes = [":root", ...themeNames, "system"];
const anyTheme = new Set();
for (const t of allThemes) for (const tk of themeSets[t]) anyTheme.add(tk);
for (const t of allThemes) {
  const s = themeSets[t];
  const missing = [...base].filter((x) => !s.has(x));
  const extra = [...s].filter((x) => !base.has(x));
  console.log(`  ${t.padEnd(10)} count=${String(s.size).padStart(3)}  missing_vs_root=${missing.length}${missing.length ? " [" + missing.join(", ") + "]" : ""}${extra.length ? "  extra=[" + extra.join(", ") + "]" : ""}`);
}
const neverInAny = [...used.keys()].filter((tk) => !anyTheme.has(tk));
console.log(`  跨主题缺失(任一主题未定义)的被引用 token: ${neverInAny.length ? neverInAny.join(", ") : "(none)"}`);

console.log("\n## 5. 未被任何 CSS 引用的已定义 token");
const unused = [...defined.keys()].filter((tk) => !used.has(tk));
console.log(unused.length ? "  " + unused.join(", ") : "  (none)");

console.log("\n## 6. 全部被引用 token 使用频次");
for (const [tk, n] of [...used].sort((a, b) => b[1] - a[1])) {
  const status = anyTheme.has(tk) ? "" : "  <-- UNDEFINED";
  console.log(`  ${String(n).padStart(5)}  ${tk}${status}`);
}


