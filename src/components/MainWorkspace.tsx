import { lazy, Suspense, useEffect, useMemo, useState } from "react";
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
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import {
  boardColumns,
  filterTasksByView,
  getEmptyMessage,
  getViewTitle,
} from "@/lib/tasks";
import { addDays, formatDateBrief, formatDueDate, formatLongDate, formatStamp, formatStampBrief, todayDateString } from "@/lib/dates";
import type { Goal, Habit, Project, Task } from "@/types";
import { ExpandableTaskItem } from "@/components/ExpandableTaskItem";
import { AppIcon } from "@/components/AppIcon";
import { confirmAction } from "@/components/AppConfirm";
import {
  fetchDeletedProjects,
  fetchDeletedGoals,
  fetchDeletedHabits,
  fetchLedgerTrash,
  formatLedgerMoney,
  purgeLedgerTransaction,
  purgeProject,
  purgeGoal,
  purgeHabit,
  restoreDeletedProject,
  restoreDeletedHabit,
  restoreGoal,
  restoreLedgerTransaction,
  type LedgerTransaction,
} from "@/lib/db";
import { DayBoard } from "@/components/today/DayBoard";
import { TodayMobileView } from "@/components/mobile/views/TodayMobileView";
import { InboxMobileView } from "@/components/mobile/views/InboxMobileView";
import { LedgerMobileView } from "@/components/mobile/views/LedgerMobileView";

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
const GoalsView = lazy(() =>
  import("@/components/GoalsView").then((module) => ({
    default: module.GoalsView,
  })),
);
const FootprintView = lazy(() =>
  import("@/components/FootprintView").then((module) => ({
    default: module.FootprintView,
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






function TrashView() {
  const trashTasks = useAppStore((s) => s.trashTasks);
  const restoreTask = useAppStore((s) => s.restoreTask);
  const purgeTask = useAppStore((s) => s.purgeTask);
  const purgeTrash = useAppStore((s) => s.purgeTrash);
  const refreshAll = useAppStore((s) => s.refreshAll);
  // 账本回收站：软删的账目行（页内本地状态，与收支总览一致）。
  const [ledgerTrash, setLedgerTrash] = useState<LedgerTransaction[]>([]);
  // 项目回收站：软删的项目行（同样走本地状态，任务回收站来自 store）。
  const [projectTrash, setProjectTrash] = useState<Project[]>([]);
  const [habitTrash, setHabitTrash] = useState<Habit[]>([]);
  // 目标回收站：软删的目标行，可恢复、可永久删除。
  const [goalTrash, setGoalTrash] = useState<Goal[]>([]);
  const loadLedgerTrash = async () => {
    try {
      setLedgerTrash(await fetchLedgerTrash());
    } catch {
      /* 回收站里账目加载失败不阻塞任务列表 */
    }
  };
  const loadGoalTrash = async () => {
    try {
      setGoalTrash(await fetchDeletedGoals());
    } catch {
      /* 回收站里目标加载失败不阻塞其它列表 */
    }
  };
  const loadProjectTrash = async () => {
    try {
      setProjectTrash(await fetchDeletedProjects());
    } catch {
      /* 回收站里项目加载失败不阻塞任务列表 */
    }
  };
  const loadHabitTrash = async () => {
    try {
      setHabitTrash(await fetchDeletedHabits());
    } catch {
      /* 回收站里习惯加载失败不阻塞任务列表 */
    }
  };
  useEffect(() => {
    void loadLedgerTrash();
    void loadProjectTrash();
    void loadHabitTrash();
    void loadGoalTrash();
    const reload = () => {
      void loadLedgerTrash();
      void loadProjectTrash();
      void loadHabitTrash();
      void loadGoalTrash();
    };
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
  }, []);
  const total =
    trashTasks.length +
    ledgerTrash.length +
    projectTrash.length +
    habitTrash.length +
    goalTrash.length;

  const restoreLedger = async (id: number) => {
    if (await restoreLedgerTransaction(id)) await loadLedgerTrash();
  };

  /* 清空回收站：两端顶卡共用（移动壳读数卡右上的危险药丸 / 桌面行尾按钮）。 */
  const purgeAll = () => {
    void confirmAction({
      title: `确定清空回收站的 ${total} 项？`,
      description: "此操作不可恢复。",
      confirmText: "清空",
      danger: true,
    }).then(async (ok) => {
      if (!ok) return;
      if (goalTrash.length) {
        for (const item of goalTrash) await purgeGoal(item.id);
        await refreshAll();
        void loadGoalTrash();
      }
      if (projectTrash.length) {
        for (const item of projectTrash) await purgeProject(item.id);
        await refreshAll();
        void loadProjectTrash();
      }
      if (ledgerTrash.length) {
        for (const item of ledgerTrash) await purgeLedgerTransaction(item.id);
      }
      if (habitTrash.length) {
        for (const item of habitTrash) await purgeHabit(item.id);
        await refreshAll();
        void loadHabitTrash();
      }
      void purgeTrash();
      void loadProjectTrash();
      void loadLedgerTrash();
      void loadHabitTrash();
    });
  };

  return (
    <div className="task-scroll">
      {isMobileShell() ? (
        /* 移动壳顶卡：四页同款读数型引导卡（guide-stat）——大读数＋一句 hint，
           「清空」收成危险小药丸钉卡右上；桌面保持原文字卡＋行尾按钮。 */
        <section className="mtoday-card guide-stat is-compact" aria-label="回收站概况">
          <div className="guide-stat-top">
            <span className="guide-stat-total">
              <b>{total}</b>
              <span>项</span>
            </span>
            <span className="guide-stat-label">回收站</span>
          </div>
          <p className="trash-note">删除保留 30 天，可随时恢复；清空后无法恢复。</p>
          <button type="button" className="trash-clear" disabled={!total} onClick={purgeAll}>
            清空
          </button>
          <span className="mtoday-wheat" aria-hidden="true" />
        </section>
      ) : (
        <section className="trash-summary" aria-label="回收站概况">
          <div className="trash-summary-copy">
            <strong>已删除 {total} 项</strong>
            <p>删除保留 30 天，可随时恢复；清空或永久删除后无法恢复。</p>
          </div>
          <button type="button" className="btn-ghost danger" disabled={!total} onClick={purgeAll}>
            清空回收站
          </button>
        </section>
      )}
      {!total ? (
        /* 空态：移动壳升 anni-empty 两行壳（与备忘/纪念日同族）；桌面保留诗意句。 */
        isMobileShell() ? (
          <div className="empty-state anni-empty">
            <strong>回收站是空的</strong>
            <p>删掉的东西会先收在这里，30 天内能回来。</p>
          </div>
        ) : (
          <div className="empty-state">{getEmptyMessage("trash")}</div>
        )
      ) : (
        <div className="trash-list">
          {trashTasks.map((task) => (
            <article key={task.id} className="trash-item">
              <div className="trash-item-main">
                <p className="task-title">
                  {isMobileShell() ? <em className="kind-badge is-blue">任务</em> : null}
                  {task.title}
                </p>
                <div className="trash-item-meta">
                  {task.deleted_at ? (
                    <span>
                      删除于 {isMobileShell() ? formatStampBrief(task.deleted_at) : formatStamp(task.deleted_at)}
                    </span>
                  ) : null}
                  <span>{isMobileShell() ? `P${task.priority}` : `优先级 P${task.priority}`}</span>
                  {task.due_date ? (
                    <span>
                      原截止 {isMobileShell() ? formatDateBrief(task.due_date) : formatDueDate(task.due_date)}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="item-action-btn item-action-archive item-action-restore"
                  onClick={() => void restoreTask(task.id)}
                >
                  <AppIcon name="review" size={14} />
                  <span>恢复</span>
                </button>
                <button
                  type="button"
                  className="item-action-btn item-action-danger"
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
                  <AppIcon name="trash" size={14} />
                  <span>永久删除</span>
                </button>
              </div>
            </article>
          ))}
          {habitTrash.map((habit) => (
            <article key={`habit-${habit.id}`} className="trash-item">
              <div className="trash-item-main">
                <p className="task-title">
                  {isMobileShell() ? <em className="kind-badge is-warm">习惯</em> : null}
                  {habit.title}
                </p>
                <div className="trash-item-meta">
                  {habit.deleted_at ? (
                    <span>
                      删除于 {isMobileShell() ? formatStampBrief(habit.deleted_at) : formatStamp(habit.deleted_at)}
                    </span>
                  ) : null}
                  {!isMobileShell() ? <span>习惯</span> : null}
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="item-action-btn item-action-archive item-action-restore"
                  onClick={() =>
                    void restoreDeletedHabit(habit.id).then(async () => {
                      await refreshAll();
                      await loadHabitTrash();
                    })
                  }
                >
                  <AppIcon name="review" size={14} />
                  <span>恢复</span>
                </button>
                <button
                  type="button"
                  className="item-action-btn item-action-danger"
                  onClick={() => {
                    void confirmAction({
                      title: `永久删除习惯「${habit.title}」？`,
                      description: "不可恢复。",
                      confirmText: "永久删除",
                      danger: true,
                    }).then((ok) => {
                      if (ok) {
                        void purgeHabit(habit.id).then(async () => {
                          await refreshAll();
                          await loadHabitTrash();
                        });
                      }
                    });
                  }}
                >
                  <AppIcon name="trash" size={14} />
                  <span>永久删除</span>
                </button>
              </div>
            </article>
          ))}
          {goalTrash.map((goal) => (
            <article key={`goal-${goal.id}`} className="trash-item">
              <div className="trash-item-main">
                <p className="task-title">
                  {isMobileShell() ? <em className="kind-badge is-blue">目标</em> : null}
                  {goal.title}
                </p>
                <div className="trash-item-meta">
                  {goal.deleted_at ? (
                    <span>
                      删除于 {isMobileShell() ? formatStampBrief(goal.deleted_at) : formatStamp(goal.deleted_at)}
                    </span>
                  ) : null}
                  {!isMobileShell() ? <span>目标</span> : null}
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="item-action-btn item-action-archive item-action-restore"
                  onClick={() =>
                    void restoreGoal(goal.id).then(async () => {
                      await refreshAll();
                      await loadGoalTrash();
                    })
                  }
                >
                  <AppIcon name="review" size={14} />
                  <span>恢复</span>
                </button>
                <button
                  type="button"
                  className="item-action-btn item-action-danger"
                  onClick={() => {
                    void confirmAction({
                      title: `永久删除目标「${goal.title}」？`,
                      description: "不可恢复，目标与它的记录会一并删除。",
                      confirmText: "永久删除",
                      danger: true,
                    }).then((ok) => {
                      if (ok) {
                        void purgeGoal(goal.id).then(async () => {
                          await refreshAll();
                          await loadGoalTrash();
                        });
                      }
                    });
                  }}
                >
                  <AppIcon name="trash" size={14} />
                  <span>永久删除</span>
                </button>
              </div>
            </article>
          ))}
          {projectTrash.map((project) => (
            <article key={`project-${project.id}`} className="trash-item">
              <div className="trash-item-main">
                <p className="task-title">
                  {isMobileShell() ? <em className="kind-badge is-neutral">项目</em> : null}
                  <span className="tag-card-dot" style={{ background: project.color }} aria-hidden />
                  {project.name}
                </p>
                <div className="trash-item-meta">
                  {project.deleted_at ? (
                    <span>
                      删除于 {isMobileShell() ? formatStampBrief(project.deleted_at) : formatStamp(project.deleted_at)}
                    </span>
                  ) : null}
                  {!isMobileShell() ? <span>项目</span> : null}
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="item-action-btn item-action-archive item-action-restore"
                  onClick={() =>
                    void restoreDeletedProject(project.id).then(async () => {
                      // 项目回到进行中列表依赖 store 刷新，与任务恢复同款。
                      await refreshAll();
                      await loadProjectTrash();
                    })
                  }
                >
                  <AppIcon name="review" size={14} />
                  <span>恢复</span>
                </button>
                <button
                  type="button"
                  className="item-action-btn item-action-danger"
                  onClick={() => {
                    void confirmAction({
                      title: `永久删除项目「${project.name}」？`,
                      description: "不可恢复；项目下的任务会保留但不再归属该项目。",
                      confirmText: "永久删除",
                      danger: true,
                    }).then((ok) => {
                      if (ok) {
                        void purgeProject(project.id).then(async () => {
                          // 永久删除会摘除任务的项目归属，需刷新 store。
                          await refreshAll();
                          await loadProjectTrash();
                        });
                      }
                    });
                  }}
                >
                  <AppIcon name="trash" size={14} />
                  <span>永久删除</span>
                </button>
              </div>
            </article>
          ))}
          {ledgerTrash.map((item) => (
            <article key={`ledger-${item.id}`} className="trash-item">
              <div className="trash-item-main">
                <p className="task-title">
                  {isMobileShell() ? <em className="kind-badge is-neutral">记账</em> : null}
                  <span
                    className="ledger-row-icon"
                    style={{ background: `${item.category_color}20`, color: item.category_color }}
                  >
                    {item.category_name.slice(0, 1)}
                  </span>
                  {item.category_name}
                  <span className={item.type === "expense" ? "trash-amount expense" : "trash-amount income"}>
                    {item.type === "expense" ? "−" : "+"}
                    {formatLedgerMoney(item.amount_cents)}
                  </span>
                </p>
                <div className="trash-item-meta">
                  {item.deleted_at ? (
                    <span>
                      删除于 {isMobileShell() ? formatStampBrief(item.deleted_at) : formatStamp(item.deleted_at)}
                    </span>
                  ) : null}
                  <span>{isMobileShell() ? formatDateBrief(item.date) : item.date}</span>
                  <span>{item.type === "expense" ? "支出" : "收入"} · {item.account_name}</span>
                  {item.note ? <span>{item.note}</span> : null}
                </div>
              </div>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="item-action-btn item-action-archive item-action-restore"
                  onClick={() => void restoreLedger(item.id)}
                >
                  <AppIcon name="review" size={14} />
                  <span>恢复</span>
                </button>
                <button
                  type="button"
                  className="item-action-btn item-action-danger"
                  onClick={() => {
                    void confirmAction({
                      title: `永久删除「${item.category_name} ${formatLedgerMoney(item.amount_cents)}」？`,
                      description: "不可恢复。",
                      confirmText: "永久删除",
                      danger: true,
                    }).then((ok) => {
                      if (ok) {
                        void purgeLedgerTransaction(item.id).then(() => loadLedgerTrash());
                      }
                    });
                  }}
                >
                  <AppIcon name="trash" size={14} />
                  <span>永久删除</span>
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
  const tasks = useAppStore((s) => s.tasks);
  const tagMap = useAppStore((s) => s.tagMap);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const openCreateTask = useAppStore((s) => s.openCreateTask);
  // 日期调整器住在页头（新建任务左侧）：cursor 在 store 里，DayBoard 同步响应。
  const cursor = useAppStore((s) => s.calendarCursor);
  const todayStr = todayDateString();

  const visible = useMemo(
    () => filterTasksByView(tasks, nav, tagMap, activeTagId),
    [tasks, nav, tagMap, activeTagId],
  );

  useEffect(() => {
    if (nav === "board") setViewMode("board");
    if (nav === "calendar") setViewMode("calendar");
  }, [nav, setViewMode]);

  // 移动端壳：今日页走单列卡片流（src/components/mobile/views/），
  // 与桌面多栏工作台是两套视图层；共享语义 token，不共享结构。
  if (isMobileShell() && (nav === "today" || nav === "myday")) {
    return <TodayMobileView />;
  }

  if (isMobileShell() && nav === "inbox") {
    return <InboxMobileView />;
  }

  if (isMobileShell() && nav === "ledger") {
    return <LedgerMobileView />;
  }

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
  if (nav === "week") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开周报…</div>}>
        <WeeklyChecklistView />
      </Suspense>
    );
  }
  if (nav === "goals") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开目标…</div>}>
        <GoalsView />
      </Suspense>
    );
  }
  if (nav === "footprint") {
    return (
      <Suspense fallback={<div className="empty-state">正在打开足迹…</div>}>
        <FootprintView />
      </Suspense>
    );
  }
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
          <div>
            <h2 aria-label={isMobileShell() ? getViewTitle("trash") : undefined}>
              {isMobileShell() ? <MobileTitleChars text={getViewTitle("trash")} /> : getViewTitle("trash")}
            </h2>
            <p className="workspace-subtitle">能回来的，就不算失去。</p>
          </div>
        </div>
        <TrashView />
      </main>
    );
  }

  const useScopeBoard = nav !== "board";

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
          {nav === "today" || nav === "myday" ? (
            <div className="scope-nav">
              <button
                type="button"
                className="btn-ghost"
                aria-label="前一天"
                onClick={() => useAppStore.getState().setCalendarCursor(addDays(cursor, -1))}
              >
                ‹
              </button>
              <strong>{formatLongDate(cursor)}</strong>
              <button
                type="button"
                className="btn-ghost"
                aria-label="后一天"
                onClick={() => useAppStore.getState().setCalendarCursor(addDays(cursor, 1))}
              >
                ›
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => useAppStore.getState().setCalendarCursor(todayStr)}
              >
                今日
              </button>
            </div>
          ) : null}
          {nav === "today" ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => openCreateTask()}
            >
              新建任务
            </button>
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

      {useScopeBoard ? <DayBoard /> : null}
      {!useScopeBoard ? <BoardView tasks={visible} /> : null}
    </main>
  );
}
