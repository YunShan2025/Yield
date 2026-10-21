import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const browser=await chromium.launch({executablePath:findChrome()});
for(const [w,h,tag] of [[1440,900,"wide"],[1240,720,"narrow"]]){
  const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:3});
  const page=await ctx.newPage();
  await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
  await page.goto("http://localhost:4173",{waitUntil:"networkidle"}).catch(()=>{});
  await page.waitForTimeout(1600);
  for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
  await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
  await page.waitForTimeout(400);
  await page.screenshot({path:`docs/ui-baseline/side-${tag}.png`, clip:{x:0,y:40,width:240,height:120}});
  const g=await page.evaluate(()=>{
    const cap=document.querySelector(".brand-caption"); const h1=document.querySelector(".brand-row h1");
    const r=cap?.getBoundingClientRect();
    return {nav: document.documentElement.dataset.nav, caption: cap?{text:cap.textContent, w:Math.round(r.width), sw:cap.scrollWidth, clipped:cap.scrollWidth>cap.clientWidth+1}:null,
            h1: h1?{text:h1.textContent,w:Math.round(h1.getBoundingClientRect().width)}:null};
  });
  console.log(tag, JSON.stringify(g));
  await ctx.close();
}
await browser.close();
