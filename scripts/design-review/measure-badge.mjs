import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
async function loadPlaywright(){for(const c of [process.env.PLAYWRIGHT_PATH,"playwright","C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)){try{return await import(/^[a-z]+:\/\//i.test(c)?c:pathToFileURL(c).href);}catch{}}throw new Error("pw");}
function findChrome(){for(const c of [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].filter(Boolean)){if(existsSync(c))return c;}throw new Error("no chrome");}
const { chromium } = await loadPlaywright();
const browser=await chromium.launch({executablePath:findChrome()});
const ctx=await browser.newContext({viewport:{width:1240,height:720},deviceScaleFactor:2});
const page=await ctx.newPage();
await page.clock.install({time:new Date("2026-10-21T11:00:00+08:00")}).catch(()=>{});
await page.goto("http://localhost:4173",{waitUntil:"networkidle"}).catch(()=>{});
await page.waitForTimeout(1700);
for(const l of ["跳过","暂不开启"]){const b=page.getByRole("button",{name:l}).first();if(await b.count().catch(()=>0)){await b.click({timeout:3000}).catch(()=>{});await page.waitForTimeout(400);break;}}
await page.addStyleTag({content:".toast{display:none!important}"});
await page.evaluate(()=>document.getElementById("boot-splash")?.remove());
for(const th of ["light","dark","dawn","glass"]){
  await page.evaluate(t=>document.documentElement.setAttribute("data-theme",t), th);
  await page.waitForTimeout(300);
  const c=await page.evaluate(()=>{
    const el=document.querySelector(".nav-count");
    if(!el) return null;
    const cs=getComputedStyle(el);
    const parse=s=>{ s=String(s).trim();
      if(s.startsWith("#")){ const h=s.slice(1); const f=h.length===3?h.split("").map(x=>x+x).join(""):h;
        return [parseInt(f.slice(0,2),16),parseInt(f.slice(2,4),16),parseInt(f.slice(4,6),16),1]; }
      const m=(s.match(/[\d.]+/g)||[0,0,0,1]).map(Number);return [m[0],m[1],m[2],m[3]??1];};
    const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)};
    // 自下而上把半透明祖先叠到不透明底（--surface-base）上
    const root=getComputedStyle(document.documentElement);
    const base=parse(root.getPropertyValue("--surface-base").trim()||"rgb(255,255,255)");
    let acc=base[3]>=0.99?base:base;
    const chain=[]; let node=el;
    while(node){ chain.push(parse(getComputedStyle(node).backgroundColor)); node=node.parentElement; }
    let out=[acc[0],acc[1],acc[2]];
    for(let i=chain.length-1;i>=0;i--){ const c=chain[i]; if(c[3]===0) continue; out=[out[0]*(1-c[3])+c[0]*c[3], out[1]*(1-c[3])+c[1]*c[3], out[2]*(1-c[3])+c[2]*c[3]]; }
    const fg=parse(cs.color);
    const L1=lum(fg), L2=lum(out);
    return {txt:el.textContent, fg:cs.color, bg:out.map(v=>Math.round(v)).join(","), ratio:Math.round(((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05))*100)/100, size:cs.fontSize};
  });
  console.log(th, JSON.stringify(c));
  await page.screenshot({path:`docs/ui-baseline/rail-${th}.png`, clip:{x:0,y:40,width:80,height:300}});
}
await browser.close();
