import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { DesktopNotificationCards } from "@/components/DesktopNotificationCards";
import { NavSidebar } from "@/components/NavSidebar";
import { MainWorkspace } from "@/components/MainWorkspace";
import { DetailDrawer } from "@/components/DetailDrawer";
import { CommandPalette } from "@/components/CommandPalette";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { FocusRecoveryDialog } from "@/components/FocusRecoveryDialog";
import { AppConfirmHost } from "@/components/AppConfirm";
import { CreateTaskDialog } from "@/components/CreateTaskDialog";
import { GlassTitlebar } from "@/components/GlassTitlebar";
import { VersionUpdateNotice } from "@/components/VersionUpdateNotice";
import { MobileNav } from "@/components/mobile/MobileNav";
import { MobileMoreSheet } from "@/components/mobile/MobileMoreSheet";
import { isMobileShell } from "@/lib/platform";
import { nextRunningTimerDueAt } from "@/lib/timers";
import {
  createNotificationRecord,
  ensureReminderRecord,
  ensureMissedNotification,
  fetchDueNotifications,
  getSetting,
  setSetting,
  setNotificationStatus,
} from "@/lib/db";
import { privacySafeNotification } from "@/lib/privacy";
import { useAppStore } from "@/store/app";
import { filterTasksByView } from "@/lib/tasks";
import { todayDateString } from "@/lib/dates";
import {
  applyPrivacyToReminderPlans,
  buildMissedReminderPlans,
  buildNativeReminderPlans,
  missedReminderNeedsPopup,
  OS_REMINDER_LIMIT,
  selectOsReminderWindow,
  type ReminderSyncStatus,
} from "@/lib/nativeReminders";

const NAV_COLLAPSE_KEY = "minimal.navCollapsed";
const NAV_WIDTH_KEY = "minimal.navWidth";
const NAV_WIDTH_DEFAULT = 272;
const NAV_WIDTH_MIN = 200;
const NAV_WIDTH_MAX = 440;
const REMINDER_RESYNC_MS = 6 * 60 * 60 * 1000;

type OsReminderSyncResult = {
  ok: boolean;
  scheduledCount: number;
  overflowCount: number;
  truncated: boolean;
  error: string | null;
  hostedIds?: string[];
};

type OsHostState = {
  osOk: boolean;
  hostedIds: Set<string>;
};

const EMPTY_OS_HOST: OsHostState = { osOk: false, hostedIds: new Set() };

