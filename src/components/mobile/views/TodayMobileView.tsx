import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { AppIcon } from "@/components/AppIcon";
import {
  MobileTaskPillView,
  getMobileTaskPills,
} from "@/components/mobile/MobileTaskPills";
import { MobileTaskRow } from "@/components/mobile/MobileTaskRow";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { fetchGoals } from "@/lib/db";
import { calculateGoalProgress, resolveGoalTarget } from "@/lib/growth";
import {
  ensureEndAfterStart,
  parseTimeToMinutes,
} from "@/lib/dates";
import { useTodayDate } from "@/lib/useTodayDate";
import type { Goal, Task } from "@/types";

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
 * 事项行沿用桌面时间轴的界栏竖线，节点方点改用优先级色，
 * 右侧是完成按钮；元信息统一为「项目 + 标签」两枚彩色胶囊。
 */
export function TodayMobileView() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const selectTask = useAppStore((s) => s.selectTask);
  const openCreateTask = useAppStore((s) => s.openCreateTask);
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const setNav = useAppStore((s) => s.setNav);

  const today = useTodayDate();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [sheetTask, setSheetTask] = useState<Task | null>(null);

  // 「现在」每分钟走一格，时段条上的当前位置也跟着走。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // 目标进度在同步后才复算，跟随同一条事件重载，今日页才不落后于成长页。
  useEffect(() => {
    const reload = () => void fetchGoals().then(setGoals);
    reload();
    window.addEventListener("youqiu:data-changed", reload);
    window.addEventListener("youqiu:sync-applied", reload);
    return () => {
      window.removeEventListener("youqiu:data-changed", reload);
      window.removeEventListener("youqiu:sync-applied", reload);
    };
  }, []);

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const dateLabel = `${now.getMonth() + 1}月${now.getDate()}日 · 星期${"日一二三四五六"[now.getDay()]}`;

  // 今日事项：根任务、截止在今天，按时刻排（无时刻的排在后面）。
  const todaysTasks = useMemo(() => {
    return tasks
      .filter(
        (task) =>
          !task.parent_id && !task.deleted_at && task.due_date === today,
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
  }, [tasks, today]);

  const doneCount = todaysTasks.filter(
    (task) => task.status === "completed",
  ).length;
  const totalCount = todaysTasks.length;
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
          <h2>今日</h2>
          <p>{dateLabel}</p>
        </div>
        <button
          type="button"
          className="mtoday-icon-btn"
          aria-label="搜索"
          onClick={openCommandPalette}
        >
          <AppIcon name="search" size={19} />
        </button>
      </header>

      <div className="mtoday-scroll">
        <section className="mtoday-hero" aria-label="今日完成进度">
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
              <button type="button" onClick={() => setNav("growth")}>
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
                      setNav("growth");
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

        <section className="mtoday-card" aria-label="今日时段">
          <div className="mtoday-shead">
            <h3>今日时段</h3>
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
              {bands.length ? (
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

        <section className="mtoday-card" aria-label="今日事项">
          <div className="mtoday-shead">
            <h3>今日事项</h3>
            <button type="button" onClick={() => setNav("today")}>
              查看全部 ›
            </button>
          </div>
          {todaysTasks.length ? (
            <ul className="mtoday-list">
              {todaysTasks.map((task) => {
                const done = task.status === "completed";
                const pills = getMobileTaskPills(task, projects, tags, tagMap);
                return (
                  <MobileTaskRow
                    key={task.id}
                    className={`mtoday-row pr${task.priority}${done ? " is-done" : ""}`}
                    onActivate={() => selectTask(task.id)}
                    onLongPress={() => setSheetTask(task)}
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
                      {pills.length ? (
                        <span className="mtoday-pills">
                          {pills.map((pill) => (
                            <MobileTaskPillView key={pill.key} pill={pill} />
                          ))}
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
              今天还没有截止的任务。新建任务并把截止日期设为今天即可。
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

      {sheetTask ? (
        <TaskActionSheet
          task={sheetTask}
          cursor={today}
          onClose={() => setSheetTask(null)}
        />
      ) : null}
    </div>
  );
}
