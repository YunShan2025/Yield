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
import { useGoals } from "@/lib/useGoals";
import { ExpandRow } from "@/components/ExpandRow";
import { formatDueDateBadge, priorityLabel } from "@/lib/dates";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { getMobileTaskPills } from "@/components/mobile/MobileTaskPills";
import { mobileDoneStamp } from "@/components/mobile/MobileTaskLine";
import { MobileTaskLine } from "@/components/mobile/MobileTaskLine";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import type { Goal, Project, Tag, Task } from "@/types";

/** 移动壳里一个分类默认只露这么多条：sunken 子面板被拉成十几条会吃满一屏。 */
const MOBILE_TASK_PREVIEW = 5;

/** 桌面脉搏图详情：一天最多露这么多条，溢出折叠成「还有 N 项」。 */
const PULSE_TASK_PREVIEW = 10;

/* 脉搏图几何（viewBox 单位）：高 152 与 .wp-lines 的固定高度 1:1，dot 才能用
   py() 的像素值直接落位；x 是 0-100 随容器拉伸，描边吃 non-scaling-stroke。
   顶部留 34 单位：峰值标签要悬在峰点上方而不被卡片裁掉。 */
const PULSE_PLOT_TOP = 34;
const PULSE_PLOT_BASE = 118;
const PULSE_PLOT_H = PULSE_PLOT_BASE + PULSE_PLOT_TOP;

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

/**
 * 「本周任务」的桌面行：移动 MobileTaskLine 的桌面对应物——标题在上，第二行
 * 是优先级点·截止徽标·归属胶囊·目标徽标，右端完成圆钮。徽标全部复用今日/
 * 待办的桌面原子（.due-chip/.task-pill/.goal-chip），完成态走同页当周日历
 * 那套「成就金」认可（不划线、不置灰）。
 */
function WeeklyTaskRow({
  task,
  today,
  projects,
  tags,
  tagMap,
  goal,
  onOpen,
  onComplete,
}: {
  task: Task;
  today: string;
  projects: Project[];
  tags: Tag[];
  tagMap: Record<string, string[]>;
  goal: Goal | null;
  onOpen: () => void;
  onComplete: () => void;
}) {
  const done = task.status === "completed";
  // 与移动行同一口径：完成的事不再标截止语气，哪天做完的由行尾小注说。
  const due = done ? null : formatDueDateBadge(task.due_date, today);
  const pills = getMobileTaskPills(task, projects, tags, tagMap);
  const stamp = done ? mobileDoneStamp(task.completed_at) : null;
  return (
    <div className={`weekly-goal-task${done ? " is-done" : ""}`}>
      <button type="button" className="weekly-goal-task-open" onClick={onOpen}>
        <span className="weekly-goal-task-title">{task.title}</span>
        <span className="weekly-goal-task-meta">
          <i
            className={`weekly-goal-task-pdot pr${task.priority}`}
            title={priorityLabel(task.priority)}
            aria-hidden
          />
          {due ? (
            <span
              className={`due-chip is-${due.tone}`}
              title={due.title}
              aria-label={due.tone === "none" ? "未安排日期" : `${due.label}，${due.title}`}
            >
              {due.label}
            </span>
          ) : null}
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
            <span className="goal-chip" style={{ "--goal-color": goal.color } as CSSProperties}>
              {goal.title}
            </span>
          ) : null}
          {stamp ? <span className="done-chip">{stamp} 完成</span> : null}
        </span>
      </button>
      <button
        type="button"
        className="weekly-goal-task-check"
        aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
        aria-pressed={done}
        onClick={onComplete}
      />
    </div>
  );
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
  // y 下限 max(4, 峰值) 防空周折线贴地。
  const pulseMax = Math.max(4, ...days.map((day) => day.total));
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

  // 分类行旁的备注：有任务就报数（本周有x项任务），不再拿首个任务名当副标题——
  // 任务名长短不一、还会和右侧「已完成/总数」抢读；空类保留「本周暂无任务」。
  const summaryLine = (id: WeeklyCategoryId) => {
    const bucket = categories.find((item) => item.category.id === id);
    if (!bucket || bucket.total === 0) return "本周暂无任务";
    return `本周有${bucket.total}项任务`;
  };

  return (
    <main className="main-workspace weekly-checklist">
      <div className="workspace-top weekly-checklist-top">
        <div>
          <h2 aria-label={isMobileShell() ? "周清单" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="周清单" /> : "周清单"}

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

      {/* 当周概览放在列表之前：这三项是这一周的节奏（打卡、连续、峰值日），先给一眼
          再进任务列表。它与引导块不重复 —— 引导块是本周完成进度，这里是习惯侧与峰值；
          本周事项 / 已完成 / 剩余与完成率条早就随引导块去重掉了，没留下来。 */}
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
                meta={summaryLine(bucket.category.id)}
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
                          goalById={goalById}
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
                        <WeeklyTaskRow
                          key={task.id}
                          task={task}
                          today={today}
                          projects={projects}
                          tags={tags}
                          tagMap={tagMap}
                          goal={task.goal_id ? goalById.get(task.goal_id) ?? null : null}
                          onOpen={() => selectTask(task.id)}
                          onComplete={() => void toggleComplete(task.id)}
                        />
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
                              <span className="weekly-goal-task-meta">
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
