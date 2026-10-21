import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const browser=await chromium.launch({executablePath:findChrome()});
const ctx=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2});
const page=await ctx.newPage();
await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await page.goto("http://localhost:4173",{waitUntil:"networkidle"}).catch(()=>{});
await page.waitForTimeout(1700);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.addStyleTag({content:".toast{display:none!important}"});
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
await page.evaluate(()=>{const n=[...document.querySelectorAll(".nav-item-label")].find(x=>(x.textContent||"").trim()==="收支总览");if(n)(n.closest("button")||n).click();});
await page.waitForTimeout(900);
await page.screenshot({path:"docs/ui-baseline/ledger-icons.png", clip:{x:250,y:630,width:1150,height:260}});
// 打开记一笔抽屉看分类选择器
await page.getByRole("button",{name:"记一笔"}).first().click().catch(()=>{});
await page.waitForTimeout(800);
await page.screenshot({path:"docs/ui-baseline/ledger-drawer.png"});
await browser.close();
console.log("ok");
