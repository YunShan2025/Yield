import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { fetchGoalEntries, fetchGoals } from "@/lib/db";
import { todayDateString } from "@/lib/dates";
import type { Goal, GoalEntry } from "@/types";
import { localDateKey } from "@/lib/growth";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import {
  aggregateReviewByGoal,
  aggregateReviewByProject,
  aggregateReviewByTag,
  computeWeekReviewMetrics,
  type ReviewDimension,
} from "@/lib/review";
import {
  countFullDays,
  mondayWeekDates,
  shiftWeek,
} from "@/lib/weeklyChecklist";

export function ReviewView() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [anchor, setAnchor] = useState(() => todayDateString());
  const [dimension, setDimension] = useState<ReviewDimension>("goal");

  // 复盘页读目标与目标记录两份页内数据，同步拉回对端写入后要重载。
  useEffect(() => {
    const reload = () =>
      void Promise.all([fetchGoals(true), fetchGoalEntries()]).then(
        ([nextGoals, nextEntries]) => {
          setGoals(nextGoals);
          setGoalEntries(nextEntries);
        },
      );
    reload();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
  }, []);

  const weekDates = useMemo(() => mondayWeekDates(anchor), [anchor]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const breakdown = useMemo(() => {
    if (dimension === "project") {
      return aggregateReviewByProject(tasks, weekDates, projects);
    }
    if (dimension === "tag") {
      return aggregateReviewByTag(tasks, weekDates, tags, tagMap);
    }
    return aggregateReviewByGoal(tasks, weekDates, goals);
  }, [dimension, goals, projects, tagMap, tags, tasks, weekDates]);

  const stats = useMemo(() => {
    // 新增/完成都按当日计，已删除的任务不计入。
    const created = weekDates.map(
      (d) =>
        tasks.filter(
          (t) => !t.parent_id && !t.deleted_at && localDateKey(new Date(t.created_at)) === d,
        ).length,
    );
    const completed = weekDates.map(
      (d) =>
        tasks.filter(
          (t) =>
            !t.parent_id &&
            !t.deleted_at &&
            t.completed_at &&
            localDateKey(new Date(t.completed_at)) === d,
        ).length,
    );
    const weekMetrics = computeWeekReviewMetrics(tasks, weekDates);

    return {
      created,
      completed,
      ...weekMetrics,
      fullDays: countFullDays(tasks, weekDates),
      max: Math.max(1, ...created, ...completed),
    };
  }, [tasks, weekDates]);

  const weekCreated = stats.created.reduce((sum, value) => sum + value, 0);
  const weekCompleted = stats.completed.reduce((sum, value) => sum + value, 0);
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const weekday = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", { weekday: "short" });

  return (
    <main className="main-workspace review-workspace">
      {/* 与「今日」同构的标题区:h2 标题 + 副标题(含当周区间),右侧为周切换与完成数。 */}
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "复盘" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="复盘" /> : "复盘"}

          </h2>
          <p className="workspace-subtitle">{weekStart} ～ {weekEnd} · 不只看完成了多少，也看看精力落在哪里。</p>
        </div>
        <div className="top-controls">
          <div className="review-hero-total"><strong>{weekCompleted}</strong><span>件事情完成</span></div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setAnchor(shiftWeek(weekStart, -1))}
          >
            ‹ 上周
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setAnchor(todayDateString())}
          >
            本周
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setAnchor(shiftWeek(weekStart, 1))}
          >
            下周 ›
          </button>
        </div>
      </div>

      {/* 与「今日」同款的暖色引导框。 */}
      {/* 与「今日」同款的暖色引导框。移动壳不出现：页头已有「N 件事情完成」
          读数与摘要指标，格言卡属于桌面内容。 */}
      {isMobileShell() ? null : (
        <section className="today-hero guide-hero">
          <div className="today-hero-copy">
            <h3>回头看，是为了走得更稳。</h3>
          </div>
        </section>
      )}

      <div className="review-body">
      <section className="review-metrics" aria-label="本周摘要">
        <article><span>本周完成率</span><strong>{stats.rate}%</strong><small>本周 {stats.done}/{stats.total} 项已完成</small></article>
        <article><span>本周高效时段</span><strong>{stats.peakHour === null ? "—" : `${stats.peakHour}:00`}</strong><small>{stats.peakHour === null ? "本周还没有完成记录" : "本周最常完成任务的时间"}</small></article>
        <article><span>满勤天数</span><strong>{stats.fullDays}</strong><small>本周中当日事项全部完成的天数</small></article>
      </section>

      <div className="review-main-grid">
        <section className="review-story-card review-rhythm">
          <div className="review-section-head"><div><span>当周节奏</span><h3>新计划与完成情况</h3></div><div className="review-chart-legend"><i className="is-created" />新增 {weekCreated}<i className="is-completed" />完成 {weekCompleted}</div></div>
          <div className="review-rhythm-chart">
            {weekDates.map((day, i) => <div className="review-day" key={day} title={`${day} · 新增 ${stats.created[i]} · 完成 ${stats.completed[i]}`}>
              <div className="review-bar-pair"><i className="is-created" style={{ height: `${Math.max(5, (stats.created[i] / stats.max) * 100)}%` }} /><i className="is-completed" style={{ height: `${Math.max(5, (stats.completed[i] / stats.max) * 100)}%` }} /></div>
              <strong>{weekday(day)}</strong><span>{day.slice(5).replace("-", "/")}</span>
            </div>)}
          </div>
        </section>

        <section className="review-story-card review-goals">
          <div className="review-section-head"><div><span>长期方向</span><h3>当周目标推进</h3></div><b>{activeGoals.length}</b></div>
        <div className="review-goal-list">
          {activeGoals.map((goal) => {
            const weekEntries = goalEntries
              .filter(
                (entry) =>
                  entry.goal_id === goal.id &&
                  entry.entry_date >= weekStart &&
                  entry.entry_date <= weekEnd,
              )
              .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
            // 数值变化型目标的记录是绝对测量值，累加没有意义：当周显示最新一次测量。
            const isMeasure = goal.goal_type === "measure";
            const value = isMeasure
              ? Number(weekEntries[weekEntries.length - 1]?.value ?? goal.current_value)
              : weekEntries.reduce((sum, entry) => sum + Number(entry.value), 0);
            const fromTask = weekEntries
              .filter((entry) => entry.source_type === "task")
              .reduce((sum, entry) => sum + Number(entry.value), 0);
            const fromHabit = weekEntries
              .filter((entry) => entry.source_type === "habit")
              .reduce((sum, entry) => sum + Number(entry.value), 0);
            const fromManual = weekEntries
              .filter((entry) => entry.source_type === "manual")
              .reduce((sum, entry) => sum + Number(entry.value), 0);
            const parts = [
              fromTask ? `任务 +${Math.round(fromTask * 10) / 10}` : "",
              fromHabit ? `打卡 +${Math.round(fromHabit * 10) / 10}` : "",
              fromManual
                ? `记录 ${fromManual > 0 ? "+" : ""}${Math.round(fromManual * 10) / 10}`
                : "",
            ].filter(Boolean);
            return (
              <div key={goal.id} className="review-goal-row">
                <i style={{ background: goal.color }} />
                <span>
                  {goal.title}
                  {parts.length ? (
                    <em className="review-goal-source">{parts.join(" · ")}</em>
                  ) : null}
                </span>
                <strong>
                  {isMeasure ? "现值 " : ""}
                  {Math.round(value * 10) / 10}{goal.unit}
                </strong>
              </div>
            );
          })}
          {!activeGoals.length ? <p className="review-soft-empty">暂无进行中的长期目标。</p> : null}
        </div>
        </section>
      </div>

      <section className="review-story-card review-breakdown">
        <div className="review-section-head">
          <div>
            <span>当周完成的任务</span>
            <h3>任务完成去向</h3>
          </div>
          <div className="review-dimension-tabs" role="tablist" aria-label="聚合维度">
            {(
              [
                ["goal", "按目标"],
                ["project", "按项目"],
                ["tag", "按标签"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={dimension === value}
                className={dimension === value ? "is-active" : ""}
                onClick={() => setDimension(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="review-breakdown-list">
          {breakdown.map((group) => (
            <div key={group.key} className="review-breakdown-row">
              <div className="review-breakdown-label">
                <i style={group.color ? { background: group.color } : undefined} />
                <span>{group.label}</span>
              </div>
              <div
                className="review-breakdown-track"
                title={`完成 ${group.done}/${group.total}`}
              >
                <i style={{ width: `${group.rate}%` }} />
              </div>
              <strong>{group.done}/{group.total}</strong>
            </div>
          ))}
          {!breakdown.length ? (
            <p className="review-soft-empty">本周还没有可聚合的任务。</p>
          ) : null}
        </div>
      </section>
      </div>
    </main>
  );
}
