import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const BASE=process.argv[2]||"http://localhost:4173";
const browser=await chromium.launch({executablePath:findChrome()});
const ctx=await browser.newContext({viewport:{width:1240,height:720},deviceScaleFactor:2});
const page=await ctx.newPage();
await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await page.goto(BASE,{waitUntil:"networkidle"}).catch(()=>{});
await page.waitForTimeout(1800);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.addStyleTag({content:".toast{display:none!important}"});
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
await page.waitForTimeout(500);
await page.screenshot({path:"docs/ui-baseline/rail-1240.png", clip:{x:0,y:40,width:90,height:680}});
// 顺带量一下图标条内部各元素的几何
const geo=await page.evaluate(()=>{
  const px=n=>Math.round(n*10)/10;
  const items=[...document.querySelectorAll(".nav-item")].map(el=>{const r=el.getBoundingClientRect();const ic=el.querySelector(".nav-item-icon")?.getBoundingClientRect();const c=el.querySelector(".nav-count")?.getBoundingClientRect();
    return {t:(el.querySelector(".nav-item-text")?.textContent||""),item:[px(r.x),px(r.width),px(r.height)],icon:ic?[px(ic.x),px(ic.width)]:null,count:c?[px(c.x),px(c.width),px(c.height)]:null};});
  const side=document.querySelector(".nav-side").getBoundingClientRect();
  const scroll=document.querySelector(".nav-side-scroll");
  return {side:[px(side.x),px(side.width)],scrollH:px(scroll.scrollHeight),clientH:px(scroll.clientHeight),items};
});
console.log(JSON.stringify(geo,null,1));
await browser.close();
