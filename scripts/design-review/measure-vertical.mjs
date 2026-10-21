import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const BASE=process.argv[2]||"http://localhost:4173";
const browser=await chromium.launch({executablePath:findChrome()});
for(const s of [{n:"1240x720",w:1240,h:720},{n:"1920x1040",w:1920,h:1040}]){
  const ctx=await browser.newContext({viewport:{width:s.w,height:s.h}});
  const page=await ctx.newPage();
  await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
  await page.goto(BASE,{waitUntil:"networkidle"}).catch(()=>{});
  await page.waitForTimeout(1600);
  for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
  await page.addStyleTag({content:".toast{display:none!important}"});
  await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
  await page.evaluate(()=>{const n=[...document.querySelectorAll(".nav-item-label")].find(x=>(x.textContent||"").trim()==="今日");if(n)(n.closest("button")||n).click();});
  await page.waitForTimeout(900);
  const r=await page.evaluate(()=>{
    const px=n=>Math.round(n);
    const scope=document.querySelector(".scope-board");
    const kids=[...scope.children].map(el=>{const r=el.getBoundingClientRect();const cs=getComputedStyle(el);
      return {cls:(el.className||"").toString().split(" ").filter(Boolean).slice(0,2).join("."),
        h:px(r.height),top:px(r.top),mt:cs.marginTop,mb:cs.marginBottom,pad:cs.padding,flex:cs.flex};});
    // 今日页内所有块级标题的 top
    const heads=[...document.querySelectorAll(".scope-board h2,.scope-board h3,.scope-board .today-goal-rows,.scope-board .timeline-dock")].map(el=>{const r=el.getBoundingClientRect();return{cls:(el.className||"").toString().split(" ").filter(Boolean).slice(0,2).join("."),txt:(el.textContent||"").trim().slice(0,10),top:px(r.top),h:px(r.height)};});
    return {fold:window.innerHeight,kids,heads};
  });
  console.log("=== "+s.n+" ===");
  console.log("scope-board 直接子块:");
  r.kids.forEach(k=>console.log(`   ${k.cls.padEnd(24)} h=${String(k.h).padStart(4)} top=${String(k.top).padStart(4)} mt=${k.mt} mb=${k.mb} pad=${k.pad}`));
  console.log("内部标题:");
  r.heads.forEach(h=>console.log(`   ${h.cls.padEnd(24)} ${h.txt.padEnd(10)} top=${String(h.top).padStart(4)} h=${h.h}  ${h.top<r.fold?"[折线内]":"[折线外]"}`));
  await ctx.close();
}
await browser.close();
