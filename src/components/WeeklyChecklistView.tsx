import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { fetchGoalEntries, fetchGoals } from "@/lib/db";
import { currentDateStreak } from "@/lib/growth";
import {
  buildWeekBuckets,
  categoryColor,
  countFullDays,
  mondayWeekDates,
  resolveCategoryId,
  shiftWeek,
  weekdayShort,
} from "@/lib/weeklyChecklist";
import {
  aggregateReviewByGoal,
  aggregateReviewByProject,
  aggregateReviewByTag,
  type ReviewDimension,
} from "@/lib/review";
import { useTodayDate } from "@/lib/useTodayDate";
import { useGoals } from "@/lib/useGoals";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { getMobileTaskPills } from "@/components/mobile/MobileTaskPills";
import { MobileTaskLine } from "@/components/mobile/MobileTaskLine";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import type { Goal, GoalEntry, Task } from "@/types";

/** 桌面脉搏图详情：一天最多露这么多条，溢出折叠成「还有 N 项」。 */
const PULSE_TASK_PREVIEW = 10;

/* 脉搏图几何（viewBox 单位）：高 136 与 .wp-lines 的固定高度 1:1，dot 才能用
   py() 的像素值直接落位；x 是 0-100 随容器拉伸，描边吃 non-scaling-stroke。
   顶部留 28 单位：峰值标签（-26 偏移）要悬在峰点上方而不被卡片裁掉；
   基线以下留 18（2026-10-27 收紧，账本半年走向同口径）。 */
const PULSE_PLOT_TOP = 28;
const PULSE_PLOT_BASE = 118;
const PULSE_PLOT_H = 136;

