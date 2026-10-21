/**
 * 渲染态可访问性体检：对比度 / 触控目标 / 焦点环 / 选中文本 / 占位符。
 * 替代 impeccable 的 URL 扫描（本机起不了它自带的浏览器）。
 *
 * 对比度判定分两步：
 *   ① 计算样式层 —— 自底向上逐层合成背景，渐变按色标展开成候选色集，
 *      对文字取最差的那个候选。这一步是「保守推断」，偏严。
 *   ② 像素层 —— 对 ① 报出的失败项，在同一个页面会话里做两张截图差分
 *      （A 有字 / B 无字），只量「文字真正压住的那几个像素」的底色，
 *      得到真实对比度。① 报失败但 ② 通过的，是推断过头。
 *      最终结论以 ② 为准。
 *
 * 用法: node scripts/ui-a11y.mjs [outJson] [--views=提醒,复盘] [--vp=desktop] [--no-pixels]
 */
import { writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_PATH, "playwright",
    "C:/Users/Hearted/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"].filter(Boolean)) {
    try { return await import(/^[a-z]+:\/\//i.test(c) ? c : pathToFileURL(c).href); } catch {}
  }
  throw new Error("playwright not found");
}
function findChrome() {
  for (const c of [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean))
    if (existsSync(c)) return c;
  throw new Error("no chrome");
}
const { chromium } = await loadPlaywright();

const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => {
  const [k, ...v] = a.replace(/^--/, "").split("=");
  return [k, v.join("=")];
}));
const OUT = argv.find((a) => !a.startsWith("--")) || "docs/ui-baseline/a11y.json";
const BASE = "http://localhost:4173";
const THEMES = ["light", "dark", "dawn", "glass"];
const USE_PIXELS = !("no-pixels" in flags);

/** 侧栏 13 项 = 全部视图。体检要覆盖到每一个，不能只挑高频页。 */
const ALL_VIEWS = [
  ["today", "今日"], ["inbox", "待办箱"], ["weekly", "周清单"],
  ["ledger", "收支总览"],
  ["growth", "成长"], ["habits", "习惯"], ["review", "复盘"],
  ["reminders", "提醒"], ["memos", "备忘录"], ["projects", "项目"], ["tags", "标签"],
  ["anniversaries", "纪念日"], ["settings", "设置"], ["trash", "回收站"],
];
const VIEWS = flags.views
  ? ALL_VIEWS.filter(([, label]) => flags.views.split(",").includes(label))
  : ALL_VIEWS;

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 1240, height: 720 },
  { name: "wide", width: 1920, height: 1040 },
  { name: "mobile", width: 390, height: 844 },
].filter((v) => !flags.vp || flags.vp.split(",").includes(v.name));

/** 触控目标底线。桌面端按 WCAG 2.5.8 (AA) 取 24px（DESIGN.md §Do's）。 */
const TARGET_MIN = Number(flags.target || 24);

