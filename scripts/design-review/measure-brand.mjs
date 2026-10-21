import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const browser=await chromium.launch({executablePath:findChrome()});
for (const [w,h,tag] of [[1240,720,"rail"],[1440,900,"expanded"]]) {
  const ctx=await browser.newContext({viewport:{width:w,height:h},deviceScaleFactor:3});
  const page=await ctx.newPage();
  await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
  await page.goto("http://localhost:4173",{waitUntil:"networkidle"}).catch(()=>{});
  await page.waitForTimeout(1600);
  for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
  await page.addStyleTag({content:".toast{display:none!important}"});
  await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
  await page.waitForTimeout(500);
  await page.screenshot({path:`docs/ui-baseline/brand-${tag}.png`, clip:{x:0,y:40,width:80,height:180}});
  const g=await page.evaluate(()=>{
    const m=document.querySelector(".brand-mark");const cs=getComputedStyle(m);const r=m.getBoundingClientRect();
    return {rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],bg:cs.backgroundImage.slice(0,90),bgs:cs.backgroundColor,radius:cs.borderRadius};
  });
  console.log(tag, JSON.stringify(g));
  await ctx.close();
}
await browser.close();
