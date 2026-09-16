import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app";
import { exportBackup, importBackup, summarizeBackupRestore } from "@/lib/db";
import type { BackupPayload } from "@/types";
import { save, open } from "@tauri-apps/plugin-dialog";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { isMobileShell } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { themeMeta, type VisualTheme } from "@/lib/themes";
import { OS_REMINDER_LIMIT } from "@/lib/nativeReminders";
import { AppIcon } from "./AppIcon";
import { confirmAction } from "@/components/AppConfirm";
import { syncService, useSyncStore } from "@/lib/sync/service";
import { KEY_SYNC_DEVICE_NAME, KEY_SYNC_FEISHU_APP_ID, KEY_SYNC_FEISHU_APP_SECRET } from "@/lib/sync/config";

type DatabaseHealth = {
  healthy: boolean;
  databaseExists: boolean;
  databaseSize: number;
  dataDirectory: string;
  writable: boolean;
};

type DatabaseBackupInfo = {
  id: string;
  size: number;
  createdAt: number;
};

export function SettingsView() {
  const settings = useAppStore((s) => s.settings);
  const setTheme = useAppStore((s) => s.setTheme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const setToast = useAppStore((s) => s.setToast);
  const [databaseHealth, setDatabaseHealth] = useState<DatabaseHealth | null>(null);
  const [databaseBackups, setDatabaseBackups] = useState<DatabaseBackupInfo[]>([]);
  const [checkingData, setCheckingData] = useState(false);
  const [appVersion, setAppVersion] = useState("…");

  const refreshDataHealth = async () => {
    setCheckingData(true);
    try {
      const [health, backups] = await Promise.all([
        invoke<DatabaseHealth>("database_health"),
        invoke<DatabaseBackupInfo[]>("list_database_backups"),
      ]);
      setDatabaseHealth(health);
      setDatabaseBackups(backups);
    } catch (error) {
      setToast(`数据检查失败：${String(error)}`);
    } finally {
      setCheckingData(false);
    }
  };

  useEffect(() => {
    void refreshDataHealth();
    void getVersion().then(setAppVersion).catch(() => setAppVersion("未知"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const restoreDatabaseBackup = async (backup: DatabaseBackupInfo) => {
    const created = new Date(backup.createdAt * 1000).toLocaleString();
    const ok = await confirmAction({
      title: `确认恢复 ${created} 的启动备份？`,
      description: "当前数据库会先自动备份，应用随后重启。",
      confirmText: "恢复并重启",
      danger: true,
    });
    if (!ok) return;
    await invoke("schedule_database_restore", { backupId: backup.id });
    await invoke("restart_app");
  };

  // Android 没有「另存为」对话框：导出直接落盘应用数据目录 backups/，
  // 与桌面 save() 对话框互斥。
  const writeBackupToAppDir = async (name: string, contents: string) => {
    const { appDataDir, join } = await import("@tauri-apps/api/path");
    const { mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");
    const dir = await join(await appDataDir(), "backups");
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    const path = await join(dir, name);
    await writeTextFile(path, contents);
    return path;
  };

  const exportJson = async () => {
    try {
      const payload = await exportBackup();
      if (isMobileShell()) {
        const name = `youqiu-backup-${Date.now()}.json`;
        await writeBackupToAppDir(name, JSON.stringify(payload, null, 2));
        setToast(`已导出到应用数据目录 backups/${name}`);
        return;
      }
      const path = await save({
        defaultPath: `youqiu-backup-${Date.now()}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await invoke("write_backup_file", { path, contents: JSON.stringify(payload, null, 2) });
      setToast("已导出 JSON 备份");
    } catch (error) {
      setToast(`导出 JSON 失败：${String(error)}`);
    }
  };

  const exportCsv = async () => {
    try {
      const payload = await exportBackup();
      const header =
        "id,title,status,priority,due_date,due_time,end_time,parent_id,created_at,completed_at\n";
      const rows = payload.tasks
        .map((t) =>
          [
            t.id,
            JSON.stringify(t.title),
            t.status,
            t.priority,
            t.due_date ?? "",
            t.due_time ?? "",
            t.end_time ?? "",
            t.parent_id ?? "",
            t.created_at,
            t.completed_at ?? "",
          ].join(","),
        )
        .join("\n");
      if (isMobileShell()) {
        const name = `youqiu-tasks-${Date.now()}.csv`;
        await writeBackupToAppDir(name, header + rows);
        setToast(`已导出到应用数据目录 backups/${name}`);
        return;
      }
      const path = await save({
        defaultPath: `youqiu-tasks-${Date.now()}.csv`,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!path) return;
      await invoke("write_backup_file", { path, contents: header + rows });
      setToast("已导出 CSV");
    } catch (error) {
      setToast(`导出 CSV 失败：${String(error)}`);
    }
  };

  const importJson = async () => {
    let path: string | string[] | null;
    try {
      path = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
    } catch (error) {
      // Android 文件选择器可能不支持扩展名过滤或被系统拦截，给出明确出路。
      setToast(`无法打开文件选择器：${String(error)}`);
      return;
    }
    if (!path || Array.isArray(path)) return;
    let payload: BackupPayload;
    try {
      const text = await invoke<string>("read_backup_file", { path });
      payload = JSON.parse(text) as BackupPayload;
    } catch (error) {
      setToast(`读取备份文件失败：${String(error)}`);
      return;
    }
    const ok = await confirmAction({
      title: "确认从该文件恢复数据？",
      description: summarizeBackupRestore(payload),
      confirmText: "恢复",
      danger: true,
    });
    if (!ok) return;
    const backupId = await invoke<string>("create_database_backup");
    // Keep a crash-safe rollback marker until every import write succeeds.
    await invoke("schedule_database_restore", { backupId });
    try {
      await importBackup(payload);
      await invoke("cancel_database_restore");
      await useAppStore.getState().refreshAll();
      setToast("已从备份恢复");
    } catch (error) {
      setToast(`恢复失败，正在从快照 ${backupId} 回滚并重启…`);
      await invoke("restart_app");
      throw error;
    }
  };

  const toggleAutostart = async () => {
    const next = !settings.autostart;
    try {
      if (next) await enable();
      else await disable();
      const enabled = await isEnabled();
      await updateSettings({ autostart: enabled });
    } catch (error) {
      const actual = await isEnabled().catch(() => settings.autostart);
      await updateSettings({ autostart: actual });
      setToast(`开机自启设置失败，已保持${actual ? "开启" : "关闭"}：${String(error)}`);
    }
  };

  return (
    <main
      className="main-workspace"
      style={{ padding: 22, paddingTop: isMobileShell() ? 0 : undefined, overflow: "auto" }}
    >
      {/* 移动端 main 顶部内边距归零（sticky 页头不能上方留缝），顶距改由页头提供。 */}
      <h2 className="workspace-top" style={{ padding: 0, paddingTop: isMobileShell() ? 16 : 0 }}>
        设置
      </h2>

      <section className="settings-card brand-origin-card" style={{ marginTop: 16 }}>
        <div className="brand-origin-title">
          <AppIcon name="brand" size={20} />
          <h3>命名缘起</h3>
          <span className="brand-origin-en">Yield</span>
        </div>
        <blockquote className="brand-origin-epigraph">
          <p>若农服田力穑，乃亦有秋。</p>
          <cite>——《尚书·盘庚》</cite>
        </blockquote>
        <p className="brand-origin-intro">
          农夫尽力耕作，秋天必有收成。愿每一次认真完成的任务，都像一场确定会到来的秋收。
        </p>
        <ul className="brand-origin">
          <li>
            <div className="brand-origin-head"><strong>积微</strong><span>《荀子·强国》</span></div>
            <p className="brand-origin-quote">「积微，月不胜日。」</p>
            <p className="brand-origin-meaning">每天的小积累，胜过攒着一起做。</p>
          </li>
          <li>
            <div className="brand-origin-head"><strong>观澜</strong><span>《孟子·尽心上》</span></div>
            <p className="brand-origin-quote">「观水有术，必观其澜。」</p>
            <p className="brand-origin-meaning">收支如水，可观其波澜。</p>
          </li>
          <li>
            <div className="brand-origin-head"><strong>有恒</strong><span>《论语·述而》</span></div>
            <p className="brand-origin-quote">「得见有恒者，斯可矣。」</p>
            <p className="brand-origin-meaning">成长靠的是不间断的人。</p>
          </li>
          <li>
            <div className="brand-origin-head"><strong>百工</strong><span>《论语·子张》</span></div>
            <p className="brand-origin-quote">「百工居肆以成其事。」</p>
            <p className="brand-origin-meaning">先利其器，再善其事。</p>
          </li>
        </ul>
      </section>

      <section className="settings-card" style={{ marginTop: 12 }}>
        <div className="theme-section-heading">
          <div><h3>外观</h3><p>选择一天工作时想进入的光线。</p></div>
          <span>清晰，也要有氛围</span>
        </div>
        <div className="theme-gallery">
          {(Object.entries(themeMeta) as [VisualTheme, (typeof themeMeta)[VisualTheme]][]).map(([t, meta]) => (
            <button
              key={t}
              type="button"
              className={`theme-preview theme-preview-${t} ${settings.theme === t ? "active" : ""}`}
              onClick={() => void setTheme(t)}
              aria-pressed={settings.theme === t}
            >
              <span className="theme-preview-canvas" style={{ "--preview-bg": meta.preview[0], "--preview-card": meta.preview[1], "--preview-accent": meta.preview[2] } as React.CSSProperties}>
                <i /><i /><i /><b />
              </span>
              <span className="theme-preview-copy"><strong>{meta.name}</strong><small>{meta.mood}</small><em>{meta.description}</em></span>
              <span className="theme-preview-check" aria-hidden>{settings.theme === t ? "✓" : ""}</span>
            </button>
          ))}
        </div>
        <label className="theme-system-toggle">
          <input type="checkbox" checked={settings.theme === "system"} onChange={(event) => void setTheme(event.target.checked ? "system" : "light")} />
          <span><strong>跟随系统</strong><small>随系统在清昼与静夜之间自动切换</small></span>
        </label>
      </section>

      <section className="settings-card" style={{ marginTop: 12 }}>
        <h3>提醒与启动</h3>
        <label className="field-label">默认提前提醒（分钟）</label>
        <input
          className="field"
          type="number"
          style={{ maxWidth: 160 }}
          value={settings.notifyAhead}
          onChange={(e) =>
            void updateSettings({ notifyAhead: Number(e.target.value) || 30 })
          }
        />
        <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "6px 0 0" }}>
          单个任务可在任务详情里单独设置提前量；不单独设置时使用这里的默认值。
        </p>
        {!isMobileShell() ? (
          <>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={settings.autostart}
                onChange={() => void toggleAutostart()}
              />
              <span>
                <strong>开机自动启动</strong>
                <small>登录 Windows 后自动启动有秋</small>
              </span>
            </label>
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              关闭主窗口会收到托盘，不会退出；彻底退出请用托盘「退出应用」。
            </p>
          </>
        ) : (
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Android 端提醒由系统计划通知送达；把有秋加入电池优化白名单可避免提醒被延迟。
          </p>
        )}
        <ReminderSyncStatusCard />
      </section>

      <section className="settings-card settings-version-card" style={{ marginTop: 12 }}>
        <div><span>应用版本</span><h3>有秋 v{appVersion}</h3><p>启动后会静默检查一次；只有发现新版本时才会提醒。</p></div>
        <button type="button" className="btn-ghost" onClick={() => window.dispatchEvent(new Event("version:check"))}>检查更新</button>
      </section>

      <section className="settings-card" style={{ marginTop: 12 }}>
        <h3>隐私</h3>
        <p>本地优先，任务数据仅保存在本机。默认不上传任何日志与任务内容。</p>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.privacyMode}
            onChange={() =>
              void updateSettings({ privacyMode: !settings.privacyMode })
            }
          />
          <span>
            <strong>无痕模式</strong>
            <small>通知只显示「有秋 / 你有一条提醒」，不展示任务标题与内容</small>
          </span>
        </label>
      </section>

      <section className="settings-card" style={{ marginTop: 12 }}>
        <h3>数据备份</h3>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings.autoBackup}
            onChange={() =>
              void updateSettings({ autoBackup: !settings.autoBackup })
            }
          />
          <span>
            <strong>自动备份</strong>
            <small>每 6 小时保存一份备份，自动保留最近 10 个版本</small>
          </span>
        </label>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          最近一次备份：
          {settings.autoBackupLastError
            ? `失败${
                settings.autoBackupLastFailAt
                  ? ` · ${new Date(settings.autoBackupLastFailAt).toLocaleString()}`
                  : ""
              } · ${settings.autoBackupLastError}${
                settings.autoBackupFailStreak > 1
                  ? `（连续 ${settings.autoBackupFailStreak} 次）`
                  : ""
              }`
            : settings.autoBackupLastOk
              ? `成功 · ${new Date(settings.autoBackupLastOk).toLocaleString()}`
              : "尚未运行"}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn-primary" onClick={() => void exportJson()}>
            导出 JSON
          </button>
          <button type="button" className="btn-ghost" onClick={() => void exportCsv()}>
            导出 CSV
          </button>
          <button type="button" className="btn-ghost" onClick={() => void importJson()}>
            导入恢复
          </button>
          {!isMobileShell() ? (
            <button type="button" className="btn-ghost" onClick={() => void invoke("open_data_directory")}>
              打开数据目录
            </button>
          ) : null}
        </div>

        <div className="data-health-panel">
          <div className="data-health-head">
            <div>
              <strong>数据健康</strong>
              <span>
                {databaseHealth
                  ? databaseHealth.healthy && databaseHealth.writable
                    ? "数据库正常，可读写"
                    : "数据库需要检查"
                  : "尚未检查"}
              </span>
            </div>
            <button
              type="button"
              className="btn-ghost"
              disabled={checkingData}
              onClick={() => void refreshDataHealth()}
            >
              {checkingData ? "检查中…" : "重新检查"}
            </button>
          </div>
          {databaseHealth ? (
            <dl className="data-health-details">
              <div>
                <dt>数据库大小</dt>
                <dd>{Math.max(1, Math.round(databaseHealth.databaseSize / 1024))} KB</dd>
              </div>
              <div>
                <dt>启动备份</dt>
                <dd>{databaseBackups.length} 份</dd>
              </div>
            </dl>
          ) : null}
          {databaseBackups.length ? (
            <div className="database-backup-list">
              {databaseBackups.slice(0, 5).map((backup) => (
                <div key={backup.id}>
                  <span>
                    {new Date(backup.createdAt * 1000).toLocaleString()}
                    <small>{Math.max(1, Math.round(backup.size / 1024))} KB</small>
                  </span>
                  {!isMobileShell() ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void restoreDatabaseBackup(backup)}
                    >
                      恢复此版本
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="settings-hint">下次启动时会生成第一份数据库快照。</p>
          )}
        </div>
      </section>

      <SyncSettingsCard />
    </main>
  );
}

function SyncSettingsCard() {
  const setToast = useAppStore((s) => s.setToast);
  const phase = useSyncStore((s) => s.phase);
  const running = useSyncStore((s) => s.running);
  const storeDevice = useSyncStore((s) => s.deviceName);
  const lastSummary = useSyncStore((s) => s.lastSummary);
  const lastError = useSyncStore((s) => s.lastError);
  const [appId, setAppId] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [secretSet, setSecretSet] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState<"idle" | "credentials" | "sync" | "backfill">("idle");
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    void (async () => {
      await syncService.configure();
      const { getSetting } = await import("@/lib/db");
      const [savedProvider, savedDevice, savedAppId, savedSecret] = await Promise.all([
        getSetting("sync_provider"),
        getSetting(KEY_SYNC_DEVICE_NAME),
        getSetting(KEY_SYNC_FEISHU_APP_ID),
        getSetting(KEY_SYNC_FEISHU_APP_SECRET),
      ]);
      setConfigured(savedProvider === "feishu" && Boolean(savedAppId) && Boolean(savedSecret));
      setDeviceName(savedDevice ?? "");
      setAppId(savedAppId ?? "");
      setSecretSet(Boolean(savedSecret));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveDeviceName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === storeDevice) return;
    try {
      const { setSetting } = await import("@/lib/db");
      await setSetting(KEY_SYNC_DEVICE_NAME, trimmed);
      await syncService.configure();
      setToast(`设备名已设为「${trimmed}」`);
    } catch (error) {
      setToast(`设备名保存失败：${String(error)}`);
    }
  };

  const saveCredentials = async () => {
    setBusy("credentials");
    try {
      const { setSetting } = await import("@/lib/db");
      if (appId.trim()) await setSetting(KEY_SYNC_FEISHU_APP_ID, appId.trim());
      if (secretInput.trim()) {
        await setSetting(KEY_SYNC_FEISHU_APP_SECRET, secretInput.trim());
        setSecretInput("");
      }
      await setSetting("sync_provider", "feishu");
      await syncService.configure();
      setConfigured(true);
      setToast("同步凭据已保存");
    } catch (error) {
      setToast(`保存凭据失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  const runSyncNow = async () => {
    setBusy("sync");
    try {
      const summary = await syncService.syncNow();
      if (!summary.ok) setToast(`同步未完成：${summary.errors[0] ?? "未知错误"}`);
      else setToast(`同步完成：推送 ${summary.pushed} 条，接收 ${summary.pulled} 条`);
    } catch (error) {
      setToast(`同步失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  const runBackfill = async () => {
    setBusy("backfill");
    try {
      const count = await syncService.backfillBaseline();
      setToast(`基线回填 ${count} 条，开始推送…`);
      const summary = await syncService.syncNow();
      if (!summary.ok) setToast(`基线推送失败：${summary.errors[0] ?? "未知错误"}`);
      else setToast(`基线已推送 ${summary.pushed} 条`);
    } catch (error) {
      setToast(`基线生成失败：${String(error)}`);
    } finally {
      setBusy("idle");
    }
  };

  return (
    <section className="settings-card" style={{ marginTop: 12 }}>
      <h3>数据同步</h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
        在两台设备上填写同一份飞书应用凭据（企业自建应用），有秋通过飞书云盘交换增量日志并按时间戳合并。
        触发时机：启动、回到前台、手动。凭据只保存在本机，不进备份文件。
      </p>
      <label className="field-label">设备名（每台设备唯一，用作日志文件名）</label>
      <input
        className="field"
        style={{ maxWidth: 220 }}
        value={deviceName}
        placeholder={storeDevice}
        onChange={(e) => setDeviceName(e.target.value)}
        onBlur={() => void saveDeviceName(deviceName)}
        autoComplete="off"
        spellCheck={false}
      />
      <label className="field-label" style={{ marginTop: 10 }}>飞书 App ID</label>
      <input
        className="field"
        value={appId}
        placeholder="cli_…"
        onChange={(e) => setAppId(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <label className="field-label" style={{ marginTop: 10 }}>
        飞书 App Secret{secretSet ? "（已保存，留空则沿用）" : ""}
      </label>
      <input
        className="field"
        type="password"
        value={secretInput}
        placeholder={secretSet ? "••••••••" : ""}
        onChange={(e) => setSecretInput(e.target.value)}
        autoComplete="new-password"
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={busy !== "idle" || !appId.trim() || (!secretInput.trim() && !secretSet)}
          onClick={() => void saveCredentials()}
        >
          {busy === "credentials" ? "保存中…" : "保存凭据"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy !== "idle" || !configured}
          onClick={() => void runSyncNow()}
        >
          {busy === "sync" ? "同步中…" : "立即同步"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy !== "idle" || !configured}
          onClick={() => void runBackfill()}
        >
          {busy === "backfill" ? "回填中…" : "生成初始基线"}
        </button>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "8px 0 0" }}>
        状态：
        {running ? "同步中…" : phase === "ok" ? "正常" : phase === "error" ? "异常" : "未运行"}
        {lastSummary
          ? ` · 最近 ${new Date(lastSummary.finishedAt).toLocaleString()} · 推送 ${lastSummary.pushed} / 接收 ${lastSummary.pulled}`
          : ""}
        {lastError ? ` · ${lastError}` : ""}
      </p>
    </section>
  );
}

function ReminderSyncStatusCard() {
  const sync = useAppStore((s) => s.reminderSync);
  const setToast = useAppStore((s) => s.setToast);
  const osLabel =
    sync.osAvailable == null
      ? "检测中…"
      : sync.osAvailable
        ? "可用"
        : "不可用，已改用应用内调度";
  const permLabel =
    sync.permissionGranted == null
      ? "检测中…"
      : sync.permissionGranted
        ? "已授权"
        : "未授权";
  const failed = Boolean(sync.lastError) && !sync.osAvailable;
  return (
    <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "baseline" }}>
        <strong style={{ color: "var(--text-heading)" }}>系统提醒</strong>
        <span>状态：{osLabel}</span>
        <span>通知权限：{permLabel}</span>
        <span>
          系统托管 {sync.scheduledCount} 条
          {sync.totalUpcoming ? ` / 即将到期 ${sync.totalUpcoming} 条` : ""}
          {sync.overflowCount ? ` · 另有 ${sync.overflowCount} 条待应用补发` : ""}
        </span>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "6px 0 0" }}>
        {isMobileShell()
          ? "Android 端由系统计划通知（闹钟）准时送达；未授予精确闹钟时可能延迟数分钟，被系统强停后需重新打开应用补发。"
          : `完全退出后，最近 ${OS_REMINDER_LIMIT} 条、90 天内的提醒仍会由系统准时弹出，其余等应用再次运行时补发${sync.truncated ? "；当前已超出上限，队列每 6 小时自动补入" : ""}。`}
      </p>
      <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "4px 0 0" }}>
        最近一次同步：
        {failed
          ? `失败 · ${sync.lastError}`
          : sync.lastOkAt
            ? `成功 · ${new Date(sync.lastOkAt).toLocaleString()}`
            : "尚未运行"}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            window.dispatchEvent(new Event("reminders:resync"));
            setToast("正在重新同步系统提醒…");
          }}
        >
          立即重新同步
        </button>
        {sync.permissionGranted === false && !isMobileShell() ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void invoke("open_notification_settings")}
          >
            打开系统通知设置
          </button>
        ) : null}
      </div>
    </div>
  );
}
