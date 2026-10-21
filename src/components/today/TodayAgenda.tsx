import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { AppIcon } from "@/components/AppIcon";
import { SelectMenu } from "@/components/SelectMenu";import { formatIsoTime, formatTimeRange, priorityLabel } from "@/lib/dates";
import { confirmAction } from "@/components/AppConfirm";
import { fetchGoals } from "@/lib/db";
import type { CSSProperties } from "react";
import type { Goal, Habit, Task } from "@/types";
import { isActiveTask } from "@/lib/tasks";
import { mondayWeekDates } from "@/lib/weeklyChecklist";
import { parseRepeatRule, weeklyTargetFromRule } from "@/lib/repeat";
import { orderTodayTasks } from "@/lib/today";
/** 触摸屏长按行弹出操作面板的时长。移动端拖拽改由独立手柄启动,
 * 因此行内长按不会与拖拽冲突,只归操作面板。 */
const LONG_PRESS_MS = 480;

/** 目标筛选里的「未关联目标」哨兵值。 */
const NO_GOAL_FILTER = "__no_goal__";

/** 今日清单的一行：任务或习惯，二者可以互相拖动排序。 */
type AgendaRow =
  | { kind: "task"; id: string; task: Task }
  | { kind: "habit"; id: string; habit: Habit };

/** 布尔状态「刚刚」由假变真时为 true,用于只在用户操作的那一次播放落金动效。 */
function useJustToggled(value: boolean, duration = 620): boolean {
  const [just, setJust] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (!value) return;
    setJust(true);
    const timer = window.setTimeout(() => setJust(false), duration);
    return () => window.clearTimeout(timer);
  }, [value, duration]);
  return just;
}

