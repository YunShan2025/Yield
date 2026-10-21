// 渲染态幽灵卡体检：同时有可见边框与非 none 阴影的元素
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const BASE=process.argv[2]||"http://localhost:4173";
const VIEWS=[["today","今日"],["inbox","待办箱"],["weekly","周清单"],["ledger","收支总览"],["growth","成长"],["memos","备忘录"],["settings","设置"],["habits","习惯"],["review","复盘"],["reminders","提醒"],["projects","项目"],["tags","标签"],["anniversaries","纪念日"]];
const browser=await chromium.launch({executablePath:findChrome()});
const ctx=await browser.newContext({viewport:{width:1440,height:900}});
const page=await ctx.newPage();
await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await page.goto(BASE,{waitUntil:"networkidle"}).catch(()=>{});
await page.waitForTimeout(1800);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.addStyleTag({content:".toast{display:none!important}"});
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
const found = new Map();
for(const [id,label] of VIEWS){
  const ok=await page.evaluate((label)=>{const n=[...document.querySelectorAll(".nav-item-label")].find(x=>(x.textContent||"").trim()===label);if(!n)return false;(n.closest("button")||n).click();return true;},label);
  if(!ok){ console.log("WARN 未找到",label); continue; }
  await page.waitForTimeout(700);
  const hits=await page.evaluate(()=>{
    const out=[];
    for(const el of document.querySelectorAll("*")){
      const cs=getComputedStyle(el);
      if(cs.display==="none"||cs.visibility==="hidden") continue;
      const r=el.getBoundingClientRect();
      if(r.width<4||r.height<4) continue;
      if(cs.boxShadow==="none"||!cs.boxShadow) continue;
      const bw=["borderTopWidth","borderRightWidth","borderBottomWidth","borderLeftWidth"].map(k=>parseFloat(cs[k])||0);
      if(Math.max(...bw)<=0) continue;
      const cls=(el.className||"").toString().split(" ").filter(Boolean).slice(0,2).join(".");
      out.push({cls, tag:el.tagName.toLowerCase(), shadow:cs.boxShadow.slice(0,64), border:cs.borderTopWidth+" "+cs.borderTopColor});
    }
    return out;
  });
  for(const h of hits){ const k=h.cls||h.tag; if(!found.has(k)) found.set(k,{...h,views:[id]}); else found.get(k).views.push(id); }
}
console.log("=== 渲染态「有边框 + 有阴影」元素 ===");
for(const [k,v] of [...found.entries()].sort((a,b)=>b[1].views.length-a[1].views.length)){
  console.log(`${String(v.views.length).padStart(2)} 页  ${k.padEnd(34)} border:${v.border}  shadow:${v.shadow}`);
}
await browser.close();
