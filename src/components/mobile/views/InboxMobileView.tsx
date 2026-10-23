import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { AppIcon } from "@/components/AppIcon";
import { DatePicker } from "@/components/DatePicker";
import {
  MobileTaskPillView,
  getMobileTaskPills,
} from "@/components/mobile/MobileTaskPills";
import { MobileTaskRow } from "@/components/mobile/MobileTaskRow";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { confirmAction } from "@/components/AppConfirm";
import { addDays, formatDueDateBadge } from "@/lib/dates";
import { buildTaskDeferredUpdate } from "@/lib/planning";
import { groupInboxTasks, isActiveTask, isInboxTask } from "@/lib/tasks";
import type { InboxGroupId } from "@/lib/tasks";
import { useTodayDate } from "@/lib/useTodayDate";
import type { Project, Tag, Task } from "@/types";

/** 完成后的退场时长；与 mobile.css 里 .is-leaving 的 transition 对齐。 */
const EXIT_MS = 260;

const GROUP_ORDER: InboxGroupId[] = [
  "overdue",
  "scheduled",
  "unscheduled",
];

const GROUP_META: Record<
  InboxGroupId,
  { label: string; tone: "overdue" | "scheduled" | "none" }
> = {
  overdue: { label: "逾期", tone: "overdue" },
  scheduled: { label: "已排期", tone: "scheduled" },
  unscheduled: { label: "未安排", tone: "none" },
};

