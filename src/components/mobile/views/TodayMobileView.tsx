import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { AppIcon } from "@/components/AppIcon";
import {
  MobileGoalChip,
  MobileTaskPillView,
  getMobileTaskPills,
} from "@/components/mobile/MobileTaskPills";
import { MobilePageTitle } from "@/components/mobile/MobilePageTitle";
import { MobileTaskRow } from "@/components/mobile/MobileTaskRow";
import { calculateGoalProgress, resolveGoalTarget } from "@/lib/growth";
import {
  addDays,
  ensureEndAfterStart,
  parseTimeToMinutes,
} from "@/lib/dates";
import { useTodayDate } from "@/lib/useTodayDate";
import { useGoals } from "@/lib/useGoals";
import { matchesRepeatRule, parseRepeatRule, weeklyTargetFromRule } from "@/lib/repeat";
import { mondayWeekDates } from "@/lib/weeklyChecklist";
import type { Habit } from "@/types";

/** 一天的分钟数 —— 今日时段条按 0–24h 铺满。 */
const DAY_MINUTES = 24 * 60;

type Band = { start: number; end: number };

/**
 * 合并重叠或首尾相接的时段。
 * 「09:30–11:00」与「10:00–12:00」以及紧接的「12:00–12:30」合成一段
 * 09:30–12:30，时段条上才是「连续的一条」而不是一堆小方块。
 */
