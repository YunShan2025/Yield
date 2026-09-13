import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { addDays, formatLongDate, todayDateString } from "@/lib/dates";
import { isInboxTask, isActiveTask } from "@/lib/tasks";
import { findTimeConflictIds } from "@/lib/planning";
import {
  orderTodayTasks,
  loadTodayOrder,
  saveTodayOrder,
} from "@/lib/today";
import { TodayHero } from "./TodayHero";
import { BatchToolbar } from "./BatchToolbar";
import { TodayAgenda } from "./TodayAgenda";
import { TodayTimeline } from "../TodayTimeline";

/**
 * Day board for 今日 / 待办箱 / 日视图. Thin shell: ordering, batch tools and
 * day close live in child components, so focus-clock ticks never re-render
 * this tree.
 */
export function DayBoard() {
  const allTasks = useAppStore((s) => s.tasks);
  const nav = useAppStore((s) => s.nav);
  const cursor = useAppStore((s) => s.calendarCursor);
  const today = todayDateString();
  const isTodayView = nav === "today";
  const isInboxView = nav === "inbox";

  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [orderVersion, setOrderVersion] = useState(0);

  useEffect(() => {
    setSelectedIds([]);
  }, [cursor, nav]);

  const dayTasks = useMemo(() => {
    return allTasks.filter((task) => {
      if (task.parent_id || task.deleted_at) return false;
      if (nav === "inbox") {
        return isInboxTask(task, today);
      }
      // 今日/日视图同口径：只呈现截止日期等于所看日期的任务。
      // 逾期任务不再滚入或展示在今日页,统一收进待办箱。
      return task.due_date === cursor;
    });
  }, [allTasks, cursor, today, nav]);

  const order = useMemo(
    () => loadTodayOrder(cursor),
    // orderVersion bumps whenever a drag persists a new manual order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cursor, orderVersion],
  );

  const orderedTasks = useMemo(
    () => orderTodayTasks(dayTasks, order),
    [dayTasks, order],
  );

  const conflictIds = useMemo(() => findTimeConflictIds(dayTasks), [dayTasks]);

  const pending = dayTasks.filter(isActiveTask).length;
  const done = dayTasks.filter((task) => task.status === "completed").length;
  const total = pending + done;

  const handleReorder = (ids: string[]) => {
    saveTodayOrder(cursor, ids);
    setOrderVersion((version) => version + 1);
  };

  return (
    <div className={`scope-board ${isTodayView ? "is-deadline" : "is-plan"}`}>
      <TodayHero
        cursor={cursor}
        today={today}
        isTodayView={isTodayView}
        isInbox={isInboxView}
        conflictCount={conflictIds.size}
        doneCount={done}
        totalCount={total}
      />
      {!isInboxView ? (
        <div className="scope-nav">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => useAppStore.getState().setCalendarCursor(addDays(cursor, -1))}
          >
            ‹
          </button>
          <strong>{formatLongDate(cursor)}</strong>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => useAppStore.getState().setCalendarCursor(addDays(cursor, 1))}
          >
            ›
          </button>
          <button
            type="button"
            className="btn-ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => useAppStore.getState().setCalendarCursor(today)}
          >
            今日
          </button>
        </div>
      ) : null}

      {isTodayView ? <TodayTimeline /> : null}

      <TodayAgenda
        tasks={orderedTasks}
        cursor={cursor}
        today={today}
        isTodayView={isTodayView}
        isInbox={isInboxView}
        conflictIds={conflictIds}
        selecting={selecting}
        selectedIds={selectedIds}
        toolbar={
          selecting ? (
            <BatchToolbar
              tasks={allTasks}
              cursor={cursor}
              selectedIds={selectedIds}
              onClear={() => setSelectedIds([])}
            />
          ) : null
        }
        headerExtra={
          <button
            type="button"
            className={`btn-ghost ${selecting ? "active" : ""}`}
            onClick={() => {
              setSelecting((value) => !value);
              setSelectedIds([]);
            }}
          >
            {selecting ? "退出批量" : "批量管理"}
          </button>
        }
        onToggleSelect={(id) =>
          setSelectedIds((ids) =>
            ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
          )
        }
        onReorder={handleReorder}
      />
    </div>
  );
}
