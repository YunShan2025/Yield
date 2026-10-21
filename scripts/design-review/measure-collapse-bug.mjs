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
await page.waitForTimeout(1600);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
await page.waitForTimeout(400);

// 折叠 → 检查「展开」按钮（▸）按下时是否下移
await page.locator(".nav-edge-collapse").click({ timeout: 3000 }).catch(()=>{});
await page.waitForTimeout(500);
const ex = page.locator(".nav-edge-expand");
const box = async () => { const b = await ex.boundingBox(); if(!b) return null; const t = await ex.evaluate(el=>getComputedStyle(el).transform); return { y: Math.round(b.y*10)/10, t }; };
console.log("展开钮 静止:", JSON.stringify(await box()));
const bb = await ex.boundingBox();
await page.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2);
await page.mouse.down();
await page.waitForTimeout(350);
console.log("展开钮 按住:", JSON.stringify(await box()));
await page.mouse.up();
await page.waitForTimeout(300);

// 图标条状态下同样验一遍（窄窗）
const ctx2 = await browser.newContext({viewport:{width:1240,height:720}});
const p2 = await ctx2.newPage();
await p2.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await p2.goto("http://localhost:4173",{waitUntil:"networkidle"}).catch(()=>{});
await p2.waitForTimeout(1600);
for(const l of ["跳过","暂不开启"]){const b=p2.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await p2.waitForTimeout(400);break;}}
await p2.evaluate(()=>document.getElementById("boot-splash")?.remove());
await p2.waitForTimeout(400);
const rb = p2.locator(".nav-edge-collapse");
const rbox = async () => { const b = await rb.boundingBox(); if(!b) return null; const t = await rb.evaluate(el=>getComputedStyle(el).transform); return { y: Math.round(b.y*10)/10, h: Math.round(b.height*10)/10, t }; };
console.log("图标条 折叠钮 静止:", JSON.stringify(await rbox()));
const rbb = await rb.boundingBox();
await p2.mouse.move(rbb.x+rbb.width/2, rbb.y+rbb.height/2);
await p2.mouse.down();
await p2.waitForTimeout(350);
console.log("图标条 折叠钮 按住:", JSON.stringify(await rbox()));
await p2.mouse.up();
await browser.close();