function formatMd(date: string) {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 完成时刻小注：ISO 时间戳 → 本地「HH:mm」。入库值可能带时区，不能直接 slice。 */
function formatCompletedAt(iso: string | null): string | null {
  if (!iso) return null;
  const stamp = Date.parse(iso);
  if (Number.isNaN(stamp)) return null;
  const d = new Date(stamp);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WeeklyChecklistView() {
  const tasks = useAppStore((s) => s.tasks);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const projects = useAppStore((s) => s.projects);
  const calendarCursor = useAppStore((s) => s.calendarCursor);
  const setCalendarCursor = useAppStore((s) => s.setCalendarCursor);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const selectTask = useAppStore((s) => s.selectTask);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const today = useTodayDate();
  const { goalById } = useGoals();

  const weekDates = useMemo(
    () => mondayWeekDates(calendarCursor || today),
    [calendarCursor, today],
  );
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];

  const { days, stats } = useMemo(
    () => buildWeekBuckets(tasks, weekDates, tagMap, tags),
    [tasks, weekDates, tagMap, tags],
  );

  const donePct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  // 当周目标推进读目标与目标记录两份页内数据（自复盘页并入），同步拉回对端
  // 写入后要重载。
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalEntries, setGoalEntries] = useState<GoalEntry[]>([]);
  const [dimension, setDimension] = useState<ReviewDimension>("goal");
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

  // 任务完成去向：按目标/项目/标签三视角聚合（自复盘页并入，口径同 isTaskInWeek）。
  // 「去向」只讲完成：有任务但零完成的组滤掉，不摆 0% 的空白横条占位。
  const breakdown = useMemo(() => {
    const groups =
      dimension === "project"
        ? aggregateReviewByProject(tasks, weekDates, projects)
        : dimension === "tag"
          ? aggregateReviewByTag(tasks, weekDates, tags, tagMap)
          : aggregateReviewByGoal(tasks, weekDates, goals);
    return groups.filter((group) => group.done > 0);
  }, [dimension, goals, projects, tagMap, tags, tasks, weekDates]);
  const fullDays = useMemo(() => countFullDays(tasks, weekDates), [tasks, weekDates]);
  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  // 当周日历（桌面脉搏图）点选的日期。null = 回退默认：今天 → 峰值日 → 周一；
  // 切周后 pulseDate 不在这一周里，自动落回默认，不用 effect 重置。
  const [pulseDate, setPulseDate] = useState<string | null>(null);

  const selectedPulseDate = weekDates.includes(pulseDate ?? "")
    ? (pulseDate as string)
    : weekDates.includes(today)
      ? today
      : (stats.peakDay ?? weekDates[0]);
  const selectedPulseDay = days[weekDates.indexOf(selectedPulseDate)];

  // 折线坐标：x 七天均分（与 .wp-days 的 7 个 flex 列同一套中心线），
  // y 按实际峰值定标（下限 1，与账本脉搏同口径）：峰值日总是顶到画满，
  // 轻任务周不再被 max(4,…) 地板压成贴地一线（2026-10-27：空白率高=读不到形状）。
  const pulseMax = Math.max(1, ...days.map((day) => day.total));
  const pulseX = (index: number) => ((index + 0.5) / 7) * 100;
  const pulseY = (value: number) =>
    PULSE_PLOT_BASE - (value / pulseMax) * (PULSE_PLOT_BASE - PULSE_PLOT_TOP);
  const pulsePoints = (values: number[]) =>
    values.map((value, index) => `${pulseX(index).toFixed(2)},${pulseY(value).toFixed(1)}`);
  const pulseArea = (values: number[]) =>
    `M ${pulseX(0).toFixed(2)},${PULSE_PLOT_BASE} L ${pulsePoints(values).join(
      " L ",
    )} L ${pulseX(6).toFixed(2)},${PULSE_PLOT_BASE} Z`;
  const pulseTotals = days.map((day) => day.total);
  const pulseDones = days.map((day) => day.done);

  // 周节奏放在本周页：今日页只留今天要做的事，周统计归这里。
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

  return (
    <main className="main-workspace weekly-checklist">
      <div className="workspace-top weekly-checklist-top">
        <div>
          <h2 aria-label={isMobileShell() ? "本周" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="本周" /> : "本周"}

          </h2>
          <p className="workspace-subtitle">把一周摊开来看。</p>
        </div>
        <div className="top-controls weekly-checklist-nav scope-nav">
          <strong>
            {formatMd(weekStart)} ～ {formatMd(weekEnd)}
          </strong>
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
          <p className="today-hero-note">给这一周定下目标，完成一件划掉一件。</p>
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

      {/* 当周概览放在列表之前：这几项是这一周的节奏（打卡、连续、峰值、满勤），
          先给一眼再进日历。完成率归引导块（大读数 + 细轨），这里不再重复；
          成就数（连续/峰值/满勤）描金。桌面账目列，移动壳折成读数格。 */}
      <section className="weekly-stat-strip" aria-label="当周概览">
        <div className="weekly-stat-track">
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">习惯打卡</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{weekChecks.length}</strong>
              <span className="weekly-stat-note">次</span>
            </div>
          </div>
          <div className="weekly-stat-item is-gold">
            <span className="weekly-stat-label">当前连续</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{streak}</strong>
              <span className="weekly-stat-note">天</span>
            </div>
          </div>
          <div className="weekly-stat-item is-gold">
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
          <div className="weekly-stat-item is-gold">
            <span className="weekly-stat-label">满勤天数</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{fullDays}</strong>
              <span className="weekly-stat-note">天全清</span>
            </div>
          </div>
        </div>
      </section>

      <section className="weekly-days" aria-label="当周日历">
        <h3>当周日历</h3>
        {isMobileShell() ? (
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
                {/* 移动壳：day 变体——那一列本身就是日期，不再挂日期药丸；行首分类色点
                    保留（这一列里唯一的分组线索），归属与目标照今日页的形式给全。 */}
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
                        goalById={goalById}
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
              </div>
            ))}
          </div>
        ) : (
          /* 桌面：周脉搏——七天从「七列清单」折成一条形状。蓝线=任务量、金线=已完成，
             金面积咬住蓝面积的那天就是整天清空；七天是真实的整列按钮，点一天在下方
             展开当天任务（行件与完成金底沿用本轮桌面口径）。 */
          <div className="weekly-pulse">
            <div className="wp-plot">
              <svg
                className="wp-lines"
                viewBox={`0 0 100 ${PULSE_PLOT_H}`}
                preserveAspectRatio="none"
                aria-hidden
              >
                <line
                  x1="0"
                  y1={PULSE_PLOT_BASE}
                  x2="100"
                  y2={PULSE_PLOT_BASE}
                  className="wp-baseline"
                  vectorEffect="non-scaling-stroke"
                />
                {stats.total ? (
                  <>
                    <path d={pulseArea(pulseTotals)} className="wp-area wp-area-total" />
                    {stats.done ? (
                      <path d={pulseArea(pulseDones)} className="wp-area wp-area-done" />
                    ) : null}
                    <polyline
                      points={pulsePoints(pulseTotals).join(" ")}
                      className="wp-line wp-line-total"
                      vectorEffect="non-scaling-stroke"
                    />
                    {stats.done ? (
                      <polyline
                        points={pulsePoints(pulseDones).join(" ")}
                        className="wp-line wp-line-done"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                  </>
                ) : null}
              </svg>
              {stats.peakDay && stats.peakTotal >= 2 ? (
                <span
                  className="wp-peak"
                  style={{
                    left: `${pulseX(weekDates.indexOf(stats.peakDay))}%`,
                    top: pulseY(stats.peakTotal) - 26,
                  }}
                >
                  {stats.peakTotal} 项 · 峰值
                </span>
              ) : null}
              <div className="wp-days">
                {days.map((day) => {
                  const clear = day.total > 0 && day.done === day.total;
                  const isToday = day.date === today;
                  const sel = day.date === selectedPulseDate;
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={`wp-day${sel ? " is-sel" : ""}`}
                      aria-pressed={sel}
                      aria-label={`周${weekdayShort(day.date)} ${formatMd(day.date)}：${
                        day.total ? `${day.done}/${day.total} 项已完成` : "空闲"
                      }`}
                      onClick={() => setPulseDate(day.date)}
                    >
                      <span
                        className={`wp-dot${day.total ? "" : " is-zero"}${
                          clear ? " is-clear" : ""
                        }`}
                        style={{ top: pulseY(day.total) }}
                      />
                      <span className="wp-x">
                        <b className={isToday ? "is-today" : undefined}>
                          {isToday ? "今天" : `周${weekdayShort(day.date)}`}
                        </b>
                        <span className="wp-xdate">{formatMd(day.date)}</span>
                        <span
                          className={`wp-xcount${clear ? " is-clear" : ""}${
                            day.total ? "" : " is-none"
                          }`}
                        >
                          {day.total ? `${day.done}/${day.total}` : "—"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="wp-legend">
              <span className="wp-key">
                <i className="wp-key-line wp-key-total" aria-hidden />
                任务量
              </span>
              <span className="wp-key">
                <i className="wp-key-line wp-key-done" aria-hidden />
                已完成
              </span>
              <span className="wp-legend-hint">计数描金＝整天清空 · 点一天看当天任务</span>
            </p>
            <div className="weekly-pulse-detail">
              <header>
                <strong>
                  周{weekdayShort(selectedPulseDate)} · {formatMd(selectedPulseDate)}
                </strong>
                {selectedPulseDate === today ? <span className="wp-chip">今天</span> : null}
                {stats.peakDay === selectedPulseDate && selectedPulseDay.total > 0 ? (
                  <span className="wp-chip wp-chip-gold">峰值日</span>
                ) : null}
                <span
                  className={`wp-d-count${
                    selectedPulseDay.total &&
                    selectedPulseDay.done === selectedPulseDay.total
                      ? " is-clear"
                      : ""
                  }`}
                >
                  {selectedPulseDay.total
                    ? `${selectedPulseDay.done}/${selectedPulseDay.total} 项已完成`
                    : "这一天还空着"}
                </span>
              </header>
              <ul className="weekly-pulse-list">
                {selectedPulseDay.tasks.length === 0 ? (
                  <li className="weekly-day-empty">空闲</li>
                ) : (
                  selectedPulseDay.tasks.slice(0, PULSE_TASK_PREVIEW).map((task) => {
                    const cat = resolveCategoryId(task.id, tagMap, tags);
                    const done = task.status === "completed";
                    const stamp = done ? formatCompletedAt(task.completed_at) : null;
                    // 徽标行照移动 day 变体与同页本周任务同一口径：归属胶囊 + 目标徽标，
                    // 完成时刻走 done-chip（HH:mm 完成）；选中日就是日期上下文,不发日期语气。
                    const pills = getMobileTaskPills(task, projects, tags, tagMap);
                    const goal = task.goal_id ? goalById.get(task.goal_id) ?? null : null;
                    return (
                      <li
                        key={task.id}
                        className={`weekly-day-task${done ? " is-done" : ""}`}
                      >
                        <button
                          type="button"
                          className="weekly-day-open"
                          onClick={() => selectTask(task.id)}
                        >
                          <i
                            className="weekly-dot"
                            style={{ background: categoryColor(cat) }}
                            aria-hidden
                          />
                          <span className="weekly-day-main">
                            <span className="weekly-day-title">{task.title}</span>
                            {pills.length || goal || stamp ? (
                              <span className="weekly-day-task-meta">
                                {pills.map((pill) => (
                                  <span
                                    key={pill.key}
                                    className="task-pill"
                                    style={{ "--pill-color": pill.color } as CSSProperties}
                                  >
                                    {pill.name}
                                  </span>
                                ))}
                                {goal ? (
                                  <span
                                    className="goal-chip"
                                    style={{ "--goal-color": goal.color } as CSSProperties}
                                  >
                                    {goal.title}
                                  </span>
                                ) : null}
                                {stamp ? <span className="done-chip">{stamp} 完成</span> : null}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="weekly-day-check"
                          aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
                          aria-pressed={done}
                          onClick={() => void toggleComplete(task.id)}
                        />
                      </li>
                    );
                  })
                )}
                {selectedPulseDay.tasks.length > PULSE_TASK_PREVIEW ? (
                  <li className="weekly-day-more">
                    还有 {selectedPulseDay.tasks.length - PULSE_TASK_PREVIEW} 项
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        )}
      </section>

      {/* 回顾两块（自复盘页并入）：先看这一周完成了什么的去向，再看长期方向的推进。 */}
      <div className="weekly-review">
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
              <p className="review-soft-empty">本周还没有完成的任务。</p>
            ) : null}
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
              const value = weekEntries.reduce((sum, entry) => sum + Number(entry.value), 0);
              const fromTask = weekEntries
                .filter((entry) => entry.source_type === "task")
                .reduce((sum, entry) => sum + Number(entry.value), 0);
              const fromHabit = weekEntries
                .filter((entry) => entry.source_type === "habit")
                .reduce((sum, entry) => sum + Number(entry.value), 0);
              const parts = [
                fromTask ? `任务 +${Math.round(fromTask * 10) / 10}` : "",
                fromHabit ? `打卡 +${Math.round(fromHabit * 10) / 10}` : "",
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
                    +{Math.round(value * 10) / 10}{goal.unit}
                  </strong>
                </div>
              );
            })}
            {!activeGoals.length ? <p className="review-soft-empty">暂无进行中的长期目标。</p> : null}
          </div>
        </section>
      </div>

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
