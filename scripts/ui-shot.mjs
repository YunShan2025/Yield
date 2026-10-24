// 桌面 UI 高清定点截图：无损 PNG + 2× 像素比，字体细节可直接判读。
// 与 ui-snapshot.mjs 的分工：那边是四主题×四视口的回归基线（DPR1 全量），
// 这里是日常改完一眼看细节（DPR2、可选视图/主题/元素裁剪）。
//
// 用法: node scripts/ui-shot.mjs [outDir] [baseUrl] [--views=today,weekly] [--themes=light,dark,glass,dawn]
//        [--scale=2] [--vp=1440x900] [--selector=<css>] [--full]
// 示例（dev server 在 1420 时）:
//   node scripts/ui-shot.mjs                                        # 今日×四主题, 2×
//   node scripts/ui-shot.mjs .openchamber/shots http://localhost:1420 --views=today,growth --themes=light,dark
//   node scripts/ui-shot.mjs --selector=.today-hero --themes=light  # 只截顶卡
// baseUrl 默认 http://localhost:1420（YOUQIU_DESIGN_REVIEW=1 npm run dev）。
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    "playwright",
    "C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const url = /^[a-z]+:\/\//i.test(c) ? c : pathToFileURL(c).href;
      return await import(url);
    } catch {}
  }
  throw new Error("playwright not found; set PLAYWRIGHT_PATH");
}
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("no chrome/edge found; set CHROME_PATH");
}

const argv = process.argv.slice(2);
const flags = Object.fromEntries(
  argv.filter((a) => a.startsWith("--")).map((a) => { const [k, ...rest] = a.replace(/^--/, "").split("="); return [k, rest.join("=") || true]; })
);
const pos = argv.filter((a) => !a.startsWith("--"));
const OUT = pos[0] || ".openchamber/shots";
const BASE = pos[1] || "http://localhost:1420";
const SCALE = Number(flags.scale || 2);
const [VW, VH] = String(flags.vp || "1440x900").split("x").map(Number);
const FIXED_TIME = new Date("2026-10-21T11:00:00+08:00"); // 与 ui-snapshot 同步，避免「此刻」漂移

const VIEW_LABELS = {
  today: "今日", inbox: "待办箱", ledger: "收支总览", growth: "成长", review: "复盘",
  memos: "备忘录", weekly: "周清单", settings: "设置",
};
const views = String(flags.views || "today").split(",").map((v) => {
  const key = v.trim();
  return [key, VIEW_LABELS[key] ?? key]; // 未收录的 id 直接按侧栏文案点
});
const themes = String(flags.themes || "light,dark,glass,dawn").split(",").map((t) => t.trim());

const { chromium } = await loadPlaywright();
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome() });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: SCALE });
const page = await ctx.newPage();
await page.clock.install({ time: FIXED_TIME }).catch(() => {});
await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
await page.waitForTimeout(2000);

for (const label of ["跳过", "暂不开启"]) {
  const btn = page.getByRole("button", { name: label }).first();
  if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); break; }
}
await page.addStyleTag({ content: ".toast { display: none !important; }" });
await page.evaluate(() => document.getElementById("boot-splash")?.remove());
await page.waitForTimeout(300);

const files = [];
for (const theme of themes) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute("data-theme", t);
    document.documentElement.setAttribute("data-theme-mode", t);
  }, theme);
  await page.waitForTimeout(300);

  for (const [view, label] of views) {
    const ok = await page.evaluate(({ label }) => {
      const nodes = [...document.querySelectorAll(".nav-item-label, .mobile-nav-label")];
      const hit = nodes.find((n) => (n.textContent || "").trim() === label);
      if (!hit) return false;
      (hit.closest("button") || hit).click();
      return true;
    }, { label });
    await page.waitForTimeout(700);

    const tag = typeof flags.selector === "string" ? `-${flags.selector.replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "").slice(0, 24)}` : "";
    const file = join(OUT, `shot-${SCALE}x-${view}-${theme}${tag}.png`);
    if (typeof flags.selector === "string") {
      const el = page.locator(flags.selector).first();
      if (!(await el.count().catch(() => 0))) { console.log(`WARN ${view}/${theme}: selector 未命中 ${flags.selector}`); continue; }
      await el.screenshot({ path: file });
    } else {
      await page.screenshot({ path: file, fullPage: Boolean(flags.full) });
    }
    files.push(`${ok ? "" : "WARN(nav未命中) "}${file}`);
  }
}
await browser.close();
console.log(files.join("\n"));
console.log(`SHOT_DIR=${OUT} scale=${SCALE}x viewport=${VW}x${VH}`);
