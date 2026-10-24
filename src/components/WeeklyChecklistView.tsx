import { useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { currentDateStreak } from "@/lib/growth";
import {
  buildWeekBuckets,
  categoryColor,
  mondayWeekDates,
  resolveCategoryId,
  shiftWeek,
  weekdayShort,
  type WeeklyCategoryId,
} from "@/lib/weeklyChecklist";
import { useTodayDate } from "@/lib/useTodayDate";
import { ExpandRow } from "@/components/ExpandRow";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { MobileTaskLine } from "@/components/mobile/MobileTaskLine";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import type { Task } from "@/types";

/** 移动壳里一个分类默认只露这么多条：sunken 子面板被拉成十几条会吃满一屏。 */
const MOBILE_TASK_PREVIEW = 5;

function formatMd(date: string) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function WeeklyChecklistView() {
  const tasks = useAppStore((s) => s.tasks);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const projects = useAppStore((s) => s.projects);
  const calendarCursor = useAppStore((s) => s.calendarCursor);
  const setCalendarCursor = useAppStore((s) => s.setCalendarCursor);
  const setNav = useAppStore((s) => s.setNav);
  const setDateScope = useAppStore((s) => s.setDateScope);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const selectTask = useAppStore((s) => s.selectTask);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const today = useTodayDate();

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
  // 哪个分类展开着：点哪行就在哪行下面展开，不另起一块。
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  // 移动壳：展开的分类里默认只露前 MOBILE_TASK_PREVIEW 条，切分类回到预览。
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);

  // 周节奏放在周清单：今日页只留今天要做的事，周统计归这里。
  const weekChecks = useMemo(
    () =>
      habitChecks.filter(
        (check) => check.check_date >= weekStart && check.check_date <= weekEnd,
      ),
    [habitChecks, weekStart, weekEnd],
  );
  const streak = useMemo(() => {
    const days = new Set<string>([
      ...habitChecks.map((check) => check.check_date),
      ...tasks
        .filter(
          (task) =>
            !task.parent_id &&
            !task.deleted_at &&
            task.status === "completed" &&
            task.completed_at,
        )
        .map((task) => task.completed_at!.slice(0, 10)),
    ]);
    return currentDateStreak([...days], today);
  }, [habitChecks, tasks, today]);

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
          <h2 aria-label={isMobileShell() ? "周清单" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="周清单" /> : "周清单"}

          </h2>
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
          {!isMobileShell() ? (
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
          ) : null}
        </div>
      </div>

      {/* 与「今日」同款的暖色引导框。右侧承载本周完成进度 —— 引导块要么有数据，
          要么不出现。移动壳换数据型顶卡：大读数 + 七日周条概览（与待办顶卡同语言）。 */}
      {isMobileShell() ? (
        <MobileGuideCard
          value={stats.done}
          unit={stats.total ? `/${stats.total}` : undefined}
          label="本周已完成"
          hint={stats.total ? `完成率 ${donePct}%` : "本周暂无任务"}
          bars={days.map((day) => ({
            label: weekdayShort(day.date),
            ratio: day.total ? day.done / day.total : 0,
            isToday: day.date === today,
          }))}
        />
      ) : (
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
          <h3>把一周摊开来看。</h3>
          <p className="today-hero-note">本周目标按标签聚合，周日历逐天盘点；点任务直达详情。</p>
        </div>
        <div className="today-hero-meter">
          <span className="today-hero-meter-count">
            <strong>{stats.done}</strong>
            <span>/{stats.total}</span>
          </span>
          <span className="today-hero-meter-label">已完成</span>
          <span className="today-hero-meter-track">
            <i style={{ "--progress": `${donePct}%` } as CSSProperties} />
          </span>
        </div>
      </section>
      )}

      {/* 本周任务：按分类聚合，一行一条。点行就地展开这一类的任务 —— 分类是「按标签
          分组」的口径，当周日历是「按天」的口径，两个视角不重复。 */}
      <section className="weekly-goals" aria-label="本周任务">
        <h3>本周任务</h3>
        <div className="weekly-goal-list">
          {categories.map((bucket) => {
            const on = expandedCategory === bucket.category.id;
            const visibleTasks =
              isMobileShell() && !showAllTasks
                ? bucket.tasks.slice(0, MOBILE_TASK_PREVIEW)
                : bucket.tasks;
            return (
              <ExpandRow
                key={bucket.category.id}
                open={on}
                className={
                  bucket.total && bucket.done === bucket.total ? "is-clear" : undefined
                }
                onToggle={() => {
                  setShowAllTasks(false);
                  setExpandedCategory(on ? null : bucket.category.id);
                }}
                accent={bucket.category.color}
                rowId={bucket.category.id}
                dot={
                  <span
                    className="weekly-goal-dot"
                    style={{ background: bucket.category.color }}
                    aria-hidden
                  />
                }
                title={bucket.category.label}
                meta={goalLine(bucket.category.id)}
                trailing={`${bucket.done}/${bucket.total}`}
                toggleTitle={on ? "收起这一类" : "查看这一类的任务"}
              >
                {bucket.tasks.length ? (
                  isMobileShell() ? (
                    /* 移动壳：与今日/待办同一行件。分类是「四类」的粗分组，行里
                       的项目 / 标签胶囊正好补上「这条到底属于哪件事」。 */
                    <ul className="mrow-list">
                      {visibleTasks.map((task) => (
                        <MobileTaskLine
                          key={task.id}
                          task={task}
                          today={today}
                          projects={projects}
                          tags={tags}
                          tagMap={tagMap}
                          doneStamp
                          onOpen={() => selectTask(task.id)}
                          onComplete={() => void toggleComplete(task.id)}
                          onMore={() => setSheetTask(task)}
                        />
                      ))}
                      {bucket.tasks.length > MOBILE_TASK_PREVIEW ? (
                        <li>
                          <button
                            type="button"
                            className="mrow-toggle"
                            onClick={() => setShowAllTasks((value) => !value)}
                          >
                            {showAllTasks
                              ? "收起任务列表"
                              : `展开全部 ${bucket.tasks.length} 项`}
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <div className="weekly-goal-tasks">
                      {bucket.tasks.map((task) => (
                        <button
                          key={task.id}
                          type="button"
                          className={`weekly-goal-task${task.status === "completed" ? " is-done" : ""}`}
                          onClick={() => selectTask(task.id)}
                        >
                          <span className="weekly-goal-task-state" aria-hidden>
                            {task.status === "completed" ? "✓" : "○"}
                          </span>
                          <span className="weekly-goal-task-title">{task.title}</span>
                          {task.due_date ? (
                            <span className="weekly-goal-task-due">{task.due_date.slice(5)}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="expand-row-empty">这一类本周没有任务。</p>
                )}
              </ExpandRow>
            );
          })}
        </div>
      </section>

      <section className="weekly-days" aria-label="当周日历">
        <h3>当周日历</h3>
        <div className="weekly-day-grid">
          {days.map((day) => (
            <div
              key={day.date}
              className={`weekly-day-col ${day.date === today ? "is-today" : ""}${
                day.total && day.done === day.total ? " is-clear" : ""
              }`}
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
              {isMobileShell() ? (
                /* 移动壳：day 变体——那一列本身就是日期，不再挂日期药丸；
                   行首分类色点保留（这一列里唯一的分组线索）。 */
                <ul className="mrow-list">
                  {day.tasks.length === 0 ? (
                    <li className="weekly-day-empty">空闲</li>
                  ) : (
                    day.tasks.slice(0, 8).map((task) => (
                      <MobileTaskLine
                        key={task.id}
                        task={task}
                        today={today}
                        projects={projects}
                        tags={tags}
                        tagMap={tagMap}
                        variant="day"
                        dotColor={categoryColor(
                          resolveCategoryId(task.id, tagMap, tags),
                        )}
                        onOpen={() => selectTask(task.id)}
                        onComplete={() => void toggleComplete(task.id)}
                        onMore={() => setSheetTask(task)}
                      />
                    ))
                  )}
                </ul>
              ) : (
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
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 当周概览降级为一行元信息：本周事项 / 已完成 / 剩余与引导块的进度重复，
          完成率条也重复，统统去掉。留下的三项都与「本周」口径不同。 */}
      <section className="weekly-stat-strip" aria-label="当周概览">
        <div className="weekly-stat-track">
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">习惯打卡</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{weekChecks.length}</strong>
              <span className="weekly-stat-note">次</span>
            </div>
          </div>
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">当前连续</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{streak}</strong>
              <span className="weekly-stat-note">天</span>
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
      </section>

      {sheetTask ? (
        <TaskActionSheet
          task={sheetTask}
          cursor={today}
          onClose={() => setSheetTask(null)}
        />
      ) : null}
    </main>
  );
}
