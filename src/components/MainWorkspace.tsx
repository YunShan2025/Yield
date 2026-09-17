import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useAppStore } from "@/store/app";
import { isMobileShell } from "@/lib/platform";
import {
  boardColumns,
  filterTasksByView,
  getEmptyMessage,
  getViewTitle,
  isActiveTask,
} from "@/lib/tasks";
import { formatDueDate, formatTimeRange, todayDateString, addDays, formatLongDate, formatStamp, weekDates, parseDate, startOfWeek, parseTimeToMinutes } from "@/lib/dates";
import type { Task } from "@/types";
import { ExpandableTaskItem } from "@/components/ExpandableTaskItem";
import { confirmAction } from "@/components/AppConfirm";
import { DayBoard } from "@/components/today/DayBoard";

const SettingsView = lazy(() =>
  import("@/components/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);
const HabitsView = lazy(() =>
  import("@/components/HabitsView").then((module) => ({
    default: module.HabitsView,
  })),
);
const RemindersView = lazy(() =>
  import("@/components/RemindersView").then((module) => ({
    default: module.RemindersView,
  })),
);
const TagsView = lazy(() =>
  import("@/components/TagsView").then((module) => ({
    default: module.TagsView,
  })),
);
const ReviewView = lazy(() =>
  import("@/components/ReviewView").then((module) => ({
    default: module.ReviewView,
  })),
);
const WeeklyChecklistView = lazy(() =>
  import("@/components/WeeklyChecklistView").then((module) => ({
    default: module.WeeklyChecklistView,
  })),
);
const ProjectsView = lazy(() =>
  import("@/components/ProjectsView").then((module) => ({
    default: module.ProjectsView,
  })),
);
const MemosView = lazy(() =>
  import("@/components/MemosView").then((module) => ({
    default: module.MemosView,
  })),
);
const GrowthView = lazy(() =>
  import("@/components/GrowthView").then((module) => ({
    default: module.GrowthView,
  })),
);
const AnniversariesView = lazy(() =>
  import("@/components/AnniversariesView").then((module) => ({
    default: module.AnniversariesView,
  })),
);
const LedgerView = lazy(() =>
  import("@/components/LedgerView").then((module) => ({ default: module.LedgerView })),
);

function BoardView({ tasks }: { tasks: Task[] }) {
  const cols = boardColumns(tasks);
  const saveTask = useAppStore((s) => s.saveTask);
  // 移动端用 TouchSensor 长按启动拖拽,避免触摸滑动被拖拽劫持;桌面维持位移阈值。
  const sensors = useSensors(
    useSensor(
      isMobileShell() ? TouchSensor : PointerSensor,
      isMobileShell()
        ? { activationConstraint: { delay: 180, tolerance: 8 } }
        : { activationConstraint: { distance: 6 } },
    ),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const id = String(active.id);
    const col = String(over.id);
    if (col === "pending") void saveTask(id, { status: "pending" });
    if (col === "completed") void saveTask(id, { status: "completed" });
    if (col === "overdue") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const d = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
      void saveTask(id, { status: "pending", due_date: d });
    }
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="board">
        {(
          [
            ["pending", "进行中", cols.pending],
            ["overdue", "已过期", cols.overdue],
            ["completed", "已完成", cols.completed],
          ] as const
        ).map(([id, title, list]) => (
          <div key={id} className="board-col" id={id}>
            <h3>
              {title} · {list.length}
            </h3>
            <SortableContext items={list.map((t) => t.id)} strategy={verticalListSortingStrategy}>
              {list.map((task) => (
                <ExpandableTaskItem
                  key={task.id}
                  task={task}
                  meta={<span>{formatDueDate(task.due_date)}</span>}
                />
              ))}
            </SortableContext>
          </div>
        ))}
      </div>
    </DndContext>
  );
}


function WeekBoard() {
  const allTasks = useAppStore((s) => s.tasks);
  const cursor = useAppStore((s) => s.calendarCursor);
  const setCalendarCursor = useAppStore((s) => s.setCalendarCursor);
  const selectTask = useAppStore((s) => s.selectTask);
  const saveTask = useAppStore((s) => s.saveTask);
  const bodyRef = useRef<HTMLDivElement>(null);
  const today = todayDateString();
  const weekStart = startOfWeek(cursor);
  const days = weekDates(cursor);
  const weekLabel = `${formatLongDate(days[0])} – ${parseDate(days[6]).getMonth() + 1}月${parseDate(days[6]).getDate()}日`;

  const weekTasks = useMemo(() => {
    const end = addDays(weekStart, 6);
    return allTasks.filter(
      (t) =>
        !t.parent_id &&
        !t.deleted_at &&
        t.due_date !== null &&
        t.due_date >= weekStart &&
        t.due_date <= end,
    );
  }, [allTasks, weekStart]);

  const pending = weekTasks.filter(isActiveTask).length;
  const done = weekTasks.filter((t) => t.status === "completed").length;

  const hourStart = 8;
  const hours = Array.from({ length: 15 }, (_, i) => i + hourStart); // 08–22
  const slotH = 48;
  const now = new Date();
  const nowDay = today;
  const nowTop =
    ((now.getHours() - hourStart) * 60 + now.getMinutes()) / 60 * slotH;

  const weekday = ["日", "一", "二", "三", "四", "五", "六"];

  // 自动滚到当前时间，避免晚上的任务看起来像“没显示”
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const target = Math.max(0, nowTop - 80);
    el.scrollTop = target;
  }, [weekStart, nowTop]);

  return (
    <div className="scope-board">
      <div className="scope-nav">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setCalendarCursor(addDays(cursor, -7))}
        >
          ‹
        </button>
        <div className="week-board-title">
          <span className="week-board-kicker">周历 · 按时间查看</span>
          <strong>{weekLabel}</strong>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setCalendarCursor(addDays(cursor, 7))}
        >
          ›
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setCalendarCursor(today)}
        >
          今日
        </button>
      </div>

      <div className="scope-summary">
        <div className="scope-card">
          <span>本周待办</span>
          <strong>{pending}</strong>
        </div>
        <div className="scope-card">
          <span>本周完成</span>
          <strong>{done}</strong>
        </div>
      </div>

      {weekTasks.length ? (
        <div className="week-task-strip">
          {weekTasks.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`week-chip ${t.status === "completed" ? "is-done" : ""}`}
              onClick={() => selectTask(t.id)}
              title={`${t.due_date} ${formatTimeRange(t.due_time, t.end_time)}`}
            >
              <span className="week-chip-date">
                {t.due_date?.slice(5)} {formatTimeRange(t.due_time, t.end_time)}
              </span>
              {t.title}
            </button>
          ))}
        </div>
      ) : (
        <div className="scope-empty">
          本周暂无带日期的任务。若要按工作/生活等分类查看，请打开侧栏「周清单」。
        </div>
      )}

      <div className="week-board" ref={bodyRef}>
        <div className="week-head">
          <div className="week-gutter" />
          {days.map((date) => {
            const d = parseDate(date);
            return (
              <div
                key={date}
                className={`week-day-head ${date === today ? "is-today" : ""}`}
              >
                <span>{weekday[d.getDay()]}</span>
                <strong>{d.getDate()}</strong>
              </div>
            );
          })}
        </div>

        <div className="week-allday">
          <div className="week-gutter">
            <span className="week-allday-label">全天</span>
          </div>
          {days.map((date) => (
            <div key={date} className="week-allday-cell">
              {weekTasks
                .filter((t) => t.due_date === date && !t.due_time)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`week-allday-event ${t.status === "completed" ? "is-done" : ""}`}
                    onClick={() => selectTask(t.id)}
                  >
                    {t.title}
                  </button>
                ))}
            </div>
          ))}
        </div>

        <div className="week-body">
          <div className="week-gutter">
            {hours.map((h) => (
              <div key={h} className="week-hour" style={{ height: slotH }}>
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {days.map((date) => (
            <div
              key={date}
              className="week-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/task");
                if (id) void saveTask(id, { due_date: date });
              }}
            >
              {hours.map((h) => (
                <div key={h} className="week-slot" style={{ height: slotH }} />
              ))}
              {date === nowDay &&
              now.getHours() >= hourStart &&
              now.getHours() <= hourStart + hours.length - 1 ? (
                <div className="now-line week-now" style={{ top: nowTop }} />
              ) : null}
              {weekTasks
                .filter((t) => t.due_date === date && t.due_time)
                .map((t) => {
                  const startMin = parseTimeToMinutes(t.due_time)!;
                  const endMin =
                    parseTimeToMinutes(t.end_time) ?? startMin + 60;
                  const duration = Math.max(30, endMin - startMin);
                  const top =
                    ((startMin - hourStart * 60) / 60) * slotH;
                  const height = Math.max(28, (duration / 60) * slotH);
                  const timeLabel = formatTimeRange(t.due_time, t.end_time);
                  const compact = height < 44;
                  return (
                    <div
                      key={t.id}
                      className={`week-event ${compact ? "is-compact" : ""} ${t.status === "completed" ? "is-done" : ""}`}
                      style={{
                        top: Math.max(0, top),
                        height,
                      }}
                      title={`${timeLabel} ${t.title}`}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData("text/task", t.id)
                      }
                      onClick={() => selectTask(t.id)}
                    >
                      {compact ? null : (
                        <span className="week-event-time">{timeLabel}</span>
                      )}
                      <span className="week-event-title">{t.title}</span>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthBoard() {
  const allTasks = useAppStore((s) => s.tasks);
  const cursor = useAppStore((s) => s.calendarCursor);
  const setCalendarCursor = useAppStore((s) => s.setCalendarCursor);
  const setDateScope = useAppStore((s) => s.setDateScope);
  const selectTask = useAppStore((s) => s.selectTask);
  const saveTask = useAppStore((s) => s.saveTask);
  const today = todayDateString();

  const year = Number(cursor.slice(0, 4));
  const month = Number(cursor.slice(5, 7)) - 1;
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: { date: string | null; day: number | null }[] = [];
  for (let i = 0; i < startPad; i++) cells.push({ date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date, day: d });
  }

  const monthStart = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEnd = `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;
  const monthTasks = allTasks.filter(
    (t) =>
      !t.parent_id &&
      !t.deleted_at &&
      t.due_date !== null &&
      t.due_date >= monthStart &&
      t.due_date <= monthEnd,
  );
  const pending = monthTasks.filter(isActiveTask).length;
  const done = monthTasks.filter((t) => t.status === "completed").length;

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setCalendarCursor(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
    );
  };

  return (
    <div className="scope-board">
      <div className="scope-nav">
        <button type="button" className="btn-ghost" onClick={() => shiftMonth(-1)}>
          ‹
        </button>
        <strong>
          {year}年{month + 1}月
        </strong>
        <button type="button" className="btn-ghost" onClick={() => shiftMonth(1)}>
          ›
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setCalendarCursor(today)}
        >
          今日
        </button>
      </div>

      <div className="scope-summary">
        <div className="scope-card">
          <span>本月待办</span>
          <strong>{pending || "本月无待办"}</strong>
        </div>
        <div className="scope-card">
          <span>本月完成</span>
          <strong>{done}</strong>
        </div>
      </div>

      <div className="calendar-grid month-grid">
        {["日", "一", "二", "三", "四", "五", "六"].map((w) => (
          <div key={w} className="cal-weekday">
            {w}
          </div>
        ))}
        {cells.map((cell, idx) => (
          <div
            key={idx}
            className={`cal-cell ${cell.date ? "" : "muted"} ${cell.date === today ? "is-today" : ""}`}
            onClick={() => {
              if (cell.date) {
                setCalendarCursor(cell.date);
                setDateScope("day");
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/task");
              if (id && cell.date) void saveTask(id, { due_date: cell.date });
            }}
          >
            {cell.day ? <div className="cal-day">{cell.day}</div> : null}
            {cell.date
              ? allTasks
                  .filter(
                    (t) =>
                      !t.parent_id &&
                      !t.deleted_at &&
                      t.due_date === cell.date,
                  )
                  .slice(0, 3)
                  .map((t) => (
                    <div
                      key={t.id}
                      className={`cal-task ${t.status === "completed" ? "is-done" : ""}`}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData("text/task", t.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        selectTask(t.id);
                      }}
                    >
                      {t.title}
                    </div>
                  ))
              : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function TrashView() {
  const trashTasks = useAppStore((s) => s.trashTasks);
  const restoreTask = useAppStore((s) => s.restoreTask);
  const purgeTask = useAppStore((s) => s.purgeTask);
  const purgeTrash = useAppStore((s) => s.purgeTrash);
  const total = trashTasks.length;

  return (
    <div className="task-scroll">
      <section className="trash-summary" aria-label="回收站概况">
        <div className="trash-summary-copy">
          <strong>
            已删除 {total} 项{total ? "，保留 30 天内可随时恢复" : ""}
          </strong>
          <p>清空或永久删除后无法恢复；恢复的任务会回到原来的位置。</p>
        </div>
        <button
          type="button"
          className="btn-ghost danger"
          disabled={!total}
          onClick={() => {
            void confirmAction({
              title: `确定清空回收站的 ${total} 项？`,
              description: "此操作不可恢复。",
              confirmText: "清空",
              danger: true,
            }).then((ok) => {
              if (ok) void purgeTrash();
            });
          }}
        >
          清空回收站
        </button>
      </section>
      {!total ? (
        <div className="empty-state">{getEmptyMessage("trash")}</div>
      ) : (
        <div className="trash-list">
          {trashTasks.map((task) => (
            <article key={task.id} className="trash-item">
              <div className="trash-item-main">
                <p className="task-title">{task.title}</p>
                <div className="trash-item-meta">
                  {task.deleted_at ? (
                    <span>删除于 {formatStamp(task.deleted_at)}</span>
                  ) : null}
                  <span>优先级 P{task.priority}</span>
                  {task.due_date ? (
                    <span>原截止 {formatDueDate(task.due_date)}</span>
                  ) : null}
                  {task.repeat_rule ? <span>重复任务</span> : null}
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => void restoreTask(task.id)}
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="btn-ghost danger"
                  onClick={() => {
                    void confirmAction({
                      title: `永久删除「${task.title}」？`,
                      description: "不可恢复。",
                      confirmText: "永久删除",
                      danger: true,
                    }).then((ok) => {
                      if (ok) void purgeTask(task.id);
                    });
                  }}
                >
                  永久删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function MainWorkspace() {
  const nav = useAppStore((s) => s.nav);
  const setViewMode = useAppStore((s) => s.setViewMode);
  const dateScope = useAppStore((s) => s.dateScope);
  const setDateScope = useAppStore((s) => s.setDateScope);
  const tasks = useAppStore((s) => s.tasks);
  const tagMap = useAppStore((s) => s.tagMap);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const openCreateTask = useAppStore((s) => s.openCreateTask);

  const visible = useMemo(
    () => filterTasksByView(tasks, nav, tagMap, activeTagId),
    [tasks, nav, tagMap, activeTagId],
  );

  useEffect(() => {
    if (nav === "board") setViewMode("board");
    if (nav === "calendar") {
      setViewMode("calendar");
      setDateScope("month");
    }
  }, [nav, setViewMode, setDateScope]);

  if (nav === "settings") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开设置…</div>}>
        <SettingsView />
      </Suspense>
    );
  }
  if (nav === "habits") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开习惯…</div>}>
        <HabitsView />
      </Suspense>
    );
  }
  if (nav === "reminders") {
    return (
      <main className="main-workspace reminders-host">
        <Suspense fallback={<div className="empty-state">正在打开提醒…</div>}>
          <RemindersView />
        </Suspense>
      </main>
    );
  }
  if (nav === "review") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开复盘…</div>}>
        <ReviewView />
      </Suspense>
    );
  }
  if (nav === "week") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开周清单…</div>}>
        <WeeklyChecklistView />
      </Suspense>
    );
  }
  if (nav === "growth") return <Suspense fallback={<div className="empty-state">正在加载成长数据…</div>}><GrowthView /></Suspense>;
  if (nav === "anniversaries") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开纪念日…</div>}>
        <AnniversariesView />
      </Suspense>
    );
  }
  if (nav === "memos") {
    return (
      <Suspense fallback={<div className="empty-state">正在加载备忘录…</div>}>
        <MemosView />
      </Suspense>
    );
  }
  if (nav === "projects") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开项目…</div>}>
        <ProjectsView />
      </Suspense>
    );
  }
  if (nav === "ledger") {
    return <Suspense fallback={<div className="empty-state">正在打开收支总览…</div>}><LedgerView /></Suspense>;
  }
  if (nav === "tags") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开标签…</div>}>
        <TagsView />
      </Suspense>
    );
  }
  if (nav === "trash") {
    return (
      <main className="main-workspace">
        <div className="workspace-top">
          <h2>{getViewTitle("trash")}</h2>
        </div>
        <TrashView />
      </main>
    );
  }

  const useScopeBoard = nav !== "board";
  const showDateScope = nav !== "inbox" && useScopeBoard;

  return (
    <main className="main-workspace">
      <div className="workspace-top">
        <div>
          <h2>{getViewTitle(nav)}</h2>
          {nav === "today" ? (
            <p className="workspace-subtitle">今日事，今日毕。</p>
          ) : null}
          {nav === "inbox" ? (
            <p className="workspace-subtitle">有计划的人很多，但去做的人很少。</p>
          ) : null}
        </div>
        <div className="top-controls">
          {showDateScope ? (
            <>
              <div className="seg">
                {(["day", "week", "month"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={dateScope === s ? "active" : ""}
                    onClick={() => setDateScope(s)}
                  >
                    {s === "day" ? "日" : s === "week" ? "周" : "月"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => openCreateTask()}
              >
                新建任务
              </button>
            </>
          ) : nav === "inbox" ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => openCreateTask({ inbox: true })}
            >
              新建任务
            </button>
          ) : null}
        </div>
      </div>

      {useScopeBoard && (nav === "inbox" || dateScope === "day") ? <DayBoard /> : null}
      {showDateScope && dateScope === "week" ? <WeekBoard /> : null}
      {showDateScope && dateScope === "month" ? <MonthBoard /> : null}
      {!useScopeBoard ? <BoardView tasks={visible} /> : null}
    </main>
  );
}
