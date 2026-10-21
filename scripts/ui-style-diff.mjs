// 计算样式比对：逐视图逐元素逐属性对比
// 用法: node scripts/ui-style-diff.mjs <before.json> <after.json>
import { readFileSync } from "node:fs";
const A = JSON.parse(readFileSync(process.argv[2], "utf8"));
const B = JSON.parse(readFileSync(process.argv[3], "utf8"));
let totalDiff = 0;
for (const key of Object.keys(A)) {
  if (!B[key]) { console.log(`${key}: after 缺失`); totalDiff++; continue; }
  const a = A[key].dump, b = B[key].dump;
  if (a.length !== b.length) console.log(`${key}: 元素数 ${a.length} → ${b.length}`);
  const n = Math.min(a.length, b.length);
  const changes = new Map();
  let viewDiff = 0;
  for (let i = 0; i < n; i++) {
    if (a[i][0] !== b[i][0]) { console.log(`${key}[${i}]: 选择器变化 ${a[i][0]} → ${b[i][0]}`); viewDiff++; continue; }
    for (const p of Object.keys(a[i][1])) {
      if (a[i][1][p] !== b[i][1][p]) {
        if (!changes.has(p)) changes.set(p, []);
        changes.get(p).push(`${a[i][0]} :: ${a[i][1][p]} → ${b[i][1][p]}`);
        viewDiff++;
      }
    }
  }
  if (viewDiff) {
    console.log(`\n${key}: ${viewDiff} 处差异`);
    for (const [p, list] of changes) {
      console.log(`  [${p}] x${list.length}`);
      for (const l of list.slice(0, 4)) console.log(`      ${l}`);
      if (list.length > 4) console.log(`      … 还有 ${list.length - 4} 处`);
    }
    totalDiff += viewDiff;
  }
}
console.log(`\n合计差异：${totalDiff}`);
process.exit(totalDiff ? 1 : 0);
