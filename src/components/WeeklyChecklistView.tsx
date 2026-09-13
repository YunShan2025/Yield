import { useMemo, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import {
  buildWeekBuckets,
  categoryColor,
  mondayWeekDates,
  resolveCategoryId,
  shiftWeek,
  weekdayShort,
  type WeeklyCategoryId,
} from "@/lib/weeklyChecklist";

function formatMd(date: string) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function WeeklyChecklistView() {
  const tasks = useAppStore((s) => s.tasks);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const calendarCursor = useAppStore((s) => s.calendarCursor);
  const setCalendarCursor = useAppStore((s) => s.setCalendarCursor);
  const setNav = useAppStore((s) => s.setNav);
  const setDateScope = useAppStore((s) => s.setDateScope);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const selectTask = useAppStore((s) => s.selectTask);
  const today = todayDateString();

  const weekDates = useMemo(
    () => mondayWeekDates(calendarCursor || today),
    [calendarCursor, today],
  );
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const { days, categories, stats } = useMemo(
    () => buildWeekBuckets(tasks, weekDates, tagMap, tags),
    [tasks, weekDates, tagMap, tags],
  );

  const donePct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  const goalLine = (id: WeeklyCategoryId) => {
    const bucket = categories.find((item) => item.category.id === id);
    if (!bucket || bucket.total === 0) return "本周暂无任务";
    const active = bucket.tasks.find((task) => task.status !== "completed");
    return active?.title ?? "本周目标已完成";
  };

  return (
    <main className="main-workspace weekly-checklist">
      <div className="workspace-top weekly-checklist-top">
        <div>
          <h2>周清单</h2>
          <p className="workspace-subtitle">
            {weekStart} ～ {weekEnd} · 给这一周定下目标，完成一件划掉一件。
          </p>
        </div>
        <div className="top-controls weekly-checklist-nav">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCalendarCursor(shiftWeek(weekStart, -1))}
          >
            ‹ 上周
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCalendarCursor(today)}
          >
            本周
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setCalendarCursor(shiftWeek(weekStart, 1))}
          >
            下周 ›
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setNav("today");
              setDateScope("week");
            }}
          >
            打开周历
          </button>
        </div>
      </div>

      {/* 与「今日」同款的暖色引导框。 */}
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
          <span className="today-eyebrow">积微 · 周清单</span>
          <h3>把一周摊开来看。</h3>
          <p className="today-hero-note">本周目标按标签聚合，周日历逐天盘点；点任务直达详情，完成进度一眼见底。</p>
        </div>
      </section>

      <section className="weekly-goals" aria-label="本周目标">
        <h3>本周目标</h3>
        <div className="weekly-goal-grid">
          {categories.map((bucket) => (
            <article
              key={bucket.category.id}
              className="weekly-goal-card"
              style={{ "--goal-accent": bucket.category.color } as CSSProperties}
            >
              <header>
                <strong>{bucket.category.label}</strong>
                <span>
                  {bucket.done}/{bucket.total}
                </span>
              </header>
              <p>{goalLine(bucket.category.id)}</p>
              <div className="weekly-goal-bar">
                <i style={{ width: `${bucket.progress}%` }} />
              </div>
              <footer>{bucket.total} 项 · {bucket.progress}%</footer>
            </article>
          ))}
        </div>
      </section>

      <section className="weekly-days" aria-label="当周日历">
        <h3>当周日历</h3>
        <div className="weekly-day-grid">
          {days.map((day) => (
            <div
              key={day.date}
              className={`weekly-day-col ${day.date === today ? "is-today" : ""}`}
            >
              <header>
                <strong>周{weekdayShort(day.date)}</strong>
                <span>
                  {day.done}/{day.total}
                </span>
                <div className="weekly-day-meta">
                  <em>{formatMd(day.date)}</em>
                  <div className="weekly-day-bar">
                    <i
                      style={{
                        width: `${day.total ? Math.round((day.done / day.total) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </header>
              <ul>
                {day.tasks.length === 0 ? (
                  <li className="weekly-day-empty">空闲</li>
                ) : (
                  day.tasks.slice(0, 8).map((task) => {
                    const cat = resolveCategoryId(task.id, tagMap, tags);
                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          className={`weekly-day-task ${task.status === "completed" ? "is-done" : ""}`}
                          onClick={() => selectTask(task.id)}
                        >
                          <span
                            className="weekly-dot"
                            style={{ background: categoryColor(cat) }}
                          />
                          <span className="weekly-day-title">{task.title}</span>
                          <span
                            className="weekly-day-check"
                            role="checkbox"
                            aria-checked={task.status === "completed"}
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleComplete(task.id);
                            }}
                          >
                            {task.status === "completed" ? "✓" : "○"}
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="weekly-stat-strip" aria-label="当周概览">
        <div className="weekly-stat-track">
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">本周事项</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{stats.total}</strong>
            </div>
          </div>
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">已完成</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num is-accent">{stats.done}</strong>
            </div>
          </div>
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">剩余</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{stats.remaining}</strong>
            </div>
          </div>
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">峰值日</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">
                {stats.peakDay ? `周${weekdayShort(stats.peakDay)}` : "—"}
              </strong>
              <span className="weekly-stat-note">
                {stats.peakDay ? `${stats.peakDone}/${stats.peakTotal} 项` : "本周暂无安排"}
              </span>
            </div>
          </div>
        </div>
        <div className="weekly-stat-bar">
          <div
            className="weekly-stat-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={donePct}
            aria-label="本周完成率"
          >
            <i style={{ width: `${donePct}%` }} />
          </div>
          <span className="weekly-stat-pct">完成率 {donePct}%</span>
        </div>
      </section>
    </main>
  );
}
