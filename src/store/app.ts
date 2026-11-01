import { create } from "zustand";
import type {
  AppSettings,
  FocusTaskDraft,
  FocusTaskMode,
  Habit,
  HabitCheck,
  HabitDraft,
  NavId,
  Project,
  Tag,
  Task,
  TaskDraft,
  TaskUpdate,
  ThemeMode,
  Timer,
  TimerDraft,
  ViewMode,
  FocusRequest,
} from "@/types";
import * as db from "@/lib/db";
import { nowIso, todayDateString } from "@/lib/dates";
import { liveRemaining, parseFocusTaskDraft } from "@/lib/timers";
import { syncWindowChrome } from "@/lib/windowChrome";
import { errorMessage } from "@/lib/errors";

const pendingCompleteIds = new Set<string>();

/**
 * 数据写库成功后广播一次。
 *
 * 目标进度这类派生数据不住在 store 里，而在库里——完成任务、打卡都会改写
 * 目标记录。目标条之类的组件要跟着重载，就得有一个"写完了"的信号：只盯着
 * store 的乐观更新去重载，会读到还没写进库的值。
 */
function notifyDataChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("youqiu:data-changed"));
  }
}

interface AppStore {
  ready: boolean;
  error: string | null;
  tasks: Task[];
  trashTasks: Task[];
  tags: Tag[];
  tagMap: Record<string, string[]>;
  habits: Habit[];
  habitChecks: HabitCheck[];
  archivedHabits: Habit[];
  timers: Timer[];
  /** 今日完成的专注段数（focus_logs 流水按本地日聚合），随 refreshTimers 刷新。 */
  focusTodayCount: number;
  projects: Project[];
  archivedProjects: Project[];
  settings: AppSettings;
  nav: NavId;
  viewMode: ViewMode;
  calendarCursor: string;
  selectedTaskId: string | null;
  createTaskOpen: boolean;
  /** 新建任务是否从待办箱发起:截止日期默认不填,不自动排时间。 */
  createTaskInbox: boolean;
  /** 从目标页/今日目标条发起时预关联的目标 id。 */
  createTaskGoalId: string | null;
  commandPaletteOpen: boolean;
  focusRequest: FocusRequest | null;
  activeTagId: string | null;
  toast: string | null;
  canUndo: boolean;
  _undoAction: (() => Promise<void>) | null;

  bootstrap: () => Promise<void>;
  refreshAll: () => Promise<void>;
  setNav: (nav: NavId) => void;
  setViewMode: (mode: ViewMode) => void;
  setCalendarCursor: (date: string) => void;
  selectTask: (id: string | null) => void;
  openCreateTask: (opts?: { inbox?: boolean; goalId?: string }) => void;
  closeCreateTask: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  requestFocus: (request: FocusRequest) => void;
  clearFocus: () => void;
  setActiveTag: (id: string | null) => void;
  setToast: (msg: string | null) => void;
  undo: () => Promise<void>;