function mergeBands(bands: Band[]): Band[] {
  const sorted = [...bands].sort((a, b) => a.start - b.start);
  const out: Band[] = [];
  for (const band of sorted) {
    const last = out[out.length - 1];
    if (last && band.start <= last.end) {
      last.end = Math.max(last.end, band.end);
    } else {
      out.push({ ...band });
    }
  }
  return out;
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return "尚未排期";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} 小时`;
}

function round1(value: number): number {
  return Math.round(Number(value) * 10) / 10;
}

/**
 * 移动端「今日」页 —— 单列卡片流，与桌面多栏工作台是两套视图层。
 *
 * 结构：顶栏 / 完成数主视觉卡 / 推进目标 / 今日时段 / 今日事项。
 * 事项行沿用桌面时间轴的界栏竖线，节点方点改用优先级色，右侧是完成按钮；元信息按
 * 「项目 → 标签 → 目标」排，与当周日历的 day 行同一套：前两枚是实底归属胶囊，目标
 * 那枚借用今日时间轴的 .goal-chip，在移动壳里收到同一档尺寸、只留目标色底。
 */
export function TodayMobileView() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const selectTask = useAppStore((s) => s.selectTask);
  const openCreateTask = useAppStore((s) => s.openCreateTask);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const setNav = useAppStore((s) => s.setNav);
  const habits = useAppStore((s) => s.habits);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const toggleHabitDay = useAppStore((s) => s.toggleHabitDay);

  const today = useTodayDate();
  const { goals, goalById } = useGoals();
  const [now, setNow] = useState(() => new Date());

  // 页内查看日期（与记账页切月同手法）：默认今天，可往前翻看，未来不出；
  // 跨天时 useTodayDate 翻日，视角自动回到今天。
  const [viewDate, setViewDate] = useState(today);
  useEffect(() => {
    setViewDate(today);
  }, [today]);

  // 「现在」每分钟走一格，时段条上的当前位置也跟着走。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const isViewToday = viewDate === today;
  const viewDay = new Date(`${viewDate}T00:00:00`);
  // 副标题回归一句格言，完整日期锚点搬进切换器标签：今天 / 昨天优先说人话，
  // 跨年补年份（与记账切月的「N月 / N年N月」同规）。
  const dateLabel =
    (viewDay.getFullYear() === now.getFullYear() ? "" : `${viewDay.getFullYear()}年`) +
    `${viewDay.getMonth() + 1}月${viewDay.getDate()}日`;
  const switchLabel = isViewToday
    ? `今天 · ${dateLabel}`
    : viewDate === addDays(today, -1)
      ? `昨天 · ${dateLabel}`
      : dateLabel;

  // 当日事项：根任务、截止在看的那一天，按时刻排（无时刻的排在后面）。
  const todaysTasks = useMemo(() => {
    return tasks
      .filter(
        (task) =>
          !task.parent_id && !task.deleted_at && task.due_date === viewDate,
      )
      .sort((a, b) => {
        const ta = parseTimeToMinutes(a.due_time);
        const tb = parseTimeToMinutes(b.due_time);
        if (ta !== null && tb !== null && ta !== tb) return ta - tb;
        if (ta !== null && tb === null) return -1;
        if (ta === null && tb !== null) return 1;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.sort_order - b.sort_order;
      });
  }, [tasks, viewDate]);

  // 今日习惯：按重复规则筛出该在看的那天打卡的习惯；顶卡读数按「任务 + 习惯」
  // 合计（与桌面同口径），已打卡记为完成。
  const dayHabits = useMemo(
    () =>
      habits.filter((habit) =>
        matchesRepeatRule(viewDate, parseRepeatRule(habit.repeat_rule ?? null)),
      ),
    [habits, viewDate],
  );
  const checkedHabitIds = useMemo(
    () =>
      new Set(
        habitChecks
          .filter((item) => item.check_date === viewDate)
          .map((item) => item.habit_id),
      ),
    [habitChecks, viewDate],
  );
  // 已打卡沉到行尾；完成态只由圈上勾表示，不淡出（移动壳统一规）。
  const habitRows = useMemo(
    () => [
      ...dayHabits.filter((habit) => !checkedHabitIds.has(habit.id)),
      ...dayHabits.filter((habit) => checkedHabitIds.has(habit.id)),
    ],
    [dayHabits, checkedHabitIds],
  );
  const habitsDoneCount = dayHabits.reduce(
    (sum, habit) => sum + (checkedHabitIds.has(habit.id) ? 1 : 0),
    0,
  );
  // 本周打卡进度（周一起算），长条第二行元信息用，与桌面习惯行同口径。
  const habitWeekDone = useMemo(() => {
    const weekDates = mondayWeekDates(viewDate);
    const done = new Map<string, number>();
    for (const check of habitChecks) {
      if (check.check_date < weekDates[0] || check.check_date > weekDates[6]) continue;
      done.set(check.habit_id, (done.get(check.habit_id) ?? 0) + 1);
    }
    return done;
  }, [habitChecks, viewDate]);
  const habitTargetOf = (habit: Habit) =>
    Math.max(1, weeklyTargetFromRule(parseRepeatRule(habit.repeat_rule ?? null)) ?? habit.target_per_week);

  const doneCount =
    todaysTasks.filter((task) => task.status === "completed").length + habitsDoneCount;
  const totalCount = todaysTasks.length + dayHabits.length;
  const remaining = totalCount - doneCount;

  // 今日时段：把所有带时刻的任务折成区间，再合并成连续的几段。
  const bands = useMemo(() => {
    const raw: Band[] = [];
    for (const task of todaysTasks) {
      if (!task.due_time) continue;
      const start = parseTimeToMinutes(task.due_time);
      if (start === null) continue;
      const end = parseTimeToMinutes(
        ensureEndAfterStart(task.due_time, task.end_time),
      );
      raw.push({ start, end: Math.max(end ?? start + 60, start + 15) });
    }
    return mergeBands(raw);
  }, [todaysTasks]);
  const scheduledMinutes = bands.reduce(
    (sum, band) => sum + (band.end - band.start),
    0,
  );

  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );

  return (
    <div className="mtoday">
      <header className="mtoday-top">
        <div className="mtoday-top-text">
          <MobilePageTitle text="今日" />
          <p>今日事，今日毕。</p>
        </div>
        {/* 日期切换：与记账页切月同构（搜索移去「更多」页头的同位圆钮）。 */}
        <div className="mtoday-day-switch" role="group" aria-label="切换日期">
          <button
            type="button"
            className="mtoday-icon-btn"
            aria-label="前一天"
            onClick={() => setViewDate(addDays(viewDate, -1))}
          >
            {/* SVG chevron 旋转替代 ‹/› 字符：同记账页切月，字形不随字体漂。 */}
            <AppIcon name="chevron" size={20} className="mtoday-switch-chevron is-left" />
          </button>
          <strong>{switchLabel}</strong>
          <button
            type="button"
            className="mtoday-icon-btn"
            aria-label="后一天"
            disabled={isViewToday}
            onClick={() => setViewDate(addDays(viewDate, 1))}
          >
            <AppIcon name="chevron" size={20} className="mtoday-switch-chevron is-right" />
          </button>
        </div>
      </header>

      <div className="mtoday-scroll">
        <section className="mtoday-hero" aria-label={isViewToday ? "今日完成进度" : "当日完成进度"}>
          <div className="mtoday-hero-num">
            <b>{doneCount}</b>
            <u>/{totalCount}</u>
            <em>件已完成</em>
          </div>
          <div className="mtoday-hero-side">
            {/* 连续进度条（轨道 + 完成比例填充），与「待办」/「记账」顶卡的占比条同族 */}
            <div className="mtoday-progress" aria-hidden="true">
              <i
                style={{
                  width: totalCount ? `${Math.round((doneCount / totalCount) * 100)}%` : "0%",
                }}
              />
            </div>
            <span className="mtoday-hero-sub">还剩 {remaining} 件</span>
          </div>
          <span className="mtoday-wheat" aria-hidden="true" />
        </section>

        {activeGoals.length ? (
          <section className="mtoday-card" aria-label="推进目标">
            <div className="mtoday-shead">
              <h3>推进目标</h3>
              <button type="button" className="mtoday-shead-more" onClick={() => setNav("goals")}>
                查看全部 ›
              </button>
            </div>
            <div className="mtoday-goals">
              {activeGoals.slice(0, 3).map((goal) => {
                const target = resolveGoalTarget(goal);
                const progress = calculateGoalProgress(goal);
                return (
                  <button
                    key={goal.id}
                    type="button"
                    className="mtoday-goal"
                    onClick={() => {
                      requestFocus({ kind: "goal", id: goal.id });
                      setNav("goals");
                    }}
                  >
                    <i
                      className="mtoday-gdot"
                      style={{ background: goal.color }}
                    />
                    <span className="mtoday-gname">{goal.title}</span>
                    <span className="mtoday-gbar">
                      <i
                        style={{
                          width: `${Math.round(progress)}%`,
                          background: goal.color,
                        }}
                      />
                    </span>
                    <span className="mtoday-gval">
                      {round1(goal.current_value)}/{round1(target.value)}
                      {target.unit}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="mtoday-card" aria-label={isViewToday ? "今日时段" : "当日时段"}>
          <div className="mtoday-shead">
            <h3>{isViewToday ? "今日" : "当日"}时段</h3>
            <span className="mtoday-hint">
              {formatDuration(scheduledMinutes)}
            </span>
          </div>
          <div className="mtoday-trackwrap">
            <div className="mtoday-track">
              {bands.map((band, index) => {
                const state =
                  band.start <= nowMinutes && nowMinutes <= band.end
                    ? "cur"
                    : band.end <= nowMinutes
                      ? "past"
                      : "fut";
                return (
                  <span
                    key={index}
                    className={`mtoday-seg is-${state}`}
                    style={{
                      left: `${(band.start / DAY_MINUTES) * 100}%`,
                      width: `${((band.end - band.start) / DAY_MINUTES) * 100}%`,
                    }}
                  />
                );
              })}
              {isViewToday && bands.length ? (
                <span
                  className="mtoday-cursor"
                  style={{
                    left: `${(nowMinutes / DAY_MINUTES) * 100}%`,
                  }}
                >
                  <i>现在</i>
                </span>
              ) : null}
            </div>
            <div className="mtoday-scale">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </div>
        </section>

        {habitRows.length ? (
          <section className="mtoday-card" aria-label={isViewToday ? "今日习惯" : "当日习惯"}>
            <div className="mtoday-shead">
              <h3>{isViewToday ? "今日习惯" : "当日习惯"}</h3>
              <span className="mtoday-hint">
                {habitsDoneCount}/{dayHabits.length}
              </span>
            </div>
            <ul className="mtoday-habit-list">
              {habitRows.map((habit) => {
                const checked = checkedHabitIds.has(habit.id);
                // 翻看历史日期只展示当日打卡态，不提供补打卡。
                return (
                  <li key={habit.id} className={`mtoday-habit-row${checked ? " is-done" : ""}`}>
                    <span className="mtoday-habit-rail" aria-hidden="true">
                      <i className="mtoday-dot" />
                    </span>
                    <span className="mtoday-habit-body">
                      <span className="mtoday-habit-name">{habit.title}</span>
                      <span className="mtoday-pills">
                        <span className="mtoday-habit-meta">
                          本周 {habitWeekDone.get(habit.id) ?? 0}/{habitTargetOf(habit)} 次
                        </span>
                        <MobileGoalChip
                          goal={habit.goal_id ? goalById.get(habit.goal_id) : undefined}
                        />
                      </span>
                    </span>
                    {isViewToday ? (
                      <button
                        type="button"
                        className={`mtoday-check${checked ? " is-done" : ""}`}
                        aria-pressed={checked}
                        aria-label={checked ? `取消打卡 ${habit.title}` : `打卡 ${habit.title}`}
                        onClick={() => void toggleHabitDay(habit.id, viewDate)}
                      />
                    ) : (
                      <span
                        className={`mtoday-check${checked ? " is-done" : ""}`}
                        role="img"
                        aria-label={checked ? "已打卡" : "未打卡"}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <section className="mtoday-card" aria-label={isViewToday ? "今日事项" : "当日事项"}>
          {/* 节头不设「查看全部」：这里本就完整列出当天截止的任务，
              旧按钮跳 setNav("today") 落在当前页、点了无响应，已移除。 */}
          <div className="mtoday-shead">
            <h3>{isViewToday ? "今日" : "当日"}事项</h3>
          </div>
          {todaysTasks.length ? (
            <ul className="mtoday-list">
              {todaysTasks.map((task) => {
                const done = task.status === "completed";
                const pills = getMobileTaskPills(task, projects, tags, tagMap);
                const goal = task.goal_id ? goalById.get(task.goal_id) : undefined;
                return (
                  <MobileTaskRow
                    key={task.id}
                    className={`mtoday-row pr${task.priority}${done ? " is-done" : ""}`}
                    onActivate={() => selectTask(task.id)}
                  >
                    <span className="mtoday-time">
                      <b>{task.due_time ?? "全天"}</b>
                      {task.end_time ? <i>至 {task.end_time}</i> : null}
                    </span>
                    <span className="mtoday-rail" aria-hidden="true">
                      <i className="mtoday-dot" />
                    </span>
                    <span className="mtoday-body">
                      <span className="mtoday-title">{task.title}</span>
                      {pills.length || goal ? (
                        <span className="mtoday-pills">
                          {pills.map((pill) => (
                            <MobileTaskPillView key={pill.key} pill={pill} />
                          ))}
                          <MobileGoalChip goal={goal} />
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className={`mtoday-check${done ? " is-done" : ""}`}
                      aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
                      aria-pressed={done}
                      onClick={(event) => {
                        event.stopPropagation();
                        void toggleComplete(task.id);
                      }}
                    />
                  </MobileTaskRow>
                );
              })}
            </ul>
          ) : (
            <p className="mtoday-empty">
              {isViewToday
                ? "今天还没有截止的任务。新建任务并把截止日期设为今天即可。"
                : "这一天没有截止的任务。"}
            </p>
          )}
        </section>
      </div>

      <button
        type="button"
        className="mtoday-fab"
        aria-label="新建任务"
        onClick={() => openCreateTask()}
      />
    </div>
  );
}
