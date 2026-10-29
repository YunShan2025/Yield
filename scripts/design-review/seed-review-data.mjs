/**
 * 给评审库补上足以判读视图密度的内容（只写 .tmp-design-review/app.db 副本）。
 *
 * 用户真实数据里 53 条任务有 51 条已完成、今天只有 1 条，
 * 密度不足以判断「今日 / 周清单」这类列表视图长什么样。
 * 这里按用户真实的用词习惯补 20 来条评审专用数据，id 一律以 review- 开头，
 * 重复执行会先清掉上一轮的评审数据。
 */
import { DatabaseSync } from "node:sqlite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = resolve(HERE, "..", "..", ".tmp-design-review", "app.db");
const db = new DatabaseSync(DB);

// 验收副本要能反映「今天」的视图密度，日期一律以运行当天为锚点推导——
// 原来硬编码 2026-10-21，隔一周再跑「今日 / 周清单」就又空了，验收会误判。
const day = (offset) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // 中午取值，避开跨月/跨年的时区抖动
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const now = new Date().toISOString();
const uid = (n) => `review-${n}`;

// 清掉上一轮
db.exec("DELETE FROM task_tags WHERE task_id LIKE 'review-%'");
db.exec("DELETE FROM tasks WHERE id LIKE 'review-%'");
db.exec("DELETE FROM habit_checks WHERE id LIKE 'review-%'");
db.exec("DELETE FROM goal_entries WHERE id LIKE 'review-%'");
db.exec("DELETE FROM memos WHERE id LIKE 'review-%'");
db.exec("DELETE FROM anniversaries WHERE id LIKE 'review-%'");

const project = Object.fromEntries(
  db.prepare("SELECT id, name FROM projects WHERE deleted_at IS NULL").all().map((p) => [p.name, p.id]),
);
const tag = Object.fromEntries(
  db.prepare("SELECT id, name FROM tags").all().map((t) => [t.name, t.id]),
);

let n = 0;
const task = (t) => {
  const id = uid(++n);
  db.prepare(`INSERT INTO tasks
    (id,title,description,notes,priority,status,due_date,due_time,end_time,sort_order,created_at,updated_at,completed_at,project_id)
    VALUES (?,?,'','',?,?,?,?,?,?,?,?,?,?)`)
    .run(id, t.title, t.priority ?? 3, t.status ?? "pending", t.due, t.start ?? null, t.end ?? null,
      1789300000000 + n, now, now,
      t.status === "completed" ? `${t.due}T12:00:00.000Z` : null,
      t.project ? project[t.project] ?? null : null);
  for (const tagName of t.tags ?? []) {
    const tagId = tag[tagName];
    if (tagId) db.prepare("INSERT INTO task_tags (task_id,tag_id,updated_at) VALUES (?,?,?)").run(id, tagId, now);
  }
  return id;
};

// —— 今天（含今日时间轴与已完成两条）——
task({ title: "推进：论文实验第三轮", due: day(0), start: "09:30", end: "11:00", priority: 1, project: "小论文" });
task({ title: "有秋：阶段 2 视觉收口验收", due: day(0), start: "10:00", end: "12:00", priority: 1, project: "《有秋》开发维护" });
task({ title: "读《Designing Data-Intensive Applications》第 5 章", due: day(0), start: "14:00", end: "15:30", priority: 3 });
task({ title: "回复华为杯组委会邮件", due: day(0), start: "12:00", end: "12:30", priority: 2, project: "华为杯数模比赛" });
task({ title: "健身：力量训练", due: day(0), start: "19:00", end: "20:00", priority: 3, project: "💪健身" });
task({ title: "数模：第三轮数据清洗", due: day(0), start: "09:00", end: "10:30", status: "completed", project: "华为杯数模比赛" });
task({ title: "周复盘：整理本周完成率", due: day(0), start: "16:00", end: "17:00", status: "completed" });
// —— 昨天没做完，顺延到今天 ——
task({ title: "推进：增强体质", due: day(-1), start: "01:00", end: "02:00", priority: 3, project: "💪健身" });
// —— 近几日 ——
task({ title: "Agent Harness：第 2 章笔记", due: day(-2), start: "15:00", end: "17:30", status: "completed", project: "Agent Harness" });
task({ title: "简历项目修改：补一版", due: day(1), start: "14:00", end: "16:00", priority: 2, project: "简历项目修改" });
task({ title: "KG / DDI 数据对齐复核", due: day(1), start: "10:00", end: "12:30", priority: 1, project: "小论文" });
task({ title: "LLMmaster：07-14 继续", due: day(2), start: "14:00", end: "18:00", project: "代码能力提升" });
task({ title: "补充 UMLS 数据条目", due: day(3), start: "16:00", end: "19:00", project: "小论文" });
// —— 一周内往后（周清单要能看到后续几天的排期）——
task({ title: "论文初稿：方法章节", due: day(5), start: "09:00", end: "12:00", priority: 1, project: "小论文" });
task({ title: "有秋：v1.4 发版检查", due: day(6), start: "15:00", end: "17:00", priority: 1, project: "《有秋》开发维护" });
task({ title: "数模：论文摘要", due: day(7), start: "20:00", end: "22:00", project: "华为杯数模比赛" });