function DayTaskRow({
  task,
  cursor,
  goal,
  conflict,
  selecting,
  selected,
  onToggleSelect,
}: {
  task: Task;
  cursor: string;
  goal: Goal | null;
  conflict: boolean;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const deleteTask = useAppStore((s) => s.deleteTask);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const justDone = useJustToggled(task.status === "completed");
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
        "button, input, textarea, select, a, .task-quick-actions",
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
        checkable={false}
        selection={
          selecting ? { active: true, selected, onToggle: onToggleSelect } : undefined
        }
        meta={
          <>
            <span>{formatTimeRange(task.due_time, task.end_time)}</span>
            {task.goal_id && goal ? (
              <span
                className="goal-chip"
                style={{ "--goal-color": goal.color } as CSSProperties}
              >
                <i aria-hidden />
                {goal.title}
              </span>
            ) : null}
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
              className="item-action-btn item-action-danger expand-delete"
              title="移入回收站"
              onClick={(e) => {
                e.stopPropagation();
                void onDelete();
              }}
            >
              <AppIcon name="trash" size={14} />
              <span>删除</span>
            </button>
          ) : null
        }
        primaryAction={
          !selecting ? (
            <button
              type="button"
              className={`item-action-btn item-action-primary${task.status === "completed" ? " is-done" : ""}${justDone ? " is-flash" : ""}`}
              title={task.status === "completed" ? "标为未完成" : "标为完成"}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                void toggleComplete(task.id);
              }}
            >
              <AppIcon name="check" size={14} />
              <span>{task.status === "completed" ? "已完成" : "完成"}</span>
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

function DayHabitRow({
  habit,
  date,
  goal,
  checkedToday,
  weekDone,
}: {
  habit: Habit;
  date: string;
  goal: Goal | null;
  checkedToday: boolean;
  weekDone: number;
}) {
  const toggleHabitDay = useAppStore((s) => s.toggleHabitDay);
  const justChecked = useJustToggled(checkedToday);
  const rule = parseRepeatRule(habit.repeat_rule ?? null);
  // 固定排期下"每周几次"由排期推算；浮动模式才用习惯自己设的值。
  const target = Math.max(1, weeklyTargetFromRule(rule) ?? habit.target_per_week);
  const weekFull = weekDone >= target;
  const flexible = !rule;

  return (
    <div className={`expand-task habit-agenda-row${checkedToday ? " is-done" : ""}`}>
      <div className="expand-task-row no-check">
        <div className="expand-task-main">
          <p className="task-title">{habit.title}</p>
          <div className="task-meta">
            <span>本周 {weekDone}/{target} 次</span>
            {flexible ? <span className="subtask-count muted">今天做不做都行</span> : null}
            {goal ? (
              <span className="goal-chip" style={{ "--goal-color": goal.color } as CSSProperties}>
                <i aria-hidden />
                {habit.goal_contribution > 0
                  ? `计入 ${goal.title} +${Math.round(habit.goal_contribution * 100) / 100}${goal.unit}`
                  : `服务于 ${goal.title}`}
              </span>
            ) : null}
            {weekFull ? <span className="subtask-count muted">本周目标已达成</span> : null}
          </div>
        </div>
        <button
          type="button"
          className={`item-action-btn item-action-primary${checkedToday ? " is-done" : ""}${justChecked ? " is-flash" : ""}`}
          title={checkedToday ? "取消今日打卡" : "今日打卡"}
          onClick={() => void toggleHabitDay(habit.id, date)}
        >
          <AppIcon name="check" size={14} />
          <span>{checkedToday ? "已打卡" : "打卡"}</span>
        </button>
      </div>
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
  habits = [],
  order = null,
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
  habits?: Habit[];
  /** 手动拖拽保存的顺序（任务与习惯混排）。 */
  order?: string[] | null;
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


  const habitChecks = useAppStore((s) => s.habitChecks);
  const [goals, setGoals] = useState<Goal[]>([]);
  const weekDates = mondayWeekDates(cursor);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const checkedHabitIds = useMemo(
    () =>
      new Set(
        habitChecks
          .filter((item) => item.check_date === cursor)
          .map((item) => item.habit_id),
      ),
    [habitChecks, cursor],
  );
  const habitWeekDone = useMemo(() => {
    const done = new Map<string, number>();
    for (const check of habitChecks) {
      if (check.check_date < weekStart || check.check_date > weekEnd) continue;
      done.set(check.habit_id, (done.get(check.habit_id) ?? 0) + 1);
    }
    return done;
  }, [habitChecks, weekStart, weekEnd]);

  useEffect(() => {
    // 行内目标徽标需要目标标题/颜色；含归档目标，避免历史关联行缺失标签。
    // 对端新建的目标也要当场认得出，故跟随同步事件重载。
    const reload = () => void fetchGoals(true).then(setGoals);
    reload();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
  }, []);

  const goalById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal])),
    [goals],
  );

  const title = isInbox
    ? "待办事项"
    : isTodayView
      ? cursor === today
        ? "今日事项"
        : "当日事项"
      : cursor === today
        ? "今日安排"
        : "当日安排";

  // 目标筛选：只看某个目标在推进的事，或只看没关联目标的事。
  const [goalFilter, setGoalFilter] = useState("");

  const matchesGoalFilter = (goalId: string | null) => {
    if (!goalFilter) return true;
    if (goalFilter === NO_GOAL_FILTER) return !goalId;
    return goalId === goalFilter;
  };

  const visibleTasks = tasks.filter((task) => matchesGoalFilter(task.goal_id));
  const visibleHabits = habits.filter((habit) => matchesGoalFilter(habit.goal_id));

  const weekTargetOf = (habit: Habit) => {
    const rule = parseRepeatRule(habit.repeat_rule ?? null);
    return Math.max(1, weeklyTargetFromRule(rule) ?? habit.target_per_week);
  };

  // 一张真正扁平的今日清单：今天该做且没达标的习惯 → 未完成任务 → 本周已达标
  // 的习惯 → 已打卡的习惯 → 已完成的任务。完成/打卡时 key 不变，React 复用同
  // 一个行实例，落金动效与行内状态不会被卸载打断。
  const defaultRows: AgendaRow[] = [
    ...visibleHabits
      .filter(
        (habit) =>
          !checkedHabitIds.has(habit.id) &&
          (habitWeekDone.get(habit.id) ?? 0) < weekTargetOf(habit),
      )
      .map((habit) => ({ kind: "habit" as const, id: habit.id, habit })),
    ...orderTodayTasks(visibleTasks, null)
      .filter(isActiveTask)
      .map((task) => ({ kind: "task" as const, id: task.id, task })),
    ...visibleHabits
      .filter(
        (habit) =>
          !checkedHabitIds.has(habit.id) &&
          (habitWeekDone.get(habit.id) ?? 0) >= weekTargetOf(habit),
      )
      .map((habit) => ({ kind: "habit" as const, id: habit.id, habit })),
    ...visibleHabits
      .filter((habit) => checkedHabitIds.has(habit.id))
      .map((habit) => ({ kind: "habit" as const, id: habit.id, habit })),
    ...visibleTasks
      .filter((task) => task.status === "completed")
      .map((task) => ({ kind: "task" as const, id: task.id, task })),
  ];

  // 手动排序优先；没出现在保存顺序里的行按默认顺序补在后面。
  const rank = new Map((order ?? []).map((id, index) => [id, index]));
  const defaultIndex = new Map(defaultRows.map((row, index) => [row.id, index]));
  const rows = [...defaultRows].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return (defaultIndex.get(a.id) ?? 0) - (defaultIndex.get(b.id) ?? 0);
  });

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = rows.findIndex((row) => row.id === activeId);
    const to = rows.findIndex((row) => row.id === overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next.map((row) => row.id));
  };

  return (
    <div className="day-agenda">
      <div className="scope-section-head">
        <h3 className="scope-section-title">{title}</h3>
        <div className="day-agenda-filters">
          <SelectMenu
            ariaLabel="按目标筛选"
            value={goalFilter}
            onChange={setGoalFilter}
            options={[
              { value: "", label: "全部目标" },
              { value: NO_GOAL_FILTER, label: "未关联目标" },
              ...goals
                .filter((goal) => goal.status === "active" || goal.status === "paused")
                .map((goal) => ({ value: goal.id, label: goal.title })),
            ]}
          />
          {headerExtra}
        </div>
      </div>
      {toolbar}
      {!visibleTasks.length && !visibleHabits.length ? (
        <div className="scope-empty">
          {isInbox ? "待办箱是空的" : "这一天暂无事项"}
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <SortableContext
            items={rows
              .filter((row) => row.kind === "task" || !checkedHabitIds.has(row.id))
              .map((row) => row.id)}
            strategy={verticalListSortingStrategy}
          >
            {rows.map((row) =>
              row.kind === "habit" ? (
                <DayHabitRow
                  key={row.id}
                  habit={row.habit}
                  date={today}
                  goal={row.habit.goal_id ? goalById.get(row.habit.goal_id) ?? null : null}
                  checkedToday={checkedHabitIds.has(row.habit.id)}
                  weekDone={habitWeekDone.get(row.habit.id) ?? 0}
                />
              ) : (
                <DayTaskRow
                  key={row.task.id}
                  task={row.task}
                  cursor={cursor}
                  goal={row.task.goal_id ? goalById.get(row.task.goal_id) ?? null : null}
                  conflict={conflictIds.has(row.task.id)}
                  selecting={selecting}
                  selected={selectedIds.includes(row.task.id)}
                  onToggleSelect={() => onToggleSelect(row.task.id)}
                />
              ),
            )}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
