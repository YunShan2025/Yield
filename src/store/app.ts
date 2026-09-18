import { create } from "zustand";
import type {
  AppSettings,
  Attachment,
  Habit,
  HabitCheck,
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
  DateScope,
} from "@/types";
import * as db from "@/lib/db";
import { nowIso, todayDateString } from "@/lib/dates";
import {
  EMPTY_REMINDER_SYNC,
  type ReminderSyncStatus,
} from "@/lib/nativeReminders";
import { syncWindowChrome } from "@/lib/windowChrome";
import { errorMessage } from "@/lib/errors";

const pendingCompleteIds = new Set<string>();

interface AppStore {
  ready: boolean;
  error: string | null;
  tasks: Task[];
  trashTasks: Task[];
  tags: Tag[];
  tagMap: Record<string, string[]>;
  habits: Habit[];
  habitChecks: HabitCheck[];
  timers: Timer[];
  attachments: Attachment[];
  projects: Project[];
  settings: AppSettings;
  nav: NavId;
  viewMode: ViewMode;
  dateScope: DateScope;
  calendarCursor: string;
  selectedTaskId: string | null;
  detailPreferEdit: boolean;
  createTaskOpen: boolean;
  /** 新建任务是否从待办箱发起:截止日期默认不填,不自动排时间。 */
  createTaskInbox: boolean;
  activeTagId: string | null;
  reminderSync: ReminderSyncStatus;
  toast: string | null;
  canUndo: boolean;
  _undoAction: (() => Promise<void>) | null;

  bootstrap: () => Promise<void>;
  refreshAll: () => Promise<void>;
  setNav: (nav: NavId) => void;
  setViewMode: (mode: ViewMode) => void;
  setDateScope: (scope: DateScope) => void;
  setCalendarCursor: (date: string) => void;
  selectTask: (id: string | null, opts?: { edit?: boolean }) => void;
  openCreateTask: (opts?: { inbox?: boolean }) => void;
  closeCreateTask: () => void;
  setActiveTag: (id: string | null) => void;
  setToast: (msg: string | null) => void;
  undo: () => Promise<void>;

  addTask: (draft: TaskDraft) => Promise<Task | null>;
  saveTask: (id: string, updates: TaskUpdate) => Promise<void>;
  saveTasksBatch: (items: { id: string; updates: TaskUpdate }[]) => Promise<void>;
  toggleComplete: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  batchComplete: (ids: string[]) => Promise<void>;
  batchDelete: (ids: string[]) => Promise<void>;
  restoreTask: (id: string) => Promise<void>;
  purgeTrash: () => Promise<void>;
  purgeTask: (id: string) => Promise<void>;
  reorder: (ids: string[]) => Promise<void>;

  addTag: (name: string) => Promise<void>;
  updateTag: (id: string, name: string) => Promise<void>;
  removeTag: (id: string) => Promise<void>;
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>;
  addProject: (name: string) => Promise<void>;
  archiveProject: (id: string) => Promise<void>;


  addAttachment: (
    taskId: string,
    data: { kind: Attachment["kind"]; name: string; path: string },
  ) => Promise<void>;
  removeAttachment: (id: string) => Promise<void>;
  loadAttachments: (taskId: string) => Promise<void>;

  addHabit: (title: string, target?: number) => Promise<void>;
  removeHabit: (id: string) => Promise<void>;
  toggleHabitDay: (habitId: string, date: string) => Promise<void>;

  addTimer: (draft: TimerDraft) => Promise<Timer | null>;
  startTimer: (id: string) => Promise<void>;
  pauseTimer: (id: string) => Promise<void>;
  resetTimer: (id: string) => Promise<void>;
  extendTimer: (id: string, additionalSec: number) => Promise<void>;
  removeTimer: (id: string) => Promise<void>;
  refreshTimers: () => Promise<void>;
  settleTimers: () => Promise<db.FiredTimer[]>;

  setTheme: (theme: ThemeMode) => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;

  setReminderSync: (status: ReminderSyncStatus) => void;
}

