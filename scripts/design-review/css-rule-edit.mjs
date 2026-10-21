// 按选择器定位规则块，删除/替换声明
import { readFileSync, writeFileSync } from "node:fs";

export function editRules(css, edits) {
  const lines = css.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let header = "";       // 当前规则的选择器文本
  let inBlock = false;
  let blockDepth = 0;
  for (const line of lines) {
    if (!inBlock) {
      const m = line.match(/^([^{}]+)\{\s*$/);
      if (m) {
        header = m[1].trim();
        inBlock = true;
        blockDepth = 1;
        out.push(line);
        continue;
      }
      out.push(line);
      continue;
    }
    // 块内
    if (line.trim() === "}") { inBlock = false; header = ""; out.push(line); continue; }
    if (line.includes("{")) blockDepth++;
    if (line.includes("}")) blockDepth--;
    let handled = false;
    for (const e of edits) {
      if (!header.includes(e.sel)) continue;
      const d = line.match(/^(\s*)([a-z-]+)\s*:\s*([^;]*);\s*$/);
      if (!d) continue;
      if (e.decl && d[2] !== e.decl) continue;
      if (e.value && !d[3].includes(e.value)) continue;
      if (e.replace) { out.push(`${d[1]}${d[2]}: ${e.replace};`); handled = true; }
      else { handled = true; }  // 删除
      break;
    }
    if (!handled) out.push(line);
  }
  return out.join("\n");
}