  addTask: (draft: TaskDraft) => Promise<Task | null>;
  saveTask: (id: string, updates: TaskUpdate) => Promise<void>;
  saveTasksBatch: (items: { id: string; updates: TaskUpdate }[]) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  setTaskCompletedAt: (id: string, completedAt: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  batchComplete: (ids: string[]) => Promise<void>;
  batchDelete: (ids: string[]) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  purgeTrash: () => Promise<void>;
  purgeTask: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;

  addTag: (name: string, color?: string) => Promise<void>;
  updateTag: (id: string, updates: { name?: string; color?: string }) => Promise<void>;
  removeTag: (id: string) => Promise<void>;
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>;
  addProject: (name: string, tagId?: string | null) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;
  restoreProject: (id: string) => Promise<void>;



  addHabit: (draft: HabitDraft) => Promise<void>;
  updateHabit: (id: string, draft: HabitDraft) => Promise<void>;
  archiveHabit: (id: string) => Promise<void>;
  restoreHabit: (id: string) => Promise<void>;
  removeHabit: (id: string) => Promise<void>;
  toggleHabitDay: (habitId: string, date: string) => Promise<void>;
  /** 改习惯与目标的关联计量：0 = 只关联不计数，>0 = 打卡时计入 N 个单位。 */
  setHabitMeasurement: (habitId: string, contribution: number) => Promise<void>;
  addTimer: (draft: TimerDraft) => Promise<Timer | null>;
  startTimer: (id: string) => Promise<void>;
  pauseTimer: (id: string) => Promise<void>;
  resetTimer: (id: string) => Promise<void>;
  extendTimer: (id: string, additionalSec: number) => Promise<void>;
  /** 编辑一段专注：标题 / 时长 / 任务关联；时长调整保留已专注的时长。 */
  editFocus: (
    id: string,
    patch: {
      title: string;
      interval_sec: number;
      task_mode: FocusTaskMode;
      task_ref_id: string | null;
      task_draft: FocusTaskDraft | null;
    },
  ) => Promise<void>;
  removeTimer: (id: string) => Promise<void>;
  refreshTimers: () => Promise<void>;
  settleTimers: () => Promise<db.FiredTimer[]>;
  /** 结束一段专注，按三档关联收尾：不关联＝只记这趟；已有＝勾掉关联任务；新建＝按预填建任务并完成。 */
  completeFocus: (timer: Timer) => Promise<Task | null>;

  setTheme: (theme: ThemeMode) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

function applyTheme(theme: ThemeMode) {
  // data-theme 必须落成具体的 light/dark：样式层的组件级暗色覆盖
  // （方框、时间轴事件块等 80+ 处）都挂在 [data-theme="dark"] 上，
  // 留着 "system" 的话，跟随系统的深色环境会全部漏掉、沿用浅色硬编码色。
  document.documentElement.dataset.theme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  void syncWindowChrome(theme);
}

/** 倒计时启动提示：有其他倒计时被自动暂停（单实例）时随 toast 告知。 */
function startToast(title: string, pausedTitles: string[]): string {
  const base = `「${title}」已开始`;
  if (!pausedTitles.length) return base;
  return pausedTitles.length === 1
    ? `${base}，「${pausedTitles[0]}」已暂停`
    : `${base}，已暂停其余 ${pausedTitles.length} 个倒计时`;
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  error: null,
  tasks: [],
  trashTasks: [],
  tags: [],
  tagMap: {},
  habits: [],
  habitChecks: [],
  archivedHabits: [],
  timers: [],
  focusTodayCount: 0,
  projects: [],
  archivedProjects: [],
  settings: {
    theme: "system",
    autostart: false,
    privacyMode: false,
    autoBackup: true,
    autoBackupLastOk: null,
    autoBackupLastFailAt: null,
    autoBackupLastError: null,
    autoBackupFailStreak: 0,
    onboardingComplete: false,
  },
  nav: "today",
  viewMode: "board",
  calendarCursor: todayDateString(),
  selectedTaskId: null,
  createTaskOpen: false,
  createTaskInbox: false,
  createTaskGoalId: null,
  commandPaletteOpen: false,
  focusRequest: null,
  activeTagId: null,
  toast: null,
  canUndo: false,
  _undoAction: null,

  bootstrap: async () => {
    try {
      const today = todayDateString();
        await db.ensureDefaultTags();
      // 开机对账：进度永远由事件表按来源活性派生（回收站中的任务/习惯不计，
      // 恢复自动回算）。skipUnchanged 模式数字没变不写库、不刷 updated_at。
      await db.recomputeAllGoals(await db.getDb());
      await get().refreshAll();
      applyTheme(get().settings.theme);
      set({
        ready: true,
        error: null,
        calendarCursor: today,
      });
      window.dispatchEvent(new Event("youqiu:ready"));
    } catch (e) {
      const detail = errorMessage(e, "初始化失败");
      const diskHint =
        /space|磁盘|disk|full|os error 112|SQLITE_FULL|SQLITE_IOERR/i.test(
          detail,
        )
          ? "（系统盘空间不足，请清理 C 盘后重启）"
          : "";
      set({
        ready: true,
        error: `${detail}${diskHint}`,
      });
      window.dispatchEvent(new Event("youqiu:ready"));
    }
  },

  refreshAll: async () => {
    const [
      tasks,
      trashTasks,
      tags,
      tagMap,
      habits,
      habitChecks,
      archivedHabits,
      timers,
      settings,
      projects,
      archivedProjects,
      focusTodayCount,
    ] = await Promise.all([
      db.fetchTasks(),
      db.fetchTrashTasks(),
      db.fetchTags(),
      db.fetchTaskTagMap(),
      db.fetchHabits(),
      db.fetchHabitChecks(),
      db.fetchArchivedHabits(),
      db.fetchTimers(),
      db.loadAppSettings(),
      db.fetchProjects(),
      db.fetchArchivedProjects(),
      db.countFocusToday().catch(() => 0),
    ]);
    set((s) => ({
      tasks,
      trashTasks,
      tags,
      tagMap,
      habits,
      habitChecks,
      archivedHabits,
      timers,
      focusTodayCount,
      // Don't regress onboarding if a concurrent refresh raced ahead of persist.
      settings: {
        ...settings,
        onboardingComplete:
          s.settings.onboardingComplete || settings.onboardingComplete,
      },
      projects,
      archivedProjects,
    }));
    notifyDataChanged();
  },

  setNav: (nav) => {
    if (nav === "myday") nav = "today";
    if (nav === get().nav) return;
    set({
      nav,
      selectedTaskId: null,
      calendarCursor:
        nav === "today" || nav === "week" || nav === "inbox"
          ? todayDateString()
          : get().calendarCursor,
      viewMode:
        nav === "board"
          ? "board"
          : nav === "calendar"
            ? "calendar"
            : get().viewMode,
    });
  },
  setViewMode: (viewMode) => set({ viewMode }),
  setCalendarCursor: (calendarCursor) => set({ calendarCursor }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  openCreateTask: (opts) =>
    set({
      createTaskOpen: true,
      selectedTaskId: null,
      createTaskInbox: Boolean(opts?.inbox),
      createTaskGoalId: opts?.goalId ?? null,
    }),
  closeCreateTask: () =>
    set({ createTaskOpen: false, createTaskInbox: false, createTaskGoalId: null }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  requestFocus: (focusRequest) => set({ focusRequest }),
  clearFocus: () => set({ focusRequest: null }),
  setActiveTag: (activeTagId) => {
    set({ activeTagId, nav: "tags" });
  },
  setToast: (toast) =>
    set({
      toast,
      ...(toast === null ? { canUndo: false, _undoAction: null } : {}),
    }),
  undo: async () => {
    const action = get()._undoAction;
    if (!action) return;
    set({ canUndo: false, _undoAction: null, toast: null });
    await action();
    set({ toast: "已撤销" });
  },

  addTask: async (draft) => {
    try {
      const task = await db.createTask(draft);
      const [tasks, tagMap] = await Promise.all([
        db.fetchTasks(),
        db.fetchTaskTagMap(),
      ]);
      set({ tasks, tagMap, toast: "已创建任务" });
      notifyDataChanged();
      return task;
    } catch (e) {
      set({ error: errorMessage(e, "创建失败") });
      return null;
    }
  },

  saveTask: async (id, updates) => {
    try {
      const updated = await db.updateTask(id, updates);
      if (updated) {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? updated : task,
          ),
        }));
        if (updates.status === "completed") await get().refreshAll();
        else notifyDataChanged();
      }
    } catch (e) {
      const msg = errorMessage(e, "保存失败");
      set({ error: msg, toast: msg });
      throw e;
    }
  },

