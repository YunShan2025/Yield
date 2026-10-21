// 尺寸敏感度量测：同一视图在多组视口下的排布对比
// 用法: node scripts/design-review/measure-viewports.mjs [baseUrl]
import { writeFileSync, mkdirSync } from "node:fs";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_PATH, "playwright",
    "C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)) {
    try { return await import(/^[a-z]+:\/\//i.test(c) ? c : pathToFileURL(c).href); } catch {}
  }
  throw new Error("playwright not found");
}
function findChrome() {
  for (const c of [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)) {
    if (existsSync(c)) return c;
  }
  throw new Error("no chrome");
}
const { chromium } = await loadPlaywright();
const BASE = process.argv[2] || "http://localhost:4173";
const VIEW = process.argv[3] || "今日";
const SIZES = [
  { name: "1240x720", width: 1240, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1040", width: 1920, height: 1040 },
];
mkdirSync("docs/ui-baseline", { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome() });
const out = {};
for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height } });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-21T11:00:00+08:00") }).catch(() => {});
  await page.goto(BASE, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1800);
  for (const label of ["跳过", "暂不开启"]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); break; }
  }
  await page.addStyleTag({ content: ".toast{display:none!important}" });
  await page.evaluate(() => document.getElementById("boot-splash")?.remove());
  const ok = await page.evaluate((label) => {
    const n = [...document.querySelectorAll(".nav-item-label")].find(x => (x.textContent || "").trim() === label);
    if (!n) return false; (n.closest("button") || n).click(); return true;
  }, VIEW);
  await page.waitForTimeout(900);
  out[s.name] = await page.evaluate(() => {
    const px = (n) => Math.round(n);
    const box = (el) => { const r = el.getBoundingClientRect(); return { w: px(r.width), h: px(r.height), top: px(r.top), bottom: px(r.bottom) }; };
    const main = document.querySelector(".app-body > *:not(.nav-side)") || document.querySelector(".app-main") || document.querySelector(".app-body");
    const side = document.querySelector(".nav-side");
    // 首屏可见性：视口底部线
    const fold = window.innerHeight;
    const blocks = [...document.querySelectorAll(".view > *, .view-body > *, .app-main > *")].slice(0, 30).map(el => {
      const r = el.getBoundingClientRect();
      if (r.height < 1) return null;
      return { cls: (el.className || "").toString().split(" ").filter(Boolean).slice(0, 2).join("."),
               h: px(r.height), top: px(r.top), visibleInFold: r.top < fold ? px(Math.min(r.bottom, fold) - r.top) : 0 };
    }).filter(Boolean);
    // 主区内的直接子块（今日页的纵向堆叠）
    const stack = [...(main?.querySelectorAll(":scope > *") || [])].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { cls: (el.className || "").toString().split(" ").filter(Boolean).slice(0, 3).join("."),
               h: px(r.height), w: px(r.width), top: px(r.top),
               mt: cs.marginTop, mb: cs.marginBottom, pad: cs.padding };
    });
    const fs = {};
    for (const sel of ["h1", "h2", "h3", ".today-hero h3", ".timeline-dock-title h3", ".nav-side h1", ".view-title"]) {
      const el = document.querySelector(sel);
      if (el) fs[sel] = getComputedStyle(el).fontSize;
    }
    const sideW = side ? px(side.getBoundingClientRect().width) : 0;
    const mainBox = main ? box(main) : null;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      sideW, sidePct: px(sideW / window.innerWidth * 100),
      main: mainBox,
      mainW: mainBox ? mainBox.w : 0,
      mainPct: mainBox ? px(mainBox.w / window.innerWidth * 100) : 0,
      bodyScrollH: document.documentElement.scrollHeight,
      fs, stack, blocks,
    };
  });
  await page.screenshot({ path: `docs/ui-baseline/vp-${s.name}-${VIEW}.png` });
  await ctx.close();
}
writeFileSync("docs/ui-baseline/viewport-measure.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