// —— 习惯打卡（近 7 天）——
const habits = db.prepare("SELECT id, title FROM habits WHERE deleted_at IS NULL").all();
for (const h of habits) {
  for (const d of [day(-6), day(-5), day(-4), day(-2), day(-1), day(0)]) {
    const exists = db.prepare("SELECT 1 FROM habit_checks WHERE habit_id=? AND check_date=?").get(h.id, d);
    if (exists) continue;
    db.prepare("INSERT INTO habit_checks (id,habit_id,check_date) VALUES (?,?,?)").run(uid(`hc-${h.id}-${d}`), h.id, d);
  }
}

// —— 目标条目（进度只来自任务/打卡事件，migration v29 起）——
const goals = db.prepare("SELECT id, title, unit, target_value FROM goals WHERE deleted_at IS NULL").all();
for (const g of goals) {
  for (const [i, d] of [day(-9), day(-7), day(-5), day(-3), day(-1)].entries()) {
    db.prepare("INSERT INTO goal_entries (id,goal_id,entry_date,value,source_type,source_id,note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(uid(`ge-${g.id}-${d}`), g.id, d, 1, i % 2 ? "task" : "habit", `seed:${g.id}:${d}`, "评审样例", now, now);
  }
}

// —— 备忘录 ——
db.prepare("INSERT INTO memos (id,content,title,pinned,archived,format,created_at,updated_at) VALUES (?,?,?,?,0,'markdown',?,?)")
  .run(uid("memo-1"), "# 复盘要点\n\n- 任务平均编辑 4.67 次，**创建表单偏重**，标题与日期之外渐进展开\n- 账本回填占 30%，快捷金额应按历史频次自适应\n- 成长与习惯建成但零使用，需要给出自然入口",
    "阶段 3 复盘要点", 1, now, now);
db.prepare("INSERT INTO memos (id,content,title,pinned,archived,format,created_at,updated_at) VALUES (?,?,?,?,0,'markdown',?,?)")
  .run(uid("memo-2"), "取数口径：统计区间 2026-09-14 ~ 2026-10-18，约 5 周。",
    "取数口径", 0, now, now);

// —— 纪念日 ——
db.prepare("INSERT INTO anniversaries (id,title,event_date,calendar,recur_yearly,note,created_at,updated_at) VALUES (?,?,?,'solar',1,?,?,?)")
  .run(uid("anni-1"), "开题报告提交", "2026-11-05", "小论文开题节点，别拖到最后一天", now, now);
db.prepare("INSERT INTO anniversaries (id,title,event_date,calendar,lunar_month,lunar_day,recur_yearly,note,created_at,updated_at) VALUES (?,?,?,'lunar',?,?,1,?,?,?)")
  .run(uid("anni-2"), "母亲生日", "2026-11-08", 10, 6, "农历十月初六，提前订蛋糕", now, now);

const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log("评审数据已补齐：");
for (const t of ["tasks", "habit_checks", "goal_entries", "memos", "anniversaries"]) {
  console.log(`  ${t.padEnd(14)} ${count(t)} 行`);
}
db.close();


