// 阶段 2 视觉基线截图：四主题 × (桌面 1600 / 移动 390) × 多个视图
// 用法: node scripts/ui-snapshot.mjs <outDir> [baseUrl]
//
// 桌面端通过侧栏 .nav-item 切换视图；移动端走 ?shell=mobile 调试口 + 底部导航。
// 视口四档：desktop 1440×900 = 桌面端默认窗口（评审基线），
// narrow 1240×720 覆盖窄窗图标条态，wide 1920×1040 覆盖最大化，mobile 390×844 走移动壳。
// 时钟被固定，避免时间轴「此刻」标记随真实时间漂移。
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { existsSync } from "node:fs";
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

const { chromium } = await loadPlaywright();
const OUT = process.argv[2] || "docs/ui-baseline";
const BASE = process.argv[3] || "http://localhost:4173";
const THEMES = ["light", "dark", "dawn", "glass"];
const FIXED_TIME = new Date("2026-10-21T11:00:00+08:00");

// 侧栏视图 id -> 文案（桌面端覆盖到的样式文件最多）
const DESKTOP_VIEWS = [
  ["today", "今日"],
  ["inbox", "待办箱"],
  ["ledger", "收支总览"],
  ["growth", "成长"],
  ["memos", "备忘录"],
  ["weekly", "周清单"],
  ["settings", "设置"],
];
// 移动端底部导航只有 4 项，其余走「更多」面板
const MOBILE_VIEWS = [
  ["today", "今日"],
  ["more", "更多"],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome() });
const log = [];

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "narrow", width: 1240, height: 720 }, { name: "wide", width: 1920, height: 1040 }, { name: "mobile", width: 390, height: 844 }]) {
  const views = vp.name === "mobile" ? MOBILE_VIEWS : DESKTOP_VIEWS;
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });

  await page.clock.install({ time: FIXED_TIME }).catch(() => {});
  const url = vp.name === "mobile" ? BASE + (BASE.includes("?") ? "&" : "?") + "shell=mobile" : BASE;
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2000);

  for (const label of ["跳过", "暂不开启"]) {
    const btn = page.getByRole("button", { name: label }).first();
    if (await btn.count().catch(() => 0)) { await btn.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(400); break; }
  }
  await page.addStyleTag({ content: ".toast { display: none !important; }" });
  await page.evaluate(() => document.getElementById("boot-splash")?.remove());
  await page.waitForTimeout(300);

  for (const theme of THEMES) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-theme-mode", t);
    }, theme);
    await page.waitForTimeout(300);

    for (const [view, label] of views) {
      // 切视图：用「标签 span」匹配（nav 项自带计数徽标，整块 textContent 不等于标签）
      const ok = await page.evaluate(({ label }) => {
        const nodes = [...document.querySelectorAll(".nav-item-label, .mobile-nav-label")];
        const hit = nodes.find((n) => (n.textContent || "").trim() === label);
        if (!hit) return false;
        (hit.closest("button") || hit).click();
        return true;
      }, { label });
      await page.waitForTimeout(700);
      // 校验：目标导航项应处于 active 态，否则说明没切过去
      const active = await page.evaluate(({ label }) => {
        const nodes = [...document.querySelectorAll(".nav-item-label, .mobile-nav-label")];
        const hit = nodes.find((n) => (n.textContent || "").trim() === label);
        if (!hit) return false;
        const btn = hit.closest(".nav-item, .mobile-nav-item");
        return !!btn && /active|is-active|current/.test(btn.className);
      }, { label });
      await page.screenshot({ path: join(OUT, `${vp.name}-${theme}-${view}.png`) });
      if (!ok || !active) log.push(`WARN ${vp.name}/${theme}/${view}: click=${ok} active=${active}  ← 视图可能未切换`);
    }
  }
  if (errors.length) log.push(`[${vp.name}] console: ${[...new Set(errors)].slice(0, 4).join(" | ")}`);
  await ctx.close();
}

await browser.close();
console.log(log.join("\n"));
console.log("SNAPSHOT_DIR=" + OUT);

