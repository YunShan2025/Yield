import { useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
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
import { isMobileShell } from "@/lib/platform";
import { ExpandableTaskItem } from "@/components/ExpandableTaskItem";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { formatIsoTime, formatTimeRange, priorityLabel } from "@/lib/dates";
import { confirmAction } from "@/components/AppConfirm";
import type { Task } from "@/types";
import { isActiveTask } from "@/lib/tasks";

/** 触摸屏长按行弹出操作面板的时长。移动端拖拽改由独立手柄启动,
 * 因此行内长按不会与拖拽冲突,只归操作面板。 */
const LONG_PRESS_MS = 480;

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
  const mobile = isMobileShell();
  const [sheetOpen, setSheetOpen] = useState(false);
  const pressRef = useRef({
    timer: undefined as number | undefined,
    x: 0,
    y: 0,
    fired: false,
  });

  const endPress = () => {
    const press = pressRef.current;
    if (press.timer !== undefined) {
      window.clearTimeout(press.timer);
      press.timer = undefined;
    }
  };

  const onTouchStart = (event: React.TouchEvent) => {
    if (!mobile || selecting || !isActiveTask(task)) return;
    // 只在行主体（标题/元信息）启动长按；按钮、勾选框与拖拽手柄不弹操作面板
    // （手柄触摸会冒泡 touchstart，长按拖拽时不能误触面板）。
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "button, input, textarea, select, a, .task-quick-actions, .row-menu",
      )
    ) {
      return;
    }
    const touch = event.touches[0];
    const press = pressRef.current;
    press.x = touch.clientX;
    press.y = touch.clientY;
    press.fired = false;
    press.timer = window.setTimeout(() => {
      press.timer = undefined;
      press.fired = true;
      setSheetOpen(true);
    }, LONG_PRESS_MS);
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const press = pressRef.current;
    if (press.timer === undefined) return;
    const touch = event.touches[0];
    if (
      Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > 12
    ) {
      endPress();
    }
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const press = pressRef.current;
    endPress();
    if (press.fired) {
      press.fired = false;
      // 阻止长按后的合成 click,避免操作面板打开时又弹出详情抽屉。
      event.preventDefault();
    }
  };

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
      {...(mobile ? null : sortable.attributes)}
      {...(mobile ? null : sortable.listeners)}
      onTouchStart={mobile ? onTouchStart : undefined}
      onTouchMove={mobile ? onTouchMove : undefined}
      onTouchEnd={mobile ? onTouchEnd : undefined}
      onTouchCancel={mobile ? endPress : undefined}
      onContextMenu={(event) => {
        if (mobile) event.preventDefault();
      }}
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
          !selecting && isActiveTask(task) && mobile ? (
            <button
              type="button"
              className="btn-ghost drag-handle"
              title="拖动排序"
              aria-label="拖动排序"
              onClick={(e) => e.stopPropagation()}
              {...sortable.attributes}
              {...sortable.listeners}
            >
              ⋮⋮
            </button>
          ) : null
        }
      />
      {sheetOpen ? (
        <TaskActionSheet task={task} cursor={cursor} onClose={() => setSheetOpen(false)} />
      ) : null}
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
  // 移动端用 TouchSensor 长按启动拖拽:短触/滑动仍归滚动,长按才进入排序,互不干扰。
  const sensors = useSensors(
    useSensor(
      isMobileShell() ? TouchSensor : PointerSensor,
      isMobileShell()
        ? { activationConstraint: { delay: 180, tolerance: 8 } }
        : { activationConstraint: { distance: 8 } },
    ),
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
