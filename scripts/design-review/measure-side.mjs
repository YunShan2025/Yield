import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const browser=await chromium.launch({executablePath:findChrome()});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await page.goto("http://localhost:4173",{waitUntil:"networkidle"}).catch(()=>{});
await page.waitForTimeout(1700);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
for (const w of [232, 200, 260]) {
  await page.evaluate((w)=>{document.documentElement.style.setProperty("--layout-side-w", w+"px");}, w);
  await page.waitForTimeout(300);
  const g=await page.evaluate(()=>{
    const cap=document.querySelector(".brand-caption");
    const r=cap.getBoundingClientRect();
    const lock=document.querySelector(".brand-lockup").getBoundingClientRect();
    return {sideW: getComputedStyle(document.documentElement).getPropertyValue("--layout-side-w"),
      capH: Math.round(r.height), capW: Math.round(r.width), lines: Math.round(r.height/14),
      lockW: Math.round(lock.width), overflow: cap.scrollWidth > cap.clientWidth+1};
  });
  console.log(w, JSON.stringify(g));
}
await page.screenshot({path:"docs/ui-baseline/side-200.png", clip:{x:0,y:40,width:230,height:110}});
await browser.close();