  saveTasksBatch: async (items) => {
    if (!items.length) return;
    try {
      const updatedTasks = await db.applyTaskUpdatesBatch(items);
      if (updatedTasks.length) {
        const byId = new Map(updatedTasks.map((task) => [task.id, task]));
        set((state) => ({
          tasks: state.tasks.map((task) => byId.get(task.id) ?? task),
        }));
      }
    } catch (e) {
      const msg = errorMessage(e, "批量保存失败");
      set({ error: msg, toast: msg });
      throw e;
    }
  },

  toggleComplete: async (id) => {
    if (pendingCompleteIds.has(id)) return;
    const before = get().tasks.find((task) => task.id === id);
    if (!before) return;
    const nextStatus = before.status === "completed" ? "pending" : "completed";
    pendingCompleteIds.add(id);
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: nextStatus,
              completed_at: nextStatus === "completed" ? nowIso() : null,
            }
          : task,
      ),
    }));
    try {
      const task = await db.toggleTaskComplete(id);
      notifyDataChanged();
      set({
        toast: task?.status === "completed" ? "任务已完成" : "已恢复为待办",
        canUndo: true,
        _undoAction: async () => {
          await db.toggleTaskComplete(id);
          await get().refreshAll();
        },
      });

    } catch (e) {
      const msg = errorMessage(e, "完成任务失败");
      set((state) => ({
        tasks: state.tasks.map((task) => (task.id === id ? before : task)),
        error: msg,
        toast: msg,
      }));
    } finally {
      pendingCompleteIds.delete(id);
    }
  },

  setTaskCompletedAt: async (id, completedAt) => {
    try {
      const updated = await db.updateTask(id, { completed_at: completedAt });
      if (updated) {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id ? updated : task,
          ),
        }));
        await get().refreshAll();
        set({ toast: "完成时间已更新" });
      }
    } catch (e) {
      const msg = errorMessage(e, "修改完成时间失败");
      set({ error: msg, toast: msg });
    }
  },

  deleteTask: async (id) => {
    await db.softDeleteTask(id);
    set({
      selectedTaskId: null,
      toast: "任务已移入回收站",
      canUndo: true,
      _undoAction: async () => {
        await db.restoreTask(id);
        await get().refreshAll();
      },
    });
    const [tasks, trashTasks] = await Promise.all([
      db.fetchTasks(),
      db.fetchTrashTasks(),
    ]);
    set({ tasks, trashTasks });
  },

  batchComplete: async (ids) => {
    const toComplete = get()
      .tasks.filter((task) => ids.includes(task.id) && task.status !== "completed")
      .map((task) => task.id);
    if (!toComplete.length) return;
    try {
      await db.batchSetTaskStatus(toComplete, "completed");
      await get().refreshAll();
      set({
        toast: `已完成 ${toComplete.length} 项任务`,
        canUndo: true,
        _undoAction: async () => {
          await db.batchSetTaskStatus(toComplete, "pending");
          await get().refreshAll();
        },
      });
    } catch (e) {
      const msg = errorMessage(e, "批量完成失败");
      set({ error: msg, toast: msg });
    }
  },

  batchDelete: async (ids) => {
    await db.batchSoftDeleteTasks(ids);
    await get().refreshAll();
    set({
      selectedTaskId: null,
      toast: `已删除 ${ids.length} 项任务`,
      canUndo: true,
      _undoAction: async () => {
        await db.batchRestoreTasks(ids);
        await get().refreshAll();
      },
    });
  },

  restoreTask: async (id) => {
    await db.restoreTask(id);
    await get().refreshAll();
  },

  purgeTrash: async () => {
    await db.purgeTrash();
    await get().refreshAll();
  },

  purgeTask: async (id) => {
    await db.purgeTask(id);
    await get().refreshAll();
  },

  reorder: async (ids) => {
    await db.reorderTasks(ids);
    await get().refreshAll();
  },

  addTag: async (name, color) => {
    await db.createTag(name, color);
    await get().refreshAll();
  },

  updateTag: async (id, updates) => {
    await db.updateTag(id, updates);
    await get().refreshAll();
  },

  removeTag: async (id) => {
    await db.deleteTag(id);
    await get().refreshAll();
  },

  setTaskTags: async (taskId, tagIds) => {
    await db.setTaskTags(taskId, tagIds);
    await get().refreshAll();
  },

  addProject: async (name, tagId) => {
    // 项目颜色不自选：创建时直接继承所选标签的颜色。
    const tagColor = tagId
      ? get().tags.find((tag) => tag.id === tagId)?.color
      : undefined;
    await db.createProject(name, tagColor, tagId ?? null);
    await get().refreshAll();
    set({ toast: "项目已创建" });
  },

  archiveProject: async (id) => {
    await db.archiveProject(id);
    await get().refreshAll();
    set({ toast: "项目已归档" });
  },

  restoreProject: async (id) => {
    await db.restoreProject(id);
    await get().refreshAll();
    set({ toast: "项目已恢复" });
  },


  addHabit: async (draft) => {
    await db.createHabit(draft);
    await get().refreshAll();
    set({ toast: "习惯已创建" });
  },

  updateHabit: async (id, draft) => {
    await db.updateHabit(id, draft);
    await get().refreshAll();
    set({ toast: "习惯已更新" });
  },

  archiveHabit: async (id) => {
    await db.archiveHabit(id);
    await get().refreshAll();
    set({ toast: "习惯已归档" });
  },

  restoreHabit: async (id) => {
    await db.restoreHabit(id);
    await get().refreshAll();
    set({ toast: "习惯已恢复" });
  },

  removeHabit: async (id) => {
    await db.softDeleteHabit(id);
    await get().refreshAll();
    set({ toast: "习惯已移入回收站" });
  },

  toggleHabitDay: async (habitId, date) => {
    await db.toggleHabitCheck(habitId, date);
    await get().refreshAll();
  },

  setHabitMeasurement: async (habitId, contribution) => {
    const habit = get().habits.find((item) => item.id === habitId);
    if (!habit) return;
    await db.updateHabitGoal(habitId, habit.goal_id, contribution);
    await get().refreshAll();
  },

  addTimer: async (draft) => {
    try {
      // 专注单实例：新建即启动的专注，先暂停其余运行中的专注任务，
      // 保证同一时间只有一个计时在跑。
      const pausedTitles =
        draft.kind === "task" && draft.start
          ? await db.pauseOtherRunningCountdowns("")
          : [];
      const timer = await db.createTimer(draft);
      await get().refreshTimers();
      set({
        toast: draft.start
          ? startToast(timer.title, pausedTitles)
          : "已创建专注",
      });
      return timer;
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : "开始专注失败" });
      return null;
    }
  },

  startTimer: async (id) => {
    const { timer, pausedTitles } = await db.startTimer(id);
    await get().refreshTimers();
    set({ toast: timer ? startToast(timer.title, pausedTitles) : "专注已开始" });
  },

  pauseTimer: async (id) => {
    await db.pauseTimer(id);
    await get().refreshTimers();
  },

  resetTimer: async (id) => {
    await db.resetTimer(id);
    await get().refreshTimers();
  },

  extendTimer: async (id, additionalSec) => {
    await db.extendTimer(id, additionalSec);
    await get().refreshTimers();
    set({ toast: `已增加 ${Math.round(additionalSec / 60)} 分钟` });
  },

  editFocus: async (id, patch) => {
    try {
      await db.editFocus(id, patch);
      await get().refreshTimers();
      set({ toast: "已更新专注" });
    } catch (e) {
      set({ toast: errorMessage(e, "更新专注失败") });
    }
  },

  removeTimer: async (id) => {
    await db.deleteTimer(id);
    await get().refreshTimers();
  },

  refreshTimers: async () => {
    // 今日专注计数与专注列表同源刷新（完成流水写于 completeFocus，先写后刷）。
    // 计数读失败不拖垮列表（如旧库尚无流水表），落 0 即可。
    const [timers, focusTodayCount] = await Promise.all([
      db.fetchTimers(),
      db.countFocusToday().catch(() => 0),
    ]);
    set({ timers, focusTodayCount });
  },

  settleTimers: async () => {
    const fired = await db.settleExpiredTimers();
    if (fired.length) {
      await get().refreshTimers();
    }
    return fired;
  },

  completeFocus: async (timer) => {
    // 到点时刻：已结算读 last_fired_at；进行中提前完成取现在，区间只算实际已专注的时长。
    let endMs: number;
    let spanSec: number;
    if (timer.running) {
      endMs = Date.now();
      spanSec = Math.max(60, timer.interval_sec - liveRemaining(timer));
    } else {
      const parsedEnd = timer.last_fired_at ? Date.parse(timer.last_fired_at) : NaN;
      endMs = Number.isFinite(parsedEnd) ? parsedEnd : Date.now();
      spanSec = Math.max(60, timer.interval_sec);
    }
    const startMs = endMs - spanSec * 1000;
    const pad = (n: number) => String(n).padStart(2, "0");
    const end = new Date(endMs);
    const start = new Date(startMs);
    const dueDate = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
    const window = {
      due_time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      end_time: `${pad(end.getHours())}:${pad(end.getMinutes())}`,
    };
    try {
      // 完成流水：三档都记，ended_at 用上面的到点时刻；写失败不拦落账主链。
      const logFocus = async (mode: FocusTaskMode, taskId: string | null) => {
        try {
          await db.logFocusSession({
            title: timer.title,
            mode,
            taskId,
            endedAt: new Date(endMs).toISOString(),
            durationSec: spanSec,
          });
        } catch {
          /* 流水是旁路账，坏了只少一个计数 */
        }
      };
      // 只专注不关联任务：记完即散，不落任务。
      if (timer.task_mode === "none") {
        await logFocus("none", null);
        await db.deleteTimer(timer.id);
        await get().refreshTimers();
        set({ toast: `已完成一段专注「${timer.title}」` });
        return null;
      }
      // 关联已有任务：完成即勾掉它（只改完成状态，不动任务原有的标题与安排）。
      if (timer.task_mode === "existing" && timer.task_ref_id) {
        const linked = get().tasks.find((t) => t.id === timer.task_ref_id) ?? null;
        if (linked) {
          if (linked.status !== "completed") {
            await db.updateTask(linked.id, { status: "completed" });
          }
          await logFocus("existing", linked.id);
          await db.deleteTimer(timer.id);
          await get().refreshAll();
          await get().refreshTimers();
          set({ toast: `已完成一段专注，「${linked.title}」已打勾` });
          return linked;
        }
        // 关联的任务已被删：降级为按专注新建一条，别把这段劳动记丢。
      }
      // 新建任务 / 关联失效降级：按预填信息建一条今天到期的已完成任务。
      const draft = parseFocusTaskDraft(timer.task_draft);
      const task = await db.createTask({
        title: timer.title,
        description: draft.description,
        priority: draft.priority,
        project_id: draft.projectId ?? null,
        goal_id: draft.goalId ?? null,
        goal_contribution: draft.goalContribution ?? 0,
        due_date: dueDate,
        due_time: window.due_time,
        end_time: window.end_time,
      });
      if (draft.tagId) await db.setTaskTags(task.id, [draft.tagId]);
      await db.toggleTaskComplete(task.id);
      await logFocus("new", task.id);
      await db.deleteTimer(timer.id);
      await get().refreshAll();
      await get().refreshTimers();
      set({ toast: `已把「${timer.title}」记为已完成任务` });
      return task;
    } catch (e) {
      set({ toast: errorMessage(e, "记为已完成任务失败") });
      return null;
    }
  },

  setTheme: async (theme) => {
    await db.setThemeSetting(theme);
    applyTheme(theme);
    set((s) => ({ settings: { ...s.settings, theme } }));
  },

  updateSettings: async (patch) => {
    // Apply optimistically so UI (e.g. onboarding dismiss) never waits on SQLite.
    const previous = get().settings;
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    try {
      if (patch.autostart !== undefined) {
        await db.setSetting("autostart", String(patch.autostart));
      }
      if (patch.privacyMode !== undefined) {
        await db.setSetting("privacy_mode", String(patch.privacyMode));
      }
      if (patch.autoBackup !== undefined) {
        await db.setSetting("auto_backup", String(patch.autoBackup));
      }
      if (patch.onboardingComplete !== undefined) {
        await db.setSetting(
          "onboarding_complete",
          String(patch.onboardingComplete),
        );
      }
    } catch (e) {
      set((state) => {
        const settings = { ...state.settings };
        for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
          if (Object.is(settings[key], patch[key])) {
            (settings as Record<keyof AppSettings, AppSettings[keyof AppSettings]>)[key] = previous[key];
          }
        }
        return {
          settings,
          toast: `设置保存失败，已恢复原设置：${errorMessage(e, "未知错误")}`,
        };
      });
    }
  },
}));

// 同步拉到对端新数据后即时重载全局数据：任务/标签/习惯/项目等
// 否则界面停在旧数据，要重启应用才看得到同步结果。手动「立即同步」、
// 启动与回前台的自动同步都经由 service 派发这一事件。
if (typeof window !== "undefined") {
  window.addEventListener("youqiu:sync-applied", () => {
    void useAppStore.getState().refreshAll();
  });
}

// 跟随系统主题：系统在明暗间切换时实时重算 data-theme。
if (typeof window !== "undefined" && window.matchMedia) {
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onSchemeChange = () => {
    if (useAppStore.getState().settings.theme === "system") applyTheme("system");
  };
  if (typeof darkQuery.addEventListener === "function") {
    darkQuery.addEventListener("change", onSchemeChange);
  } else if (typeof darkQuery.addListener === "function") {
    // 旧 WebView 兼容
    darkQuery.addListener(onSchemeChange);
  }
}