function applyTheme(theme: ThemeMode) {
  document.documentElement.dataset.theme = theme;
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
  timers: [],
  attachments: [],
  projects: [],
  settings: {
    theme: "system",
    notifyAhead: 30,
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
  dateScope: "day",
  calendarCursor: todayDateString(),
  selectedTaskId: null,
  detailPreferEdit: false,
  createTaskOpen: false,
  createTaskInbox: false,
  activeTagId: null,
  reminderSync: EMPTY_REMINDER_SYNC,
  toast: null,
  canUndo: false,
  _undoAction: null,

  bootstrap: async () => {
    try {
      const today = todayDateString();
      await db.backfillGeneratedFromIds();
      await db.ensureDefaultTags();
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
      timers,
      settings,
      projects,
    ] = await Promise.all([
      db.fetchTasks(),
      db.fetchTrashTasks(),
      db.fetchTags(),
      db.fetchTaskTagMap(),
      db.fetchHabits(),
      db.fetchHabitChecks(),
      db.fetchTimers(),
      db.loadAppSettings(),
      db.fetchProjects(),
    ]);
    set((s) => ({
      tasks,
      trashTasks,
      tags,
      tagMap,
      habits,
      habitChecks,
      timers,
      // Don't regress onboarding if a concurrent refresh raced ahead of persist.
      settings: {
        ...settings,
        onboardingComplete:
          s.settings.onboardingComplete || settings.onboardingComplete,
      },
      projects,
    }));
  },

  setNav: (nav) => {
    if (nav === "myday") nav = "today";
    if (nav === get().nav) return;
    set({
      nav,
      selectedTaskId: null,
      dateScope:
        nav === "today" || nav === "inbox"
          ? "day"
          : nav === "calendar"
            ? "month"
            : get().dateScope,
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
  setDateScope: (dateScope) => set({ dateScope }),
  setCalendarCursor: (calendarCursor) => set({ calendarCursor }),
  selectTask: (selectedTaskId, opts) =>
    set({
      selectedTaskId,
      detailPreferEdit: Boolean(opts?.edit),
    }),
  openCreateTask: (opts) =>
    set({
      createTaskOpen: true,
      selectedTaskId: null,
      createTaskInbox: Boolean(opts?.inbox),
    }),
  closeCreateTask: () => set({ createTaskOpen: false, createTaskInbox: false }),
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
      const { task, spawned } = await db.toggleTaskComplete(id);
      if (task?.status === "completed" && task.id) {
        // Finish notification cleanup before refreshing reminder state. A
        // fire-and-forget cleanup could race with the reminder scan and make a
        // just-completed task pop up again.
        await db.setTaskNotificationsStatus(task.id, "dismissed").catch(() => undefined);
        window.dispatchEvent(new Event("notifications:changed"));
      }
      set({
        toast: task?.status === "completed" ? "任务已完成" : "已恢复为待办",
        canUndo: true,
        _undoAction: async () => {
          await db.toggleTaskComplete(id);
          await get().refreshAll();
        },
      });
      if (spawned) await get().refreshAll();
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
      await Promise.all(
        toComplete.map((taskId) => db.setTaskNotificationsStatus(taskId, "dismissed")),
      )
        .catch(() => undefined);
      window.dispatchEvent(new Event("notifications:changed"));
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

  addTag: async (name) => {
    await db.createTag(name);
    await get().refreshAll();
  },

  updateTag: async (id, name) => {
    await db.updateTag(id, { name });
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

  addProject: async (name) => {
    await db.createProject(name);
    await get().refreshAll();
    set({ toast: "项目已创建" });
  },

  archiveProject: async (id) => {
    await db.archiveProject(id);
    await get().refreshAll();
    set({ toast: "项目已归档" });
  },

  addAttachment: async (taskId, data) => {
    await db.addAttachment(taskId, data);
    await get().loadAttachments(taskId);
  },

  removeAttachment: async (id) => {
    const taskId = get().selectedTaskId;
    await db.removeAttachment(id);
    if (taskId) await get().loadAttachments(taskId);
  },

  loadAttachments: async (taskId) => {
    const attachments = await db.fetchAttachments(taskId);
    set({ attachments });
  },

  addHabit: async (title, target = 3) => {
    await db.createHabit(title, target);
    await get().refreshAll();
  },

  removeHabit: async (id) => {
    await db.deleteHabit(id);
    await get().refreshAll();
  },

  toggleHabitDay: async (habitId, date) => {
    await db.toggleHabitCheck(habitId, date);
    await get().refreshAll();
  },

  addTimer: async (draft) => {
    try {
      // 倒计时单实例（真机第六轮反馈）：新建即启动的倒计时，先暂停
      // 其余运行中的倒计时；循环提醒不受限。
      const pausedTitles =
        draft.kind === "task" && draft.start
          ? await db.pauseOtherRunningCountdowns("")
          : [];
      const timer = await db.createTimer(draft);
      await get().refreshTimers();
      set({
        toast: draft.start
          ? startToast(timer.title, pausedTitles)
          : "已创建提醒",
      });
      return timer;
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : "创建提醒失败" });
      return null;
    }
  },

  startTimer: async (id) => {
    const { timer, pausedTitles } = await db.startTimer(id);
    await get().refreshTimers();
    set({ toast: timer ? startToast(timer.title, pausedTitles) : "提醒已开始" });
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

  removeTimer: async (id) => {
    await db.deleteTimer(id);
    await get().refreshTimers();
  },

  refreshTimers: async () => {
    const timers = await db.fetchTimers();
    set({ timers });
  },

  settleTimers: async () => {
    const fired = await db.settleExpiredTimers();
    if (fired.length) {
      await get().refreshTimers();
    }
    return fired;
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
      if (patch.notifyAhead !== undefined) {
        await db.setSetting("notify_ahead", String(patch.notifyAhead));
      }
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
  setReminderSync: (reminderSync) => set({ reminderSync }),
}));
