import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Goal, Task } from "@/types";
import { fetchGoals } from "@/lib/db";
import { useAppStore } from "@/store/app";
import { formatIsoTime, todayDateString } from "@/lib/dates";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { getMobileTaskPills } from "@/components/mobile/MobileTaskPills";
import { MobileTaskLine } from "@/components/mobile/MobileTaskLine";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { categoryColor, resolveCategoryId } from "@/lib/weeklyChecklist";
import {
  activityLevelFromValue,
  currentDateStreak,
  localDateKey,
  longestDateStreak,
} from "@/lib/growth";

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayRange() {
  // 最近半年：26 整周（周日起步）× 7 天 = 182 格，列优先排布（每列一周），
  // 桌面与手机同一数量。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - 175 - today.getDay());
  return Array.from({ length: 182 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

/* 足迹页：只看「日常行动的足迹」——完成的任务与习惯打卡，按半年热力图回看。
   目标本身的推进归「目标」页；本页不再计入任何目标手动记录（goal_entries），
   这样热力点亮、活跃/连续/累计统计与下方当日面板是同一口径：格子亮的日子，
   面板里一定有对应的任务或打卡。 */
export function FootprintView() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = todayDateString();
  const allTasks = useAppStore((state) => state.tasks);
  const habits = useAppStore((state) => state.habits);
  const archivedHabits = useAppStore((state) => state.archivedHabits);
  const habitChecks = useAppStore((state) => state.habitChecks);
  // 当日明细的行件要这些：归属胶囊（项目/标签）、分类色点、目标徽标、点开详情、勾选完成。
  const tags = useAppStore((state) => state.tags);
  const tagMap = useAppStore((state) => state.tagMap);
  const projects = useAppStore((state) => state.projects);
  const selectTask = useAppStore((state) => state.selectTask);
  const toggleComplete = useAppStore((state) => state.toggleComplete);
  const toggleHabitDay = useAppStore((state) => state.toggleHabitDay);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);

  // 目标只用于当日明细行上的目标徽标（goal-chip），本页不写目标数据。
  const refresh = async () => {
    setGoals(await fetchGoals(true));
  };

  useEffect(() => {
    const reload = () => void refresh();
    void refresh();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = useMemo(dayRange, []);
  // 移动壳热力图是横向滚动容器，新容器的 scrollLeft 从 0 起步——默认看见的是
  // 半年前那几周，今天被甩在视口外。挂载时（layout 阶段，首帧前）把视口钉到
  // 最右，让今天落在右缘；桌面容器不横滚，置位无副作用。
  const heatRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = heatRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  // 完成的任务点亮热力图：按任务自身的日期（截止日）落位，而非完成时刻——
  // 补记/延后完成的任务应算在它所属的那一天。无日期的任务回退到完成时刻。
  const completedTasksByDate = useMemo(() => {
    const result = new Map<string, Task[]>();
    for (const task of allTasks) {
      if (task.parent_id || task.deleted_at) continue;
      if (task.status !== "completed") continue;
      const key =
        task.due_date ??
        (task.completed_at ? localDateKey(new Date(task.completed_at)) : null);
      if (!key) continue;
      const list = result.get(key) ?? [];
      list.push(task);
      result.set(key, list);
    }
    return result;
  }, [allTasks]);
  // 习惯打卡本身也点亮热力图：全量口径，不按目标分。
  const habitChecksByDate = useMemo(() => {
    const result = new Map<string, number>();
    for (const check of habitChecks) {
      result.set(check.check_date, (result.get(check.check_date) ?? 0) + 1);
    }
    return result;
  }, [habitChecks]);
  const habitTitleById = useMemo(
    () => new Map([...habits, ...archivedHabits].map((habit) => [habit.id, habit.title])),
    [habits, archivedHabits],
  );
  // 当日面板的习惯行：带 habit_id（行尾的打卡钮要在这一天取消/恢复打卡）。
  const habitRowsForDate = (dateKey: string) => {
    const rows: { habitId: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const check of habitChecks) {
      if (check.check_date !== dateKey || seen.has(check.habit_id)) continue;
      const title = habitTitleById.get(check.habit_id);
      if (!title) continue;
      seen.add(check.habit_id);
      rows.push({ habitId: check.habit_id, title });
    }
    return rows;
  };
  // 活跃日 = 有任务完成或习惯打卡的日子（目标记录不参与）。
  const activeDateKeys = [...new Set([
    ...habitChecksByDate.keys(),
    ...completedTasksByDate.keys(),
  ])].sort();
  const currentStreak = useMemo(
    () => currentDateStreak(activeDateKeys, todayDateString()),
    [activeDateKeys],
  );
  const longestStreak = useMemo(() => longestDateStreak(activeDateKeys), [activeDateKeys]);
  // 投入 = 行动次数（任务完成 + 习惯打卡）。
  const totalValue = useMemo(
    () =>
      [...habitChecksByDate.values()].reduce((sum, value) => sum + value, 0) +
      [...completedTasksByDate.values()].reduce((sum, list) => sum + list.length, 0),
    [habitChecksByDate, completedTasksByDate],
  );
  // 桌面顶卡讲「现在」：今天有没有动。口径与热力图同一处（完成任务 + 习惯打卡）。
  const todayInvestment =
    (completedTasksByDate.get(today) ?? []).length + (habitChecksByDate.get(today) ?? 0);
  // 热力图月份刻度：一格一列（一列一周），标在含 1 号的那一列，首列也标一次；
  // 相邻两个刻度至少隔 3 列，窄窗下才不会挤成一团。桌面才显示（CSS 门控）。
  const monthMarks = useMemo(() => {
    const marks: { col: number; label: string }[] = [];
    for (let col = 0; col * 7 < days.length; col += 1) {
      const monthStart = days.slice(col * 7, col * 7 + 7).find((date) => date.getDate() === 1);
      if (col !== 0 && !monthStart) continue;
      const prev = marks[marks.length - 1];
      if (prev && col - prev.col < 3) continue;
      marks.push({ col, label: `${(monthStart ?? days[col * 7]).getMonth() + 1}月` });
    }
    return marks;
  }, [days]);
  // 一天投了多少：任务完成 + 习惯打卡（与顶卡、热力图同一口径）。
  const valueByDate = useMemo(() => {
    const result = new Map<string, number>();
    const keys = new Set([...completedTasksByDate.keys(), ...habitChecksByDate.keys()]);
    for (const key of keys) {
      result.set(
        key,
        (completedTasksByDate.get(key) ?? []).length + (habitChecksByDate.get(key) ?? 0),
      );
    }
    return result;
  }, [completedTasksByDate, habitChecksByDate]);
  // 周柱：跟热力图共用 26 列与同一窗口，一柱一周。按峰值定标（不是均值），
  // 柱高比就是投入比；峰值给 1 兜底，一条记录都没有时也不会除出 NaN。
  const weeklyTotals = useMemo(() => {
    const weeks: { key: string; value: number; activeDays: number }[] = [];
    for (let col = 0; col * 7 < days.length; col += 1) {
      let value = 0;
      let activeDays = 0;
      for (const date of days.slice(col * 7, col * 7 + 7)) {
        const dayValue = valueByDate.get(toDateKey(date)) ?? 0;
        value += dayValue;
        if (dayValue) activeDays += 1;
      }
      weeks.push({ key: toDateKey(days[col * 7]), value, activeDays });
    }
    return weeks;
  }, [days, valueByDate]);
  const weeklyPeak = Math.max(1, ...weeklyTotals.map((week) => week.value));
  const currentWeekKey = weeklyTotals[weeklyTotals.length - 1]?.key ?? "";

  // 当日面板常驻在热力图下方。默认看今天；今天没有足迹就看最近一个活跃日。
  const defaultDate = activeDateKeys.includes(today)
    ? today
    : (activeDateKeys[activeDateKeys.length - 1] ?? today);
  const viewDate = selectedDate ?? defaultDate;
  const dayTasks = completedTasksByDate.get(viewDate) ?? [];
  const dayHabitRows = habitRowsForDate(viewDate);
  // 目标表索引：明细行的目标徽标（桌面 goal-chip / 移动 MobileGoalChip）按 id 取色与名。
  const goalById = useMemo(() => new Map(goals.map((goal) => [goal.id, goal])), [goals]);

  return (
    <div className="growth-page">
      {/* 与「今日/待办箱」同构的标题区:h2 标题 + 副标题。 */}
      <div className="workspace-top growth-top">
        <div>
          <h2 aria-label={isMobileShell() ? "足迹" : undefined}>
            {isMobileShell() ? <MobileTitleChars text="足迹" /> : "足迹"}
          </h2>
          <p className="workspace-subtitle">每一步都算数。</p>
        </div>
      </div>
      {/* 顶卡两端都在说「现在」：移动壳是数据型引导卡（连续足迹）；桌面顶卡报今天投入，
          连续与累计归下面的读数条（横向一条与移动壳同口径），一个数只在一处当大字。 */}
      {isMobileShell() ? (
        <MobileGuideCard
          value={currentStreak}
          unit="天"
          label="连续足迹"
          hint={`活跃 ${activeDateKeys.length} 天 · 最长 ${longestStreak} 天`}
        />
      ) : (
        <section className="today-hero guide-hero">
          <div className="today-hero-copy">
            <p className="today-hero-note">
              {todayInvestment ? "今天动的每一项，都算进了下面这张图。" : "今天还没有投入——完成一件小事或打一次卡都算。"}
            </p>
          </div>
          <div className="today-hero-meter">
            <span className="today-hero-meter-count">
              <strong>{todayInvestment}</strong>
              <span>项</span>
            </span>
            <span className="today-hero-meter-label">今天已投入</span>
          </div>
        </section>
      )}

      {/* 读数条：与周报页同族的横向一条（inline-flex + 竖发丝线），窄窗折行、
          移动壳两列网格——不再用四格高卡把首屏吃满。 */}
      <section className="footprint-stats" aria-label="半年概览">
        <div className="weekly-stat-track">
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">活跃天数</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{activeDateKeys.length}</strong>
              <span className="weekly-stat-note">天</span>
            </div>
          </div>
          <div className="weekly-stat-item is-gold">
            <span className="weekly-stat-label">当前连续</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{currentStreak}</strong>
              <span className="weekly-stat-note">天</span>
            </div>
          </div>
          <div className="weekly-stat-item is-gold">
            <span className="weekly-stat-label">最长连续</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{longestStreak}</strong>
              <span className="weekly-stat-note">天</span>
            </div>
          </div>
          <div className="weekly-stat-item">
            <span className="weekly-stat-label">累计投入</span>
            <div className="weekly-stat-value">
              <strong className="weekly-stat-num">{Math.round(totalValue * 10) / 10}</strong>
              <span className="weekly-stat-note">次</span>
            </div>
          </div>
        </div>
      </section>

      {/* 桌面端「最近半年的投入」与「当日明细」合成一张卡：卡面由外层 .growth-day-fuse
          接手（components.css 桌面门控）；移动壳对该层零样式命中，仍是各自两张卡。 */}
      <div className="growth-day-fuse">
      <section className="growth-panel heatmap-panel">
        <div className="growth-panel-head">
          <div>
            <h3>最近半年的投入</h3>
            <p className="growth-trend-hint">一柱是一周投了多少，一格是这天动没动，点一格看那天做了什么。</p>
          </div>
        </div>
        {/* 周柱与下面的月份刻度、日格子共用同一套 26 列：上下对齐就读成一张图——
            上面看量（哪几周重），下面看迹（哪几天动）。零投入的周用内凹灰，
            和空档格子同一语气。 */}
        <div className="growth-trend" role="img" aria-label="每周投入走势">
          {weeklyTotals.map((week) => (
            <i
              key={week.key}
              className={`growth-trend-bar${week.value ? "" : " is-zero"}${week.key === currentWeekKey ? " is-current" : ""}`}
              style={{ height: `${Math.max(4, (week.value / weeklyPeak) * 100)}%` }}
              title={`${week.key.slice(5).replace("-", "/")} 起一周 · ${week.value || "无"}投入${week.activeDays ? ` · ${week.activeDays} 天` : ""}`}
            />
          ))}
        </div>
        {/* 月份刻度与格子同一套 26 列栅格，桌面用来回答「这片是哪几个月」。 */}
        <div className="heat-months" aria-hidden>
          {monthMarks.map((mark) => (
            <span key={mark.col} style={{ gridColumnStart: mark.col + 1 }}>{mark.label}</span>
          ))}
        </div>
        <div className="growth-heatmap" ref={heatRef} aria-label="足迹热点图">
          {days.map((date) => {
            const key = toDateKey(date);
            const value = valueByDate.get(key) ?? 0;
            const level = activityLevelFromValue(value);
            return <button key={key} className={`heat-cell level-${level}${key === today ? " is-today" : ""}${key === viewDate ? " is-sel" : ""}`} title={`${key} · ${value || "无"}投入`} onClick={() => setSelectedDate(key)} />;
          })}
        </div>
        <div className="heatmap-legend"><span>少</span>{[0,1,2,3,4].map((level) => <i key={level} className={`heat-cell level-${level}`} />)}<span>多</span></div>
      </section>

      {/* 当日明细：常驻在热力图下方通栏（不再弹窗），只两列——完成任务 + 习惯打卡。
          点上面任意一格就换这一天；口径与格子颜色同一处，亮的日子面板一定不空。 */}
      <section className="footprint-day" aria-label="当日明细">
        <div className="footprint-day-head">
          <strong>{viewDate}</strong>
          {viewDate === today ? <span className="footprint-day-chip">今天</span> : null}
          <span className="footprint-day-sum">
            {dayTasks.length + dayHabitRows.length > 0
              ? `${dayTasks.length} 项任务 · ${dayHabitRows.length} 次习惯打卡`
              : "这一天还空着"}
          </span>
        </div>
        {dayTasks.length || dayHabitRows.length ? (
          <div className="footprint-day-cols">
            <div className="footprint-day-col">
              <h4>完成任务 <span>{dayTasks.length}</span></h4>
              {dayTasks.length ? (
                isMobileShell() ? (
                  /* 移动壳：与周报当周日历 day 列同一套行件 MobileTaskLine——行首分类色点、
                     归属胶囊、目标徽标、完成金圆钮全同源；点开详情、长按操作面板同周报。 */
                  <ul className="mrow-list">
                    {dayTasks.map((task) => (
                      <MobileTaskLine
                        key={task.id}
                        task={task}
                        today={today}
                        projects={projects}
                        tags={tags}
                        tagMap={tagMap}
                        goalById={goalById}
                        variant="day"
                        dotColor={categoryColor(resolveCategoryId(task.id, tagMap, tags))}
                        onOpen={() => selectTask(task.id)}
                        onComplete={() => void toggleComplete(task.id)}
                        onMore={() => setSheetTask(task)}
                      />
                    ))}
                  </ul>
                ) : (
                  /* 桌面：行照周报「脉搏详情」的原子——成就金行底、分类色点、归属胶囊 /
                     目标徽标 / 完成时刻 done-chip、右侧勾选钮同一族；点行开任务详情。 */
                  <ul className="weekly-pulse-list">
                    {dayTasks.map((task) => {
                      const stamp = formatIsoTime(task.completed_at);
                      const pills = getMobileTaskPills(task, projects, tags, tagMap);
                      const goal = task.goal_id ? goalById.get(task.goal_id) ?? null : null;
                      return (
                        <li className="weekly-day-task is-done" key={task.id}>
                          <button
                            type="button"
                            className="weekly-day-open"
                            onClick={() => selectTask(task.id)}
                          >
                            <i
                              className="weekly-dot"
                              style={{
                                background: categoryColor(resolveCategoryId(task.id, tagMap, tags)),
                              }}
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
                            aria-label={`取消完成 ${task.title}`}
                            aria-pressed
                            onClick={() => void toggleComplete(task.id)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                <p className="footprint-day-empty">这一天没有完成任务。</p>
              )}
            </div>
            <div className="footprint-day-col">
              <h4>习惯打卡 <span>{dayHabitRows.length}</span></h4>
              {dayHabitRows.length ? (
                /* 习惯行借任务同一族行壳与徽标：色点换成打卡绿（习惯没有分类色）。
                   行尾的完成钮与任务行同一族——按下去就是取消这一天的打卡，再按恢复。 */
                isMobileShell() ? (
                  <ul className="mrow-list">
                    {dayHabitRows.map((habit) => (
                      <li className="mrow is-dense footprint-habit-row" key={habit.habitId}>
                        <i className="mrow-cdot footprint-habit-dot" aria-hidden />
                        <span className="mrow-main">
                          <span className="mrow-title">{habit.title}</span>
                        </span>
                        <button
                          type="button"
                          className="mtoday-check is-done"
                          aria-label={`取消打卡 ${habit.title}`}
                          aria-pressed
                          onClick={() => void toggleHabitDay(habit.habitId, viewDate)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="weekly-pulse-list">
                    {dayHabitRows.map((habit) => (
                      <li className="weekly-day-task is-done" key={habit.habitId}>
                        <div className="weekly-day-open">
                          <i className="weekly-dot footprint-habit-dot" aria-hidden />
                          <span className="weekly-day-main">
                            <span className="weekly-day-title">{habit.title}</span>
                            <span className="weekly-day-task-meta">
                              <span className="done-chip">已打卡</span>
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          className="weekly-day-check"
                          aria-label={`取消打卡 ${habit.title}`}
                          aria-pressed
                          onClick={() => void toggleHabitDay(habit.habitId, viewDate)}
                        />
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <p className="footprint-day-empty">这一天没有习惯打卡。</p>
              )}
            </div>
          </div>
        ) : (
          <p className="footprint-day-empty">这一天没有记录。空白不是失败，只是尚未留下足迹。</p>
        )}
      </section>
      </div>
      {sheetTask ? (
        <TaskActionSheet task={sheetTask} cursor={today} onClose={() => setSheetTask(null)} />
      ) : null}
    </div>
  );
}
