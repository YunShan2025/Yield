import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { fetchGoalEntries, fetchGoals } from "@/lib/db";
import { todayDateString } from "@/lib/dates";
import type { Goal, GoalEntry } from "@/types";
import { localDateKey } from "@/lib/growth";
import { countFullDays, mondayWeekDates, shiftWeek } from "@/lib/weeklyChecklist";

export function ReviewView() {
  const tasks = useAppStore((s) => s.tasks);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [anchor, setAnchor] = useState(() => todayDateString());

  useEffect(() => {
    void Promise.all([fetchGoals(), fetchGoalEntries()]).then(([nextGoals, nextEntries]) => {
      setGoals(nextGoals);
      setGoalEntries(nextEntries);
    });
  }, []);

  const weekDates = useMemo(() => mondayWeekDates(anchor), [anchor]);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

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
    const roots = tasks.filter((t) => !t.parent_id);
    const done = roots.filter((t) => t.status === "completed").length;
    const rate = roots.length ? Math.round((done / roots.length) * 100) : 0;
    const delayed = roots.filter(
      (t) =>
        t.status === "completed" &&
        t.due_date &&
        t.completed_at &&
        localDateKey(new Date(t.completed_at)) > t.due_date,
    ).length;
    const delayRate = done ? Math.round((delayed / done) * 100) : 0;

    const hours = Array.from({ length: 24 }, () => 0);
    for (const t of roots) {
      if (!t.completed_at) continue;
      const h = new Date(t.completed_at).getHours();
      hours[h] += 1;
    }
    const peak = hours.indexOf(Math.max(...hours));

    return {
      created,
      completed,
      rate,
      delayRate,
      peak,
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
          <h2>复盘</h2>
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
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
          <span className="today-eyebrow">有恒 · 复盘</span>
          <h3>回头看，是为了走得更稳。</h3>
          <p className="today-hero-note">完成率、高效时段与满勤天数，每周回望一次，节奏自然浮现。</p>
        </div>
      </section>

      <div className="review-body">
      <section className="review-metrics" aria-label="本周摘要">
        <article><span>整体完成率</span><strong>{stats.rate}%</strong><small>全部任务累计表现</small></article>
        <article><span>延期完成</span><strong>{stats.delayRate}%</strong><small>{stats.delayRate ? "可以留意计划余量" : "节奏保持得很好"}</small></article>
        <article><span>高效时段</span><strong>{stats.peak}:00</strong><small>最常完成任务的时间</small></article>
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
          <div className="review-section-head"><div><span>长期方向</span><h3>长期目标投入</h3></div><b>{activeGoals.length}</b></div>
        <div className="review-goal-list">
          {activeGoals.map((goal) => {
            const value = goalEntries
              .filter(
                (entry) =>
                  entry.goal_id === goal.id &&
                  entry.entry_date >= weekStart &&
                  entry.entry_date <= weekEnd,
              )
              .reduce((sum, entry) => sum + Number(entry.value), 0);
            return (
              <div key={goal.id} className="review-goal-row">
                <i style={{ background: goal.color }} />
                <span>{goal.title}</span>
                <strong>{Math.round(value * 10) / 10}{goal.unit}</strong>
              </div>
            );
          })}
          {!activeGoals.length ? <p className="review-soft-empty">暂无进行中的长期目标。</p> : null}
        </div>
        </section>
      </div>
      </div>
    </main>
  );
}
