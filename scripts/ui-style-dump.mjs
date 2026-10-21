// 计算样式快照：把每个可见元素的关键计算样式导出，用于前后逐项比对
// 用法: node scripts/ui-style-dump.mjs <outJson> [baseUrl]
import { mkdirSync, writeFileSync } from "node:fs";
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
const OUT = process.argv[2] || "docs/ui-baseline/styles.json";
const BASE = process.argv[3] || "http://localhost:4173";
const THEMES = ["light", "dark", "dawn", "glass"];
const VIEWS = [["today","今日"],["ledger","收支总览"],["growth","成长"],["memos","备忘录"],["weekly","周清单"],["settings","设置"]];

const PROPS = ["color","background-color","background-image","border-top-color","border-bottom-color","border-left-color",
  "border-top-width","border-radius","font-size","font-weight","line-height","font-family","letter-spacing",
  "margin-top","margin-right","margin-bottom","margin-left","padding-top","padding-right","padding-bottom","padding-left",
  "box-shadow","opacity","flex-direction","flex-basis","gap","width","height","display","position","z-index","text-align",
  "text-transform","white-space","overflow-x","overflow-y","scrollbar-width","filter","transform","transition-duration","animation-name"];

const browser = await chromium.launch({ executablePath: findChrome() });
const result = {};
for (const vp of [{name:"desktop",width:1240,height:720},{name:"wide",width:1600,height:1000},{name:"mobile",width:390,height:844}]) {
  const ctx = await browser.newContext({ viewport:{width:vp.width,height:vp.height} });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-21T11:00:00+08:00") }).catch(()=>{});
  const url = vp.name === "mobile" ? BASE + "?shell=mobile" : BASE;
  await page.goto(url, { waitUntil:"networkidle" }).catch(()=>{});
  await page.waitForTimeout(2000);
  for (const label of ["跳过","暂不开启"]) { const b=page.getByRole("button",{name:label}).first(); if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});break;} }
  await page.addStyleTag({ content: ".toast{display:none!important}" });
  await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
  for (const theme of THEMES) {
    await page.evaluate((t)=>document.documentElement.setAttribute("data-theme",t), theme);
    await page.waitForTimeout(250);
    for (const [view,label] of VIEWS) {
      if (vp.name === "mobile" && !["today","ledger"].includes(view)) continue;
      const ok = await page.evaluate(({label})=>{
        const n=[...document.querySelectorAll(".nav-item-label, .mobile-nav-label")].find(x=>(x.textContent||"").trim()===label);
        if(!n) return false; (n.closest("button")||n).click(); return true;
      },{label});
      await page.waitForTimeout(600);
      const dump = await page.evaluate((props)=>{
        const out=[];
        const walk=(el)=>{
          const cs=getComputedStyle(el);
          if(cs.display!=="none"){
            const o={};
            for(const p of props) o[p]=cs.getPropertyValue(p);
            out.push([el.tagName+"#"+(el.id||"")+"."+(typeof el.className==="string"?el.className:""), o]);
          }
          for(const c of el.children) walk(c);
        };
        walk(document.body);
        return out;
      }, PROPS);
      result[`${vp.name}/${theme}/${view}`] = { ok, dump };
    }
  }
  await ctx.close();
}
await browser.close();
mkdirSync(OUT.replace(/\/[^/]+$/,""), { recursive:true });
writeFileSync(OUT, JSON.stringify(result));
console.log(`已导出 ${Object.keys(result).length} 个视图的计算样式 → ${OUT}`);
