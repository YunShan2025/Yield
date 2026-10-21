import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const BASE="http://localhost:4173";
const VIEWS = JSON.parse(process.argv[2]);
const W = Number(process.argv[3]||1440), H = Number(process.argv[4]||900);
const browser=await chromium.launch({executablePath:findChrome()});
const ctx=await browser.newContext({viewport:{width:W,height:H}});
const page=await ctx.newPage();
await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await page.goto(BASE,{waitUntil:"networkidle"}).catch(()=>{});
await page.waitForTimeout(1800);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.addStyleTag({content:".toast{display:none!important}"});
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
for(const th of ["light","dark","dawn","glass"]){
  await page.evaluate(t=>document.documentElement.setAttribute("data-theme",t), th);
  for(const [id,label] of VIEWS){
    const ok = await page.evaluate((label)=>{const n=[...document.querySelectorAll(".nav-item-label")].find(x=>(x.textContent||"").trim()===label); if(!n) return false; (n.closest("button")||n).click(); return true;}, label);
    await page.waitForTimeout(700);
    const active = await page.evaluate((id)=>document.querySelector(`.nav-item.active .nav-item-text`)?.textContent?.trim(), id);
    await page.screenshot({path:`docs/ui-baseline/view-${id}-${th}.png`, fullPage:false});
    if(!ok) console.log("WARN 未找到", label);
  }
}
await browser.close();
console.log("done");
