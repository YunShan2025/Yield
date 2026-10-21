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
await page.addStyleTag({content:".toast{display:none!important}"});
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
const go = async (label) => { await page.evaluate((l)=>{const n=[...document.querySelectorAll(".nav-item-label")].find(x=>(x.textContent||"").trim()===l);if(n)(n.closest("button")||n).click();}, label); await page.waitForTimeout(800); };
await go("项目");
await page.evaluate(()=>{const b=document.querySelector(".expand-row-toggle");if(b)b.click();});
await page.waitForTimeout(600);
await page.screenshot({path:"docs/ui-baseline/project-inline.png"});
await go("标签");
await page.evaluate(()=>{const b=document.querySelector(".expand-row-toggle");if(b)b.click();});
await page.waitForTimeout(600);
await page.screenshot({path:"docs/ui-baseline/tags-inline.png"});
await go("周清单");
await page.evaluate(()=>{const b=document.querySelector(".expand-row-toggle");if(b)b.click();});
await page.waitForTimeout(600);
await page.screenshot({path:"docs/ui-baseline/weekly-inline.png"});
await browser.close();
console.log("ok");
