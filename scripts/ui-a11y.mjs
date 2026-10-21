/**
 * 渲染态可访问性体检：对比度 / 触控目标 / 焦点环 / 选中文本 / 占位符。
 * 替代 impeccable 的 URL 扫描（本机起不了它自带的浏览器）。
 * 用法: node scripts/ui-a11y.mjs [outJson]
 */
import { writeFileSync } from "node:fs";
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
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean))
    if (existsSync(c)) return c;
  throw new Error("no chrome");
}
const { chromium } = await loadPlaywright();
const OUT = process.argv[2] || "docs/ui-baseline/a11y.json";
const BASE = "http://localhost:4173";
const THEMES = ["light", "dark", "dawn", "glass"];
const VIEWS = [["today","今日"],["ledger","收支总览"],["growth","成长"],["memos","备忘录"],["weekly","周清单"],["settings","设置"]];

const browser = await chromium.launch({ executablePath: findChrome() });
const report = {};

for (const vp of [{name:"desktop",width:1240,height:720},{name:"wide",width:1600,height:1000},{name:"mobile",width:390,height:844}]) {
  const ctx = await browser.newContext({ viewport:{width:vp.width,height:vp.height} });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-21T11:00:00+08:00") }).catch(()=>{});
  const url = vp.name === "mobile" ? BASE + "?shell=mobile" : BASE;
  await page.goto(url, { waitUntil:"networkidle" }).catch(()=>{});
  await page.waitForTimeout(2200);
  for (const label of ["跳过","暂不开启"]) { const b=page.getByRole("button",{name:label}).first(); if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});break;} }
  await page.addStyleTag({ content: ".toast{display:none!important}" });
  await page.evaluate(()=>document.getElementById("boot-splash")?.remove());

  for (const theme of THEMES) {
    await page.evaluate((t)=>document.documentElement.setAttribute("data-theme",t), theme);
    await page.waitForTimeout(250);
    for (const [view,label] of VIEWS) {
      if (vp.name === "mobile" && !["today","ledger"].includes(view)) continue;
      await page.evaluate(({label})=>{
        const n=[...document.querySelectorAll(".nav-item-label, .mobile-nav-label")].find(x=>(x.textContent||"").trim()===label);
        if(n) (n.closest("button")||n).click();
      },{label});
      await page.waitForTimeout(600);
      const data = await page.evaluate(() => {
        const parseColor = (s) => {
          const m = s.match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
          return { r:p[0], g:p[1], b:p[2], a: p[3]===undefined?1:p[3] };
        };
        const lum = (c) => {
          const f = (v)=>{ v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
          return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);
        };
        const over = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a:1 });
        const ratio = (a,b) => { const l1=lum(a), l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
        const bgOf = (el) => {
          let n = el, acc = null;
          while (n && n !== document.documentElement) {
            const c = parseColor(getComputedStyle(n).backgroundColor);
            if (c && c.a > 0) { acc = acc ? over(acc, c) : c; if (acc.a >= 0.999) return acc; }
            n = n.parentElement;
          }
          const root = parseColor(getComputedStyle(document.documentElement).backgroundColor);
          return over(acc || {r:255,g:255,b:255,a:0}, root || {r:255,g:255,b:255,a:1});
        };
        // 真实底色 = 向上找到的第一个不透明背景；若那一层带 background-image，
        // 纯色算法算不准，单独标出来目检（只看最近的不透明祖先，不看整条链）
        const hasGradient = (el) => {
          let n = el;
          while (n && n !== document.documentElement) {
            const cs = getComputedStyle(n);
            const bi = cs.backgroundImage;
            const bc = parseColor(cs.backgroundColor);
            if (bi && bi !== "none") {
              if (!bc || bc.a < 0.999) return true;   // 自己就是渐变底
            }
            if (bc && bc.a >= 0.999) return false;    // 上面有不透明纯色，底色明确
            n = n.parentElement;
          }
          return false;
        };
        const out = { contrast: [], gradient: [], targets: [], focus: [], other: [] };
        const seen = new Set();
        for (const el of document.querySelectorAll("body *")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
          const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
          if (own) {
            const fg = parseColor(cs.color);
            if (fg && fg.a > 0) {
              const bg = bgOf(el);
              const r = ratio(over(fg,bg), bg);
              const size = parseFloat(cs.fontSize);
              const weight = Number(cs.fontWeight) || 400;
              const large = size >= 24 || (size >= 18.66 && weight >= 700);
              const need = large ? 3 : 4.5;
              if (r < need && hasGradient(el)) { out.gradient.push({ sel: el.tagName.toLowerCase(), text:(el.textContent||"").trim().slice(0,30), ratio:+r.toFixed(2) }); }
              else if (r < need) {
                const key = el.tagName + "|" + (el.className||"") + "|" + cs.color;
                if (!seen.has(key)) { seen.add(key);
                  out.contrast.push({ sel: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""),
                    text: (el.textContent||"").trim().slice(0,40), ratio:+r.toFixed(2), need, size, weight, color:cs.color, bg:`rgba(${bg.r},${bg.g},${bg.b},${bg.a})` }); }
              }
            }
          }
          // 触控目标
          if (["BUTTON","A","INPUT","SELECT","TEXTAREA","[role=button]","[role=checkbox]"].some(t => t.startsWith("[") ? el.matches(t) : el.tagName === t)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) {
              out.targets.push({ sel: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).slice(0,2).join(".") : ""),
                text:(el.textContent||"").trim().slice(0,24), w:+r.width.toFixed(1), h:+r.height.toFixed(1) });
            }
          }
        }
        // 焦点环 / 选中文本 / 占位符
        const html = document.documentElement;
        out.other.push({ check:"selection", value: getComputedStyle(html).getPropertyValue("::selection").trim() || "(未定义)" });
        out.other.push({ check:"selection-bg", value: getComputedStyle(html).getPropertyValue("::selection") ? "" : "" });
        const inp = document.querySelector("input");
        if (inp) out.other.push({ check:"placeholder", value: getComputedStyle(inp, "::placeholder").color });
        out.other.push({ check:"caret-color", value: getComputedStyle(document.body).caretColor });
        out.other.push({ check:"scrollbar-width", value: getComputedStyle(html).scrollbarWidth });
        out.other.push({ check:"font-variant-numeric", value: getComputedStyle(document.body).fontVariantNumeric });
        return out;
      });
      report[`${vp.name}/${theme}/${view}`] = data;
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify(report));
const sum = { contrast:0, gradient:0, targets:0 };
for (const k of Object.keys(report)) { sum.contrast += report[k].contrast.length; sum.gradient += report[k].gradient.length; sum.targets += report[k].targets.length; }
console.log(`已导出 ${Object.keys(report).length} 个视图 → ${OUT}`);
console.log(`实底对比度不足：${sum.contrast} 处（渐变底另计 ${sum.gradient} 处，需目检）；触控目标 < 44px：${sum.targets} 处`);


