import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "@/store/app";
import { ExpandableTaskItem } from "@/components/ExpandableTaskItem";
import { buildTaskDeferredUpdate } from "@/lib/planning";
import { addDays, formatIsoTime, formatTimeRange, priorityLabel } from "@/lib/dates";
import { confirmAction } from "@/components/AppConfirm";
import type { Task } from "@/types";
import { isActiveTask } from "@/lib/tasks";

/** Row "⋯" menu. Rendered through a portal + viewport-fixed: ancestors may
 * carry transforms (e.g. .expand-task:hover translateY), which would otherwise
 * hijack position:fixed and misplace the menu until the pointer leaves. */
function RowMenu({ task, cursor }: { task: Task; cursor: string }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState(addDays(cursor, 1));
  const anchorRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) {
      const MENU_W = 208;
      const MENU_H = 150;
      const left = Math.max(
        8,
        Math.min(window.innerWidth - MENU_W - 8, rect.right - MENU_W),
      );
      const below = rect.bottom + 6;
      setMenuPos({
        left,
        top:
          below + MENU_H > window.innerHeight
            ? Math.max(8, rect.top - MENU_H - 6)
            : below,
      });
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    setCustomOpen(false);
  };

  const deferTo = (date: string) => {
    close();
    if (!date) return;
    void useAppStore
      .getState()
      .saveTask(task.id, buildTaskDeferredUpdate(date));
  };

  return (
    <span className="row-more-wrap">
      <button
        type="button"
        ref={anchorRef}
        className="btn-ghost row-more"
        title="更多操作"
        aria-label="更多操作"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close();
          else openMenu();
        }}
      >
        ⋯
      </button>
      {open && menuPos ? createPortal(
        <>
          <button
            type="button"
            className="row-menu-backdrop"
            aria-label="关闭菜单"
            onClick={close}
          />
          <div
            className="row-menu"
            style={{ left: menuPos.left, top: menuPos.top }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => deferTo(addDays(cursor, 1))}>
              顺延到明天
            </button>
            {customOpen ? (
              <label className="row-menu-date">
                <span>改期到</span>
                <input
                  type="date"
                  className="field"
                  value={customDate}
                  autoFocus
                  onChange={(event) => {
                    setCustomDate(event.target.value);
                    if (event.target.value) deferTo(event.target.value);
                  }}
                />
              </label>
            ) : (
              <button type="button" onClick={() => setCustomOpen(true)}>
                改期到自定义日期…
              </button>
            )}
          </div>
        </>,
        document.body,
      ) : null}
    </span>
  );
}

function DayTaskRow({
  task,
  cursor,
  conflict,
  selecting,
  selected,
  onToggleSelect,
}: {
  task: Task;
  cursor: string;
  conflict: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const deleteTask = useAppStore((s) => s.deleteTask);
  const sortable = useSortable({
    id: task.id,
    disabled: selecting || task.status === "completed",
  });

  const onDelete = async () => {
    const ok = await confirmAction({
      title: "移入回收站？",
      description: `将把「${task.title}」移入回收站。`,
      confirmText: "删除",
      danger: true,
    });
    if (ok) await deleteTask(task.id);
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <ExpandableTaskItem
        task={task}
        expandable={false}
        selection={
          selecting ? { active: true, selected, onToggle: onToggleSelect } : undefined
        }
        meta={
          <>
            <span>{formatTimeRange(task.due_time, task.end_time)}</span>
            {task.status === "completed" ? (
              // 完成是成就感而非退场:用完成时刻做认可标识,替代已无意义的优先级。
              <span className="done-at-chip">
                {formatIsoTime(task.completed_at)
                  ? `完成于 ${formatIsoTime(task.completed_at)}`
                  : "已完成"}
              </span>
            ) : (
              <span>{priorityLabel(task.priority)}</span>
            )}
            {conflict ? <span className="conflict-chip">时间冲突</span> : null}
          </>
        }
        rowAction={
          !selecting && isActiveTask(task) ? (
            <button
              type="button"
              className="btn-ghost danger expand-delete"
              title="移入回收站"
              onClick={(e) => {
                e.stopPropagation();
                void onDelete();
              }}
            >
              删除
            </button>
          ) : null
        }
        actions={
          !selecting && isActiveTask(task) ? (
            <RowMenu task={task} cursor={cursor} />
          ) : null
        }
      />
    </div>
  );
}

/**
 * One flat "what to do today" list: active tasks first, completed sink to the
 * bottom. Rows drag-reorder across the whole list; the resulting id order is
 * reported to the parent for saving.
 */
export function TodayAgenda({
  tasks,
  cursor,
  today,
  isTodayView,
  isInbox,
  conflictIds,
  selecting,
  selectedIds,
  toolbar,
  headerExtra,
  onToggleSelect,
  onReorder,
}: {
  tasks: Task[];
  cursor: string;
  today: string;
  isTodayView: boolean;
  isInbox: boolean;
  conflictIds: Set<string>;
  selecting: boolean;
  selectedIds: string[];
  toolbar?: ReactNode;
  headerExtra?: ReactNode;
  onToggleSelect: (id: string) => void;
  onReorder: (ids: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = tasks.findIndex((task) => task.id === activeId);
    const to = tasks.findIndex((task) => task.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...tasks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next.map((task) => task.id));
  };

  const title = isInbox
    ? "待办事项"
    : isTodayView
      ? cursor === today
        ? "今日事项"
        : "当日事项"
      : cursor === today
        ? "今日安排"
        : "当日安排";

  return (
    <div className="day-agenda">
      <div className="scope-section-head">
        <h3 className="scope-section-title">{title}</h3>
        {headerExtra}
      </div>
      {toolbar}
      {!tasks.length ? (
        <div className="scope-empty">
          {isInbox ? "待办箱是空的" : "这一天暂无任务"}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext
            items={tasks.filter(isActiveTask).map((task) => task.id)}
            strategy={verticalListSortingStrategy}
          >
            {tasks.map((task) => (
              <DayTaskRow
                key={task.id}
                task={task}
                cursor={cursor}
                conflict={conflictIds.has(task.id)}
                selecting={selecting}
                selected={selectedIds.includes(task.id)}
                onToggleSelect={() => onToggleSelect(task.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