function InboxSummary({
  pending,
  counts,
  hint,
}: {
  pending: number;
  counts: Record<InboxGroupId, number>;
  hint: string;
}) {
  return (
    <section className="mtoday-card minbox-summary" aria-label="待办箱概况">
      <div className="minbox-summary-top">
        <span className="minbox-summary-total">
          <b>{pending}</b>
          <span>件待整理</span>
        </span>
        <span className="minbox-summary-hint">{hint}</span>
      </div>
      <div className="minbox-summary-bar" aria-hidden="true">
        {GROUP_ORDER.map((id) =>
          counts[id] ? (
            <i
              key={id}
              className={`is-${GROUP_META[id].tone}`}
              style={{ flexGrow: counts[id] }}
            />
          ) : null,
        )}
      </div>
      <div className="minbox-summary-legend">
        {GROUP_ORDER.map((id) => (
          <span key={id} className={`is-${GROUP_META[id].tone}`}>
            <i aria-hidden="true" />
            {GROUP_META[id].label}
            <b>{counts[id]}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

function InboxTaskRow({
  task,
  today,
  projects,
  tags,
  tagMap,
  selecting,
  selected,
  leaving,
  onToggleSelect,
  onComplete,
  onOpen,
  onMore,
}: {
  task: Task;
  today: string;
  projects: Project[];
  tags: Tag[];
  tagMap: Record<string, string[]>;
  selecting: boolean;
  selected: boolean;
  leaving: boolean;
  onToggleSelect: (id: string) => void;
  onComplete: (task: Task) => void;
  onOpen: (task: Task) => void;
  onMore: (task: Task) => void;
}) {
  const done = task.status === "completed";
  const selectable = isActiveTask(task);
  const due = formatDueDateBadge(task.due_date, today);
  const pills = getMobileTaskPills(task, projects, tags, tagMap);

  return (
    <MobileTaskRow
      className={`minbox-row${done ? " is-done" : ""}${leaving ? " is-leaving" : ""}`}
      label={
        selecting && selectable
          ? `${selected ? "取消选择" : "选择"} ${task.title}`
          : undefined
      }
      selected={selecting && selectable ? selected : undefined}
      disabled={selecting && !selectable}
      pressEnabled={!selecting}
      onActivate={() => {
        if (selecting) {
          if (selectable) onToggleSelect(task.id);
          return;
        }
        onOpen(task);
      }}
      onLongPress={() => onMore(task)}
    >
      {selecting && selectable ? (
        <button
          type="button"
          className={`minbox-selectbox${selected ? " is-selected" : ""}`}
          aria-label={selected ? `取消选择 ${task.title}` : `选择 ${task.title}`}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect(task.id);
          }}
        />
      ) : null}
      <span className="minbox-main">
        <span className="minbox-title">{task.title}</span>
        <span className="minbox-meta">
          <i
            className={`minbox-pdot pr${task.priority}`}
            aria-hidden="true"
          />
          <span
            className={`minbox-due is-${due.tone}`}
            title={due.title}
            aria-label={
              due.tone === "none"
                ? "未安排日期"
                : `${due.label}，${due.title}`
            }
          >
            {due.label}
          </span>
          {pills.map((pill) => (
            <MobileTaskPillView key={pill.key} pill={pill} />
          ))}
        </span>
      </span>
      {!selecting ? (
        <span className="minbox-actions">
          {!leaving ? (
            <button
              type="button"
              className="minbox-more"
              aria-label={`更多操作：${task.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onMore(task);
              }}
            >
              <AppIcon name="dots" size={22} />
            </button>
          ) : null}
          <button
            type="button"
            className={`mtoday-check${done ? " is-done" : ""}`}
            aria-label={done ? `已完成 ${task.title}` : `完成 ${task.title}`}
            aria-pressed={done}
            disabled={leaving}
            onClick={(event) => {
              event.stopPropagation();
              onComplete(task);
            }}
          />
        </span>
      ) : null}
    </MobileTaskRow>
  );
}

/**
 * 移动端「待办箱」—— 待办事项卡片流。
 * 顶部摘要给出逾期 / 已排期 / 未安排的数量，列表按这三组整理；
 * 活跃任务才入列，完成项原地淡出后退场。
 * 行内保留优先级方点、日期徽标、项目/标签胶囊与完成圆钮，
 * 长按或点行尾更多按钮打开操作面板；「整理」进入批量选择。
 */
export function InboxMobileView() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const saveTasksBatch = useAppStore((s) => s.saveTasksBatch);
  const batchComplete = useAppStore((s) => s.batchComplete);
  const batchDelete = useAppStore((s) => s.batchDelete);
  const setToast = useAppStore((s) => s.setToast);
  const selectTask = useAppStore((s) => s.selectTask);
  const openCreateTask = useAppStore((s) => s.openCreateTask);

  const today = useTodayDate();
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set());
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dateOpen, setDateOpen] = useState(false);
  const [batchDate, setBatchDate] = useState(() => addDays(today, 1));
  const exitTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // 活跃任务：口径与桌面待办箱、底部导航徽标一致。
  const activeInboxTasks = useMemo(() => {
    return tasks.filter(
      (task) =>
        !task.parent_id &&
        !task.deleted_at &&
        isInboxTask(task, today),
    );
  }, [tasks, today]);

  // 正在退场的完成项短暂保留，保证淡出动画不因过滤立刻中断。
  const visibleTasks = useMemo(() => {
    if (!leavingIds.size) return activeInboxTasks;
    const byId = new Map(activeInboxTasks.map((task) => [task.id, task]));
    for (const task of tasks) {
      if (
        leavingIds.has(task.id) &&
        !task.parent_id &&
        !task.deleted_at
      ) {
        byId.set(task.id, task);
      }
    }
    return Array.from(byId.values());
  }, [activeInboxTasks, leavingIds, tasks]);

  const activeGroups = useMemo(
    () => groupInboxTasks(activeInboxTasks, today),
    [activeInboxTasks, today],
  );
  const visibleGroups = useMemo(
    () => groupInboxTasks(visibleTasks, today),
    [visibleTasks, today],
  );

  const counts = useMemo(() => {
    const next: Record<InboxGroupId, number> = {
      overdue: 0,
      scheduled: 0,
      unscheduled: 0,
    };
    for (const group of activeGroups) next[group.id] = group.tasks.length;
    return next;
  }, [activeGroups]);

  const pending = activeInboxTasks.length;
  const summaryHint = counts.overdue
    ? "先处理逾期"
    : counts.scheduled
      ? "按日期推进"
      : "给它们一个日期";

  const selectedTasks = useMemo(
    () =>
      visibleTasks.filter(
        (task) => selectedIds.has(task.id) && isActiveTask(task),
      ),
    [visibleTasks, selectedIds],
  );
  const selectedCount = selectedTasks.length;
  const selectableIds = useMemo(
    () => visibleTasks.filter(isActiveTask).map((task) => task.id),
    [visibleTasks],
  );
  const allSelected =
    selectableIds.length > 0 && selectedCount === selectableIds.length;

  const beginExit = (id: string) => {
    setLeavingIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    const existing = exitTimers.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      exitTimers.current.delete(id);
      setLeavingIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }, EXIT_MS);
    exitTimers.current.set(id, timer);
  };

  const complete = (task: Task) => {
    if (task.status === "completed") return;
    beginExit(task.id);
    void toggleComplete(task.id);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const beginSelecting = () => {
    setSheetTask(null);
    setSelecting(true);
    setSelectedIds(new Set());
    setDateOpen(false);
    setBatchDate(addDays(today, 1));
  };

  const endSelecting = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    setDateOpen(false);
  };

  const selectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  };

  const scheduleSelected = async (date: string) => {
    if (!date || !selectedTasks.length) return;
    const ids = selectedTasks.map((task) => task.id);
    try {
      await saveTasksBatch(
        ids.map((id) => ({
          id,
          updates: buildTaskDeferredUpdate(date),
        })),
      );
      setToast(
        `已将 ${ids.length} 项安排到 ${formatDueDateBadge(date, today).label}`,
      );
      endSelecting();
    } catch {
      // saveTasksBatch 已在 store 里写入错误提示。
    }
  };

  const completeSelected = async () => {
    if (!selectedTasks.length) return;
    await batchComplete(selectedTasks.map((task) => task.id));
    endSelecting();
  };

  const deleteSelected = async () => {
    if (!selectedTasks.length) return;
    const ids = selectedTasks.map((task) => task.id);
    const ok = await confirmAction({
      title: "移入回收站？",
      description: `将把选中的 ${ids.length} 项任务移入回收站。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await batchDelete(ids);
      endSelecting();
    } catch {
      setToast("批量删除失败");
    }
  };

  return (
    <div
      className={`mtoday minbox${selecting ? " is-selecting" : ""}${selecting && dateOpen ? " is-date-open" : ""}`}
    >
      <header className="mtoday-top">
        <div className="mtoday-top-text">
          <h2>待办箱</h2>
          <p>{pending ? "逾期优先，按日期整理" : "暂无待办"}</p>
        </div>
      </header>

      <div className="mtoday-scroll">
        {visibleTasks.length ? (
          <>
            <InboxSummary
              pending={pending}
              counts={counts}
              hint={summaryHint}
            />
            <section className="mtoday-card" aria-label="待办事项">
              <div className="mtoday-shead">
                <h3>待办事项</h3>
                <span className="minbox-shead-actions">
                  <span className="mtoday-hint">{pending} 项</span>
                  {pending && !selecting ? (
                    <button type="button" onClick={beginSelecting}>
                      整理
                    </button>
                  ) : null}
                </span>
              </div>
              {visibleGroups.map((group) => {
                const meta = GROUP_META[group.id];
                const activeCount = group.tasks.filter(isActiveTask).length;
                return (
                  <div
                    key={group.id}
                    className={`minbox-group is-${meta.tone}`}
                  >
                    <div className="minbox-group-head">
                      <span className="minbox-group-title">
                        <i className="minbox-group-dot" aria-hidden="true" />
                        {meta.label}
                      </span>
                      <span className="minbox-group-count">{activeCount}</span>
                    </div>
                    <ul className="mtoday-list">
                      {group.tasks.map((task) => (
                        <InboxTaskRow
                          key={task.id}
                          task={task}
                          today={today}
                          projects={projects}
                          tags={tags}
                          tagMap={tagMap}
                          selecting={selecting}
                          selected={selectedIds.has(task.id)}
                          leaving={
                            task.status === "completed" &&
                            leavingIds.has(task.id)
                          }
                          onToggleSelect={toggleSelect}
                          onComplete={complete}
                          onOpen={(task) => selectTask(task.id)}
                          onMore={(task) => setSheetTask(task)}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          </>
        ) : (
          <section className="mtoday-card minbox-empty" aria-label="待办箱为空">
            <span className="minbox-empty-mark" aria-hidden="true">
              <AppIcon name="inbox" size={22} />
            </span>
            <h3>待办箱空了</h3>
            <p>想到什么，先记下来，稍后再安排日期。</p>
            <button
              type="button"
              className="minbox-empty-cta"
              onClick={() => openCreateTask({ inbox: true })}
            >
              记一件事
            </button>
          </section>
        )}
      </div>

      {selecting ? (
        <div
          className="mtoday-card minbox-batchbar"
          role="region"
          aria-label="批量整理"
        >
          <div className="minbox-batchbar-head">
            <b>已选 {selectedCount} 项</b>
            <span className="minbox-batchbar-head-actions">
              <button type="button" onClick={selectAll}>
                {allSelected ? "取消全选" : "全选"}
              </button>
              <button type="button" onClick={endSelecting}>
                取消
              </button>
            </span>
          </div>
          <div className="minbox-batchbar-actions">
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => void scheduleSelected(addDays(today, 1))}
            >
              明天
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              className={dateOpen ? "is-active" : ""}
              onClick={() => setDateOpen((value) => !value)}
            >
              改期…
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              onClick={() => void completeSelected()}
            >
              完成
            </button>
            <button
              type="button"
              disabled={!selectedCount}
              className="danger"
              onClick={() => void deleteSelected()}
            >
              删除
            </button>
          </div>
          {dateOpen ? (
            <div className="minbox-batch-date">
              <span>改期到</span>
              <DatePicker
                value={batchDate}
                onChange={(next) => {
                  setBatchDate(next);
                  if (next) void scheduleSelected(next);
                }}
                ariaLabel="批量改期日期"
              />
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="mtoday-fab"
          aria-label="新建任务"
          onClick={() => openCreateTask({ inbox: true })}
        />
      )}

      {!selecting && sheetTask ? (
        <TaskActionSheet
          task={sheetTask}
          cursor={today}
          onClose={() => setSheetTask(null)}
        />
      ) : null}
    </div>
  );
}