const browser = await chromium.launch({ executablePath: findChrome() });
const report = {};

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-21T11:00:00+08:00") }).catch(() => {});
  const url = vp.name === "mobile" ? BASE + "?shell=mobile" : BASE;
  await page.goto(url, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(2200);
  for (const label of ["跳过", "暂不开启"]) {
    const b = page.getByRole("button", { name: label }).first();
    if (await b.count().catch(() => 0)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
  }
  await page.addStyleTag({ content: ".toast{display:none!important}" });
  await page.evaluate(() => document.getElementById("boot-splash")?.remove());
  // 冻结动效：保证两张截图除文字外完全一致
  await page.addStyleTag({
    content: "*, *::before, *::after { animation-play-state: paused !important; transition: none !important; caret-color: transparent !important; }",
  });

  for (const theme of THEMES) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(250);
    for (const [view, label] of VIEWS) {
      if (vp.name === "mobile" && !["today", "ledger", "inbox"].includes(view)) continue;
      await page.evaluate(({ label }) => {
        const n = [...document.querySelectorAll(".nav-item-label, .mobile-nav-label")]
          .find((x) => (x.textContent || "").trim() === label);
        if (n) (n.closest("button") || n).click();
      }, { label });
      await page.waitForTimeout(600);
      // 视图切换会留下上一个视图的滚动位置，复位到顶部：体检要量「用户打开这一页
      // 第一眼看到的样子」，滚动残留会让取样落在别处。
      await page.evaluate(() => {
        for (const el of document.querySelectorAll("*")) {
          if (el.scrollTop) el.scrollTop = 0;
          if (el.scrollLeft) el.scrollLeft = 0;
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(120);
      const data = await page.evaluate((targetMin) => {
        /* ---------- 颜色解析 ---------- */
        const parseColor = (s) => {
          if (!s) return null;
          const t = String(s).trim();
          if (!t || t === "none" || t === "transparent") return null;
          // color(srgb r g b / a) —— Chrome 对 color-mix() 的计算值
          let m = t.match(/^color\(\s*srgb\s+([^)]*)\)$/i);
          if (m) {
            const parts = m[1].split("/");
            // 「srgb」这个关键字不是数字，滤掉（其余三个分量就是 r/g/b，0-1）
            const nums = parts[0].trim().split(/\s+/).map(Number).filter((v) => Number.isFinite(v));
            const alpha = parts.length > 1 ? Number(parts[1].trim()) : 1;
            if (nums.length >= 3) {
              return {
                r: Math.round(nums[0] * 255), g: Math.round(nums[1] * 255), b: Math.round(nums[2] * 255),
                a: Number.isFinite(alpha) ? alpha : 1,
              };
            }
            return null;
          }
          m = t.match(/^rgba?\(([^)]*)\)$/i);
          if (m) {
            const p = m[1].split(/[\s,/]+/).filter(Boolean);
            // Chrome 对同一颜色可能给「整数 0-255」也可能给「百分比」，两种都要认。
            const chan = (v) => (String(v).endsWith("%")
              ? Math.round((parseFloat(v) / 100) * 255)
              : Math.round(parseFloat(v)));
            const alpha = (v) => (String(v).endsWith("%") ? parseFloat(v) / 100 : parseFloat(v));
            const r = chan(p[0]), g = chan(p[1]), b = chan(p[2]);
            const a = p[3] !== undefined ? alpha(p[3]) : 1;
            if (![r, g, b].every(Number.isFinite)) return null;
            return { r, g, b, a: Number.isFinite(a) ? a : 1 };
          }
          return null;
        };
        const lum = (c) => {
          const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const over = (fg, bg) => ({
          r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
          b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
        });
        const ratio = (a, b) => {
          const l1 = lum(a), l2 = lum(b);
          return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        };
        const css = (c) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${Number(c.a.toFixed(3))})`;

        /* ---------- 渐变解析 ---------- */
        // background-image 可能是多层（逗号分隔），先按括号深度拆层
        const splitLayers = (image) => {
          const out = []; let depth = 0, cur = "";
          for (const ch of image) {
            if (ch === "(") depth++;
            else if (ch === ")") depth--;
            if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
            else cur += ch;
          }
          if (cur.trim()) out.push(cur);
          return out;
        };
        // 取出一层里的所有色标
        const stopsOf = (layer) => {
          const re = /(rgba?\([^)]*\)|color\([^)]*\)|hsla?\([^)]*\)|#[0-9a-fA-F]{3,8})/g;
          const out = [];
          let m;
          while ((m = re.exec(layer))) {
            const c = parseColor(m[0]);
            if (c) out.push({ raw: m[0], color: c });
          }
          return out;
        };

        /* ---------- 底色解析（含渐变） ----------
           自底向上逐层合成：每一层先把自己的 background-color 叠在下面那层之上，
           再把自己的 background-image 叠在更上面。
           background-image 是列表时第一个在最上，所以按倒序叠。
           渐变按色标展开成候选色集，最后对文字取最差的那个候选。 */
        const canvasColor = () => {
          const c = parseColor(getComputedStyle(document.documentElement).backgroundColor);
          return c && c.a >= 0.999 ? c : { r: 255, g: 255, b: 255, a: 1 };
        };
        const dedupe = (set) => {
          const seen = new Set();
          const out = [];
          for (const c of set) {
            const k = `${c.color.r}|${c.color.g}|${c.color.b}`;
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(c);
          }
          return out;
        };
        const resolveBg = (el) => {
          const layers = [];
          let n = el;
          while (n && n !== document.documentElement) {
            const s = getComputedStyle(n);
            layers.push({ color: parseColor(s.backgroundColor), image: s.backgroundImage });
            n = n.parentElement;
          }
          let set = [{ color: canvasColor(), stop: null }];
          let hasGradient = false;
          for (let i = layers.length - 1; i >= 0; i--) {
            const layer = layers[i];
            const c = layer.color;
            if (c && c.a > 0) set = set.map((b) => ({ ...b, color: over(c, b.color) }));
            const img = layer.image;
            if (!img || img === "none") continue;
            const imgs = splitLayers(img).map((s) => s.trim()).filter((s) => s && s !== "none");
            for (const s of imgs.slice().reverse()) {
              if (!/gradient/i.test(s)) continue;   // url() 之类无法计算，跳过
              hasGradient = true;
              const stops = stopsOf(s);
              if (!stops.length) continue;
              const next = [];
              for (const b of set) for (const st of stops) next.push({ color: over(st.color, b.color), stop: st.raw });
              set = dedupe(next).slice(0, 128);
            }
          }
          return { candidates: set, hasGradient };
        };

        const out = { contrast: [], gradient: [], targets: [], focus: [], other: [] };
        const seen = new Set();
        let probe = 0;
        for (const el of document.querySelectorAll("body *")) {
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
          if (own) {
            const fg = parseColor(cs.color);
            if (fg && fg.a > 0) {
              const { candidates, hasGradient } = resolveBg(el);
              let worst = null;
              for (const cand of candidates) {
                const r = ratio(over(fg, cand.color), cand.color);
                if (!worst || r < worst.ratio) worst = { color: cand.color, stop: cand.stop, ratio: r };
              }
              const size = parseFloat(cs.fontSize);
              const weight = Number(cs.fontWeight) || 400;
              const large = size >= 24 || (size >= 18.66 && weight >= 700);
              const need = large ? 3 : 4.5;
              if (hasGradient) {
                out.gradient.push({
                  sel: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""),
                  text: (el.textContent || "").trim().slice(0, 30),
                  ratio: +worst.ratio.toFixed(2), need, ok: worst.ratio >= need,
                  worstFrom: hasGradient ? "gradient" : "solid", worstStop: worst.stop || null,
                });
              }
              if (worst.ratio < need) {
                const key = el.tagName + "|" + (el.className || "") + "|" + cs.color + "|" + (hasGradient ? "gradient" : "solid") + "|" + (worst.stop || "");
                if (!seen.has(key)) {
                  seen.add(key);
                  el.setAttribute("data-a11y-probe", String(probe));
                  out.contrast.push({
                    probe: probe++,
                    sel: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).join(".") : ""),
                    text: (el.textContent || "").trim().slice(0, 40),
                    ratio: +worst.ratio.toFixed(2), need, size, weight, color: cs.color,
                    bg: css(worst.color), bgFrom: hasGradient ? "gradient" : "solid", worstStop: worst.stop || null,
                  });
                }
              }
            }
          }
          // 触控目标
          if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "[role=button]", "[role=checkbox]"]
            .some((t) => (t.startsWith("[") ? el.matches(t) : el.tagName === t))) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && (r.width < targetMin || r.height < targetMin)) {
              out.targets.push({
                sel: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).slice(0, 2).join(".") : ""),
                text: (el.textContent || "").trim().slice(0, 24),
                w: +r.width.toFixed(1), h: +r.height.toFixed(1),
              });
            }
          }
        }
        // 焦点环 / 选中文本 / 占位符
        const html = document.documentElement;
        out.other.push({ check: "selection", value: getComputedStyle(html).getPropertyValue("::selection").trim() || "(未定义)" });
        const inp = document.querySelector("input");
        if (inp) out.other.push({ check: "placeholder", value: getComputedStyle(inp, "::placeholder").color });
        out.other.push({ check: "caret-color", value: getComputedStyle(document.body).caretColor });
        out.other.push({ check: "scrollbar-width", value: getComputedStyle(html).scrollbarWidth });
        out.other.push({ check: "font-variant-numeric", value: getComputedStyle(document.body).fontVariantNumeric });
        return out;
      }, TARGET_MIN);

      /* ---------- 像素层复核（同一会话、同一坐标） ---------- */
      if (USE_PIXELS && data.contrast.length) {
        const measured = {};
        // 量一屏：所有当前可见的失败项一次测完。
        const measureVisible = async () => {
          // 先清掉可能残留的「文字透明」样式：残留会让 A/B 两张截图一模一样，
          // 结果就是所有元素都报 no-text-pixels。
          await page.evaluate(() => {
            for (const s of document.querySelectorAll("style")) {
              if ((s.textContent || "").includes("color: transparent !important")) s.remove();
            }
          });
          const shotA = await page.screenshot({ type: "png" });
          const hide = await page.addStyleTag({ content: "*, *::before, *::after { color: transparent !important; }" });
          await page.waitForTimeout(140);
          const shotB = await page.screenshot({ type: "png" });
          await hide.evaluate((el) => el.remove());
          await page.waitForTimeout(60);
          return await page.evaluate(async ({ a, b }) => {
            const load = async (src) => { const im = new Image(); im.src = src; await im.decode(); return im; };
            const ia = await load(a), ib = await load(b);
            const mk = (im) => {
              const c = document.createElement("canvas");
              c.width = im.width; c.height = im.height;
              const g = c.getContext("2d", { willReadFrequently: true });
              g.drawImage(im, 0, 0);
              return g.getImageData(0, 0, c.width, c.height).data;
            };
            const da = mk(ia), db = mk(ib);
            const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
            const out = {};
            for (const el of document.querySelectorAll("[data-a11y-probe]")) {
              const id = el.getAttribute("data-a11y-probe");
              const r = el.getBoundingClientRect();
              const x0 = Math.max(0, Math.round(r.x));
              const y0 = Math.max(0, Math.round(r.y));
              const w = Math.min(Math.round(r.width), ia.width - x0);
              const h = Math.min(Math.round(r.height), ia.height - y0);
              if (w <= 0 || h <= 0) { out[id] = { note: "offscreen" }; continue; }
              let minL = Infinity, maxL = -Infinity, n = 0;
              for (let py = y0; py < y0 + h; py++) {
                for (let px = x0; px < x0 + w; px++) {
                  const i = (py * ia.width + px) * 4;
                  const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
                  if (d < 18) continue;            // 差得太小：不是文字像素（阈值取 18，把抗锯齿边缘也算进来）
                  const L = 0.2126 * f(db[i]) + 0.7152 * f(db[i + 1]) + 0.0722 * f(db[i + 2]);
                  if (L < minL) minL = L;
                  if (L > maxL) maxL = L;
                  n++;
                }
              }
              out[id] = n > 0 ? { minL, maxL, textPixels: n } : { note: "no-text-pixels" };
            }
            return out;
          }, {
            a: "data:image/png;base64," + shotA.toString("base64"),
            b: "data:image/png;base64," + shotB.toString("base64"),
          });
        };

        // 第一轮：当前视口内的。
        let got = await measureVisible();
        const pending = [];
        for (const c of data.contrast) {
          const id = String(c.probe);
          const r = got[id];
          if (r && !r.note) { measured[id] = r; continue; }
          if (r && r.note === "no-text-pixels") { measured[id] = r; continue; }
          pending.push(c.probe);
        }

        // 第二轮：视口外的逐个滚进视口再量 —— 一次只能滚一个，
        // 一起滚的话只有最后一个留在屏上。
        for (const id of pending) {
          const moved = await page.evaluate((pid) => {
            const el = document.querySelector('[data-a11y-probe="' + pid + '"]');
            if (!el) return false;
            el.scrollIntoView({ block: "center", inline: "nearest" });
            return true;
          }, id);
          if (!moved) { measured[String(id)] = { note: "gone" }; continue; }
          await page.waitForTimeout(180);
          const one = await measureVisible();
          const r = one[String(id)];
          measured[String(id)] = r && !r.note ? r : (r || { note: "offscreen" });
        }

        const lumOf = (c) => {
          const f2 = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f2(c.r) + 0.7152 * f2(c.g) + 0.0722 * f2(c.b);
        };
        const parseFg = (s) => {
          const m = String(s).match(/^rgba?\(([^)]*)\)$/i);
          if (!m) return null;
          const p = m[1].split(/[\s,/]+/).filter(Boolean);
          const chan = (v) => (String(v).endsWith("%") ? Math.round((parseFloat(v) / 100) * 255) : Math.round(parseFloat(v)));
          return { r: chan(p[0]), g: chan(p[1]), b: chan(p[2]) };
        };
        for (const c of data.contrast) {
          const m = measured[String(c.probe)];
          if (!m || m.note) { c.real = null; c.realNote = m ? m.note : "missing"; continue; }
          const fg = parseFg(c.color);
          if (!fg) { c.real = null; c.realNote = "bad-fg"; continue; }
          const fl = lumOf(fg);
          const rl = (Math.max(fl, m.minL) + 0.05) / (Math.min(fl, m.minL) + 0.05);
          const rh = (Math.max(fl, m.maxL) + 0.05) / (Math.min(fl, m.maxL) + 0.05);
          c.real = +Math.min(rl, rh).toFixed(2);
          c.realOk = c.real >= c.need;
          c.realNote = rl <= rh ? "暗端最差" : "亮端最差";
        }
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("[data-a11y-probe]")) el.removeAttribute("data-a11y-probe");
        });
      }

      report[`${vp.name}/${theme}/${view}`] = data;
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(OUT, JSON.stringify(report));
const sum = { contrast: 0, gradient: 0, gradientFail: 0, targets: 0, real: 0, realFail: 0, noSample: 0 };
for (const k of Object.keys(report)) {
  sum.contrast += report[k].contrast.length;
  sum.gradient += report[k].gradient.length;
  sum.gradientFail += report[k].gradient.filter((g) => !g.ok).length;
  sum.targets += report[k].targets.length;
  for (const c of report[k].contrast) {
    if (c.real === null || c.real === undefined) { sum.noSample++; continue; }
    sum.real++;
    if (!c.realOk) sum.realFail++;
  }
}
console.log(`已导出 ${Object.keys(report).length} 个视图 → ${OUT}`);
console.log(`渐变底文字共 ${sum.gradient} 处，其中计算样式判定不达标 ${sum.gradientFail} 处`);
console.log(`像素复核：抽样 ${sum.real} 条 → 真实不达标 ${sum.realFail} 条；未采到 ${sum.noSample} 条`);
console.log(`触控目标 < ${TARGET_MIN}px：${sum.targets} 处`);
if (sum.realFail) {
  const by = {};
  for (const k of Object.keys(report)) for (const c of report[k].contrast) {
    if (c.real !== null && c.real !== undefined && !c.realOk) {
      const key = c.sel + " | " + c.color;
      by[key] = by[key] || { n: 0, min: 99, max: 0, views: new Set() };
      by[key].n++; by[key].min = Math.min(by[key].min, c.real); by[key].max = Math.max(by[key].max, c.real);
      by[key].views.add(k.split("/")[1]);
    }
  }
  console.log("--- 真实不达标 ---");
  Object.entries(by).sort((a, b) => b[1].n - a[1].n).forEach(([k, v]) =>
    console.log(`  ${String(v.n).padStart(3)}  ${v.min.toFixed(2)}~${v.max.toFixed(2)}  [${[...v.views].join(",")}]  ${k}`));
}