export function MainApp() {
  const bootstrap = useAppStore((s) => s.bootstrap);
  const ready = useAppStore((s) => s.ready);
  const error = useAppStore((s) => s.error);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const createTaskOpen = useAppStore((s) => s.createTaskOpen);
  const selectTask = useAppStore((s) => s.selectTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);
  const canUndo = useAppStore((s) => s.canUndo);
  const undo = useAppStore((s) => s.undo);
  const setNav = useAppStore((s) => s.setNav);
  const tasks = useAppStore((s) => s.tasks);
  const nav = useAppStore((s) => s.nav);
  const tagMap = useAppStore((s) => s.tagMap);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const settings = useAppStore((s) => s.settings);
  const timers = useAppStore((s) => s.timers);
  const settleTimers = useAppStore((s) => s.settleTimers);
  const refreshTimers = useAppStore((s) => s.refreshTimers);
  const focusRunning = useAppStore((s) => s.focusRunning);
  const tickFocus = useAppStore((s) => s.tickFocus);

  const overdueSignature = useMemo(
    () =>
      tasks
        .filter((task) => task.status === "pending" && task.due_date && !task.parent_id)
        .map((task) => `${task.id}:${task.due_date}:${task.due_time ?? ""}`)
        .join("|"),
    [tasks],
  );

  const [navCollapsed, setNavCollapsed] = useState(() => {
    try {
      return localStorage.getItem(NAV_COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // 移动端「更多」页开关(仅 Android 壳使用)。
  const [moreOpen, setMoreOpen] = useState(false);

  // 侧栏宽度:拖动侧栏与主区边界调整,持久化到 localStorage(不进数据库)。
  const [navWidth, setNavWidth] = useState<number>(() => {
    try {
      const value = Number(localStorage.getItem(NAV_WIDTH_KEY));
      return Number.isFinite(value) && value >= NAV_WIDTH_MIN && value <= NAV_WIDTH_MAX
        ? Math.round(value)
        : NAV_WIDTH_DEFAULT;
    } catch {
      return NAV_WIDTH_DEFAULT;
    }
  });
  useEffect(() => {
    document.documentElement.style.setProperty("--side-w", `${navWidth}px`);
    try {
      localStorage.setItem(NAV_WIDTH_KEY, String(navWidth));
    } catch {
      /* ignore */
    }
  }, [navWidth]);
  const onNavResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = navWidth;
    const onMove = (move: PointerEvent) => {
      setNavWidth(
        Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, Math.round(startWidth + move.clientX - startX))),
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("nav-resizing");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("nav-resizing");
  };

  const setReminderSync = useAppStore((s) => s.setReminderSync);
  const lastOsHostRef = useRef<OsHostState>(EMPTY_OS_HOST);
  const reminderPassRef = useRef(Promise.resolve());
  const runFullReminderPassRef = useRef<() => Promise<void>>(async () => undefined);

  const enqueueReminderPass = (fn: () => Promise<void>) => {
    const run = reminderPassRef.current.then(fn, fn);
    reminderPassRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const syncOsReminders = async (): Promise<OsHostState> => {
    const status: ReminderSyncStatus = {
      osAvailable: false,
      permissionGranted: false,
      scheduledCount: 0,
      overflowCount: 0,
      truncated: false,
      totalUpcoming: 0,
      lastOkAt: useAppStore.getState().reminderSync.lastOkAt,
      lastError: null,
    };
    try {
      let granted = await isPermissionGranted();
      if (!granted) {
        const perm = await requestPermission();
        granted = perm === "granted";
      }
      status.permissionGranted = granted;
      const snapshot = useAppStore.getState();
      const scheduled = applyPrivacyToReminderPlans(
        buildNativeReminderPlans(snapshot.tasks, snapshot.settings.notifyAhead),
        snapshot.settings.privacyMode,
      );
      status.totalUpcoming = scheduled.length;
      if (!granted) {
        await invoke("sync_native_notifications", { reminders: [] });
        status.lastError = "未授予通知权限";
        lastOsHostRef.current = EMPTY_OS_HOST;
        setReminderSync(status);
        return EMPTY_OS_HOST;
      }
      const result = await invoke<OsReminderSyncResult>("sync_native_notifications", {
        reminders: scheduled,
      });
      const hostedIds = result.ok
        ? new Set(
            Array.isArray(result.hostedIds)
              ? result.hostedIds
              : selectOsReminderWindow(scheduled).windowed.map((item) => item.reminderId),
          )
        : new Set<string>();
      const host: OsHostState = { osOk: result.ok, hostedIds };
      lastOsHostRef.current = host;
      status.osAvailable = result.ok;
      status.scheduledCount = result.scheduledCount;
      status.overflowCount = result.overflowCount;
      status.truncated = result.truncated;
      if (result.ok) {
        status.lastOkAt = Date.now();
        status.lastError = result.truncated
          ? `系统队列上限 ${OS_REMINDER_LIMIT} 条 / 90 天，其余在应用运行时补发`
          : null;
      } else {
        status.lastError = result.error || "系统提醒登记失败，已改用应用内调度";
      }
      setReminderSync(status);
      return host;
    } catch (error) {
      lastOsHostRef.current = EMPTY_OS_HOST;
      status.lastError = error instanceof Error ? error.message : "系统提醒同步失败";
      setReminderSync(status);
      return EMPTY_OS_HOST;
    }
  };

  const scanMissedReminders = async (host: OsHostState) => {
    const snapshot = useAppStore.getState();
    const now = Date.now();
    const stored = await getSetting("native_reminder_last_scan_at");
    const lastScan = stored ? Number(stored) : now;
    const missed = buildMissedReminderPlans(
      snapshot.tasks,
      snapshot.settings.notifyAhead,
      lastScan,
      now,
    );
    for (const item of missed) {
      const created = await ensureReminderRecord({
        taskId: item.taskId,
        title: item.title,
        body: item.body,
        scheduledAt: new Date(item.fireAtMs).toISOString(),
      });
      if (created && missedReminderNeedsPopup(item, host.osOk, host.hostedIds)) {
        const copy = privacySafeNotification(
          snapshot.settings.privacyMode,
          item.title,
          item.body,
        );
        sendNotification(copy);
      }
    }
    await setSetting("native_reminder_last_scan_at", String(now));
    if (missed.length) {
      window.dispatchEvent(new Event("notifications:changed"));
    }
  };

  const runFullReminderPass = () =>
    enqueueReminderPass(async () => {
      const host = await syncOsReminders();
      await scanMissedReminders(host);
    });
  const runMissedOnlyPass = () =>
    enqueueReminderPass(async () => {
      await scanMissedReminders(lastOsHostRef.current);
    });
  runFullReminderPassRef.current = runFullReminderPass;

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Single global focus ticker — uses absolute endsAt so sleep gaps are settled.
  useEffect(() => {
    if (!focusRunning) return;
    const id = window.setInterval(() => tickFocus(), 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tickFocus();
      else useAppStore.getState().persistFocusHeartbeat(true);
    };
    const onPageHide = () => {
      useAppStore.getState().persistFocusHeartbeat(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [focusRunning, tickFocus]);

  // 应用跨天保持打开时，回到窗口即把今日页游标刷新到新的一天。
  // 任务不随之移动：今日页只呈现「今天截止」的任务，逾期任务留在待办箱。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const { nav, calendarCursor, setCalendarCursor } =
        useAppStore.getState();
      const today = todayDateString();
      if (nav === "today" && calendarCursor !== today) {
        setCalendarCursor(today);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(NAV_COLLAPSE_KEY, navCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.nav =
      navCollapsed ? "collapsed" : "expanded";
  }, [navCollapsed]);

  // 侧栏宽度:写入 --side-w 供 .app-body 网格使用,并持久化(仅本地,不进数据库)。
  useEffect(() => {
    document.documentElement.style.setProperty("--side-w", `${navWidth}px`);
    try {
      localStorage.setItem(NAV_WIDTH_KEY, String(navWidth));
    } catch {
      /* ignore */
    }
  }, [navWidth]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), canUndo ? 6000 : 2200);
    return () => window.clearTimeout(t);
  }, [toast, canUndo, setToast]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("tray:today", () => setNav("today")).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setNav]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("main:hidden-to-tray", () => {
      try {
        if (sessionStorage.getItem("minimal.trayHint")) return;
        sessionStorage.setItem("minimal.trayHint", "1");
      } catch {
        /* ignore */
      }
      setToast("已放到托盘，提醒会继续。彻底退出请用托盘「退出应用」。");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [setToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if (e.key === "Escape") {
        selectTask(null);
        return;
      }
      if (typing) return;

      const visible = filterTasksByView(tasks, nav, tagMap, activeTagId);
      const idx = visible.findIndex((t) => t.id === selectedTaskId);

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = visible[Math.min(visible.length - 1, Math.max(0, idx + 1))];
        if (next) selectTask(next.id);
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev = visible[Math.max(0, idx <= 0 ? 0 : idx - 1)];
        if (prev) selectTask(prev.id);
      }
      if (e.key === "Enter" && selectedTaskId) {
        /* already open */
      }
      if (e.key === "Delete" && selectedTaskId) {
        void deleteTask(selectedTaskId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tasks,
    nav,
    tagMap,
    activeTagId,
    selectedTaskId,
    selectTask,
    deleteTask,
  ]);

  useEffect(() => {
    if (!ready) return;
    void runFullReminderPass().catch(() => undefined);
    const fullTimer = window.setInterval(() => {
      void runFullReminderPassRef.current().catch(() => undefined);
    }, REMINDER_RESYNC_MS);
    const missedTimer = window.setInterval(() => {
      void runMissedOnlyPass().catch(() => undefined);
    }, 60_000);
    return () => {
      window.clearInterval(fullTimer);
      window.clearInterval(missedTimer);
    };
  }, [ready, settings.notifyAhead, settings.privacyMode]);

  useEffect(() => {
    // 设置页「立即重新同步」:与定时全量同步走同一条队列,避免并发写系统队列。
    const onResync = () => {
      void runFullReminderPassRef.current().catch(() => undefined);
    };
    window.addEventListener("reminders:resync", onResync);
    return () => window.removeEventListener("reminders:resync", onResync);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const debounce = window.setTimeout(() => {
      void runFullReminderPassRef.current().catch(() => undefined);
    }, 1600);
    return () => window.clearTimeout(debounce);
  }, [ready, tasks]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{
      id: string;
      taskId: string;
      title: string;
      body: string;
      firedAt: number;
    }>("native-reminder-fired", (event) => {
      const item = event.payload;
      void ensureReminderRecord({
        taskId: item.taskId,
        title: item.title,
        body: item.body,
        scheduledAt: new Date(item.firedAt).toISOString(),
      }).then(() =>
        window.dispatchEvent(new Event("notifications:changed")),
      );
      void (async () => {
        await setSetting("native_reminder_last_scan_at", String(Date.now()));
        await runFullReminderPassRef.current();
      })().catch(() => undefined);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const settleSnoozed = async () => {
      try {
        const due = await fetchDueNotifications();
        for (const item of due) {
          sendNotification(
            privacySafeNotification(
              useAppStore.getState().settings.privacyMode,
              item.title,
              item.body,
            ),
          );
          await setNotificationStatus(item.id, "delivered");
        }
        if (due.length) {
          window.dispatchEvent(new Event("notifications:changed"));
        }
      } catch {
        /* ignore notification-center polling errors */
      }
    };
    const timer = window.setInterval(() => void settleSnoozed(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const dueAt = nextRunningTimerDueAt(timers);
    if (dueAt == null) return;
    const delay = Math.max(0, dueAt - Date.now());
    const tick = window.setTimeout(async () => {
      try {
        const fired = await settleTimers();
        if (!fired.length) {
          await refreshTimers();
          return;
        }

        let granted = await isPermissionGranted();
        if (!granted) {
          const perm = await requestPermission();
          granted = perm === "granted";
        }

        for (const item of fired) {
          const body = item.looped
            ? `「${item.timer.title}」到点了，已开始下一轮`
            : `「${item.timer.title}」倒计时结束`;
          if (granted) {
            sendNotification(
              privacySafeNotification(
                useAppStore.getState().settings.privacyMode,
                "定时提醒",
                body,
              ),
            );
          }
          await createNotificationRecord({
            title: "定时提醒",
            body,
            scheduledAt: new Date().toISOString(),
            status: "delivered",
            kind: "system",
          });
          setToast(body);
        }
        window.dispatchEvent(new Event("notifications:changed"));
      } catch {
        /* ignore */
      }
    }, delay);
    return () => window.clearTimeout(tick);
  }, [timers, settleTimers, refreshTimers, setToast]);

  const autoBackupRunningRef = useRef(false);
  useEffect(() => {
    if (!settings.autoBackup) return;
    const backup = async () => {
      if (autoBackupRunningRef.current) return;
      autoBackupRunningRef.current = true;
      try {
        const [
          { exportBackup, setSetting },
          { appDataDir, join },
          { mkdir, writeTextFile, readDir, remove },
        ] =
          await Promise.all([
            import("@/lib/db"),
            import("@tauri-apps/api/path"),
            import("@tauri-apps/plugin-fs"),
          ]);
        const root = await appDataDir();
        const dir = await join(root, "backups");
        await mkdir(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const path = await join(dir, `auto-backup-${stamp}.json`);
        const payload = await exportBackup();
        await writeTextFile(path, JSON.stringify(payload, null, 2));
        try {
          const backups = (await readDir(dir))
            .filter(
              (entry) =>
                entry.isFile && entry.name?.startsWith("auto-backup-"),
            )
            .sort((a, b) => (b.name ?? "").localeCompare(a.name ?? ""));
          for (const old of backups.slice(10)) {
            if (!old.name) continue;
            await remove(await join(dir, old.name));
          }
        } catch {
          // 并发运行时待清理文件可能已被上一次备份删掉;清理失败不代表备份失败。
        }
        const okAt = new Date().toISOString();
        await setSetting("auto_backup_last_ok", okAt);
        await setSetting("auto_backup_last_error", "");
        await setSetting("auto_backup_fail_streak", "0");
        useAppStore.setState((state) => ({
          settings: {
            ...state.settings,
            autoBackupLastOk: okAt,
            autoBackupLastError: null,
            autoBackupFailStreak: 0,
          },
        }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error || "未知错误");
        try {
          const { setSetting } = await import("@/lib/db");
          const prev = useAppStore.getState().settings.autoBackupFailStreak;
          const streak = prev + 1;
          const failedAt = new Date().toISOString();
          await setSetting("auto_backup_last_fail_at", failedAt);
          await setSetting("auto_backup_last_error", message);
          await setSetting("auto_backup_fail_streak", String(streak));
          useAppStore.setState((state) => ({
            settings: {
              ...state.settings,
              autoBackupLastFailAt: failedAt,
              autoBackupLastError: message,
              autoBackupFailStreak: streak,
            },
            // Prompt once when failures start stacking; avoid nagging every interval.
            toast:
              streak === 1 || streak === 3
                ? `自动备份失败：${message}`
                : state.toast,
          }));
        } catch {
          /* ignore secondary persistence errors */
        }
      } finally {
        autoBackupRunningRef.current = false;
      }
    };
    void backup();
    const timer = window.setInterval(() => void backup(), 6 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [settings.autoBackup]);

  useEffect(() => {
    if (!ready) return;
    const debounce = window.setTimeout(() => {
      const now = Date.now();
      const current = useAppStore.getState().tasks;
      const missed = current.filter((task) => {
        if (task.status !== "pending" || !task.due_date || task.parent_id) {
          return false;
        }
        const due = new Date(
          `${task.due_date}T${task.due_time ?? "23:59"}:00`,
        ).getTime();
        return due < now;
      });
      void Promise.all(missed.map(ensureMissedNotification)).then(() => {
        if (missed.length) {
          window.dispatchEvent(new Event("notifications:changed"));
        }
      });
    }, 800);
    return () => window.clearTimeout(debounce);
  }, [ready, overdueSignature]);

  if (!ready) {
    return <div className="empty-state">加载中…</div>;
  }

  const detailOpen = Boolean(selectedTaskId);
  const toggleNav = () => setNavCollapsed((v) => !v);

  const toastLayer = (
    <>
      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
          {canUndo ? (
            <button type="button" className="toast-undo" onClick={() => void undo()}>
              撤销
            </button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="toast" role="alert" aria-live="assertive" style={{ background: "var(--text-overdue)" }}>
          <span>{error}</span>
          <button
            type="button"
            className="toast-undo"
            onClick={() => {
              useAppStore.setState({ error: null });
              void bootstrap();
            }}
          >
            重试
          </button>
          <button
            type="button"
            className="toast-undo"
            onClick={() => useAppStore.setState({ error: null })}
          >
            关闭
          </button>
        </div>
      ) : null}
    </>
  );

  // 移动端壳:无侧栏/标题栏/命令面板,底部导航承载页面切换;其余浮层复用桌面组件。
  if (isMobileShell()) {
    return (
      <div className="app-root" data-privacy={settings.privacyMode ? "on" : "off"}>
        <div className={`app-body ${detailOpen ? "detail-open" : ""}`}>
          <MainWorkspace />
          {detailOpen ? <DetailDrawer /> : null}
        </div>
        <MobileNav onMore={() => setMoreOpen(true)} />
        {moreOpen ? <MobileMoreSheet onClose={() => setMoreOpen(false)} /> : null}
        {createTaskOpen ? <CreateTaskDialog /> : null}
        <FocusRecoveryDialog />
        <AppConfirmHost />
        <OnboardingGuide />
        <DesktopNotificationCards />
        {toastLayer}
        <span style={{ display: "none" }}>{todayDateString()}</span>
      </div>
    );
  }

  return (
    <div className="app-root" data-privacy={settings.privacyMode ? "on" : "off"}>
      <GlassTitlebar />
      <div
        className={`app-body ${detailOpen ? "detail-open" : ""} ${navCollapsed ? "nav-collapsed" : ""}`}
      >
        <NavSidebar
          onCollapse={() => setNavCollapsed(true)}
          onResizeStart={navCollapsed ? undefined : onNavResizePointerDown}
          onResetWidth={() => setNavWidth(NAV_WIDTH_DEFAULT)}
        />
        <MainWorkspace />
        {detailOpen ? <DetailDrawer /> : null}
        {navCollapsed ? (
          <button
            type="button"
            className="nav-edge-expand"
            title="展开侧栏"
            aria-label="展开侧栏"
            onClick={toggleNav}
          >
            ▸
          </button>
        ) : null}
      </div>
      <CommandPalette />
      {createTaskOpen ? <CreateTaskDialog /> : null}
      <FocusRecoveryDialog />
      <AppConfirmHost />
      <OnboardingGuide />
      <DesktopNotificationCards />
      <VersionUpdateNotice />
      {toastLayer}
      <span style={{ display: "none" }}>{todayDateString()}</span>
    </div>
  );
}
