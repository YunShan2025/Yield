// 阶段 2 视觉基线截图：四主题 × (桌面 1600 / 移动 390)
// 用法: node scripts/ui-snapshot.mjs <outDir> [baseUrl]
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
const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: findChrome(),
});
const problems = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });

  const url = vp.name === "mobile" ? BASE + (BASE.includes("?") ? "&" : "?") + "shell=mobile" : BASE;
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2000);

  // 关闭新手引导（浏览器预览无 Tauri DB，onboardingComplete 无法持久化）
  for (const label of ["跳过", "暂不开启"]) {
    const btn = page.getByRole("button", { name: label }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(400);
      break;
    }
  }
  // 浏览器预览下 Tauri IPC 报错会弹红色 toast，遮挡基线；定位并隐藏它
  // 浏览器预览下 Tauri IPC 报错会弹 .toast 红条，遮挡基线；统一隐藏
  await page.addStyleTag({ content: ".toast { display: none !important; }" });
  // 移除启动卡，避免遮挡基线
  await page.evaluate(() => document.getElementById("boot-splash")?.remove());
  await page.waitForTimeout(300);

  for (const theme of THEMES) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.setAttribute("data-theme-mode", t);
    }, theme);
    await page.waitForTimeout(500);
    const file = join(OUT, `${vp.name}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const empty = await page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0));
    problems.push(`${vp.name}/${theme}: root children=${empty}`);
  }
  if (errors.length) problems.push(`[${vp.name}] console errors: ${[...new Set(errors)].slice(0, 5).join(" | ")}`);
  await ctx.close();
}

await browser.close();
console.log(problems.join("\n"));
console.log("SNAPSHOT_DIR=" + OUT);










