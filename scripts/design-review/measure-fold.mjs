// 折线/时间轴细节量测
import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe","C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const BASE = process.argv[2] || "http://localhost:4173";
const SIZES=[{name:"1240x720",width:1240,height:720},{name:"1440x900",width:1440,height:900},{name:"1920x1040",width:1920,height:1040}];
const browser = await chromium.launch({ executablePath: findChrome() });
const out={};
for(const s of SIZES){
  const ctx=await browser.newContext({viewport:{width:s.width,height:s.height}});
  const page=await ctx.newPage();
  await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
  await page.goto(BASE,{waitUntil:"networkidle"}).catch(()=>{});
  await page.waitForTimeout(1600);
  for(const label of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:label}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
  await page.addStyleTag({content:".toast{display:none!important}"});
  await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
  await page.evaluate(()=>{const n=[...document.querySelectorAll(".nav-item-label")].find(x=>(x.textContent||"").trim()==="今日");if(n)(n.closest("button")||n).click();});
  await page.waitForTimeout(900);
  out[s.name]=await page.evaluate(()=>{
    const px=n=>Math.round(n);
    const q=s=>document.querySelector(s);
    const rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {w:px(r.width),h:px(r.height),top:px(r.top),left:px(r.left),right:px(r.right),bottom:px(r.bottom)};};
    const hours=[...document.querySelectorAll(".timeline-h-hour")].map(el=>({t:(el.textContent||"").trim(),w:px(el.getBoundingClientRect().width),left:px(el.getBoundingClientRect().left)}));
    const visibleHours=hours.filter(h=>h.left>=0 && h.left<window.innerWidth);
    const evs=[...document.querySelectorAll(".timeline-h-event")].map(el=>{const r=el.getBoundingClientRect();return {t:(el.querySelector(".timeline-h-event-title")?.textContent||"").trim().slice(0,14),w:px(r.width),left:px(r.left),h:px(r.height)};});
    // 找「今日事项」等二级标题的折线位置
    const heads=[...document.querySelectorAll("h2,h3,.section-title")].map(el=>{const r=el.getBoundingClientRect();return {cls:(el.className||"").toString().slice(0,40),txt:(el.textContent||"").trim().slice(0,12),top:px(r.top),inFold:r.top<window.innerHeight};}).filter(x=>x.txt);
    const main=q(".app-body > *:not(.nav-side)")||q(".app-main");
    const cs=main?getComputedStyle(main):null;
    const scope=q(".scope-board");
    const dock=q(".timeline-dock");
    const hero=q(".today-hero");
    return {
      fold: window.innerHeight,
      mainPad: cs?cs.padding:null,
      hero: rect(hero),
      scopeBoard: rect(scope),
      timelineDock: rect(dock),
      hoursTotal: hours.length, hoursFirst: hours[0]?.t, hoursLast: hours[hours.length-1]?.t,
      hourW: hours[0]?.w, visibleHourCount: visibleHours.length,
      visibleHours: visibleHours.map(h=>h.t),
      events: evs,
      headsInView: heads.filter(h=>h.inFold).map(h=>h.txt),
      headsBelowFold: heads.filter(h=>!h.inFold).map(h=>h.txt),
    };
  });
  await ctx.close();
}
writeFileSync("docs/ui-baseline/fold-measure.json",JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
await browser.close();
