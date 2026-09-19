/**
 * SyncService：同步引擎的应用层接线（单例）。
 *
 * - 配置存 settings 表的 sync_* 键（设备本地键：不参与同步、不进备份文件）。
 * - 时钟快照、远端水位、最近同步结果同样落 settings，跨重启恢复。
 * - 本地日志文件在 appDataDir()/sync/<device>.jsonl（plugin-fs）。
 * - run 单飞：并发触发只排队，当前轮结束后补跑一轮。
 * - 公共入口先 configure()（签名未变时只是几次 settings 读），再 run(trigger)。
 */

import { create } from "zustand";
import { getDb } from "@/lib/db/client";
import { getSetting, setSetting } from "@/lib/db/settings";
import { nowIso } from "@/lib/dates";
import { runSync, type SyncSummary, type SyncTrigger } from "./engine";
import { backfillOutbox } from "./outbox";
import { HlcClock } from "./hlc";
import type { LogReadState } from "./log";
import type { SyncTransport } from "./transport";
import {
  KEY_SYNC_DEVICE_NAME,
  KEY_SYNC_FEISHU_APP_ID,
  KEY_SYNC_FEISHU_APP_SECRET,
  KEY_SYNC_FEISHU_FOLDER_TOKEN,
  KEY_SYNC_PROVIDER,
} from "./config";

const KEY_CLOCK_P = "sync_clock_p";
const KEY_CLOCK_L = "sync_clock_l";
const KEY_REMOTE_STATES = "sync_remote_states";
const KEY_LAST_SUMMARY = "sync_last_summary";

export type SyncPhase = "idle" | "running" | "ok" | "error";

interface SyncStore {
  phase: SyncPhase;
  running: boolean;
  provider: string;
  deviceName: string;
  /** 最近一轮同步结果（来自内存或 settings 持久化）。 */
  lastSummary: SyncSummary | null;
  lastError: string | null;
}

function defaultDeviceName(): string {
  return /android/i.test(navigator.userAgent) ? "android" : "desktop";
}

export const useSyncStore = create<SyncStore>(() => ({
  phase: "idle",
  running: false,
  provider: "",
  deviceName: defaultDeviceName(),
  lastSummary: null,
  lastError: null,
}));

/** 本地日志文件（appDataDir/sync/<fileName>）的读与整文件追加。 */
class FsLogStore {
  constructor(private fileName: string) {}

  private async path(): Promise<string> {
    const [{ appDataDir, join }, { mkdir }] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const dir = await join(await appDataDir(), "sync");
    await mkdir(dir, { recursive: true }).catch(() => undefined);
    return join(dir, this.fileName);
  }

  async readLocal(): Promise<string | null> {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    try {
      return (await readTextFile(await this.path())) || null;
    } catch {
      return null;
    }
  }

  async appendLocal(lines: string[]): Promise<void> {
    const [{ readTextFile, writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await this.path();
    let prev = "";
    try {
      prev = await readTextFile(path);
    } catch {
      prev = "";
    }
    await writeTextFile(path, prev + lines.join("\n") + "\n");
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptySummaryWith(error: string): SyncSummary {
  return { ok: false, pushed: 0, pulled: 0, errors: [error], finishedAt: nowIso() };
}

export class SyncService {
  private clock: HlcClock | null = null;
  private transport: SyncTransport | null = null;
  private configSignature = "";
  private running = false;
  private queuedTrigger: SyncTrigger | null = null;
  private remoteStates = new Map<string, LogReadState>();
  private remoteStatesLoaded = false;

  /** 是否已配置传输（设置页据此渲染状态区）。 */
  get enabled(): boolean {
    return this.transport !== null;
  }

  get deviceName(): string {
    return this.clock?.deviceId ?? defaultDeviceName();
  }

  /** 按 settings 重建时钟与传输层；签名未变则直接返回。 */
  async configure(): Promise<void> {
    const provider = (await getSetting(KEY_SYNC_PROVIDER)) ?? "";
    const device = (await getSetting(KEY_SYNC_DEVICE_NAME))?.trim() || defaultDeviceName();
    const appId = (await getSetting(KEY_SYNC_FEISHU_APP_ID)) ?? "";
    const appSecret = (await getSetting(KEY_SYNC_FEISHU_APP_SECRET)) ?? "";
    const signature = [provider, device, appId, appSecret].join("\u0000");
    if (signature === this.configSignature && this.clock) return;
    this.configSignature = signature;

    this.remoteStates = new Map();
    this.remoteStatesLoaded = false;
    const p = Number((await getSetting(KEY_CLOCK_P)) ?? 0);
    this.clock = new HlcClock(device, p ? { p, l: Number((await getSetting(KEY_CLOCK_L)) ?? 0) } : null);
    this.transport =
      provider === "feishu" && appId && appSecret
        ? await this.buildFeishuTransport(appId, appSecret)
        : null;
    useSyncStore.setState({
      provider,
      deviceName: device,
      lastSummary: await this.readLastSummary(),
    });
  }

  private async buildFeishuTransport(appId: string, appSecret: string): Promise<SyncTransport> {
    const { FeishuClient, FeishuTransport } = await import("./feishu");
    const client = new FeishuClient(async () => ({ appId, appSecret }));
    return new FeishuTransport(
      client,
      async () => (await getSetting(KEY_SYNC_FEISHU_FOLDER_TOKEN)) ?? null,
      async (token) => {
        await setSetting(KEY_SYNC_FEISHU_FOLDER_TOKEN, token);
      },
    );
  }

  /** 单飞执行一轮同步。未配置凭据时也照跑：引擎只排水本地日志，不联网。 */
  async run(trigger: SyncTrigger): Promise<SyncSummary> {
    if (this.running) {
      this.queuedTrigger = trigger;
      return { ok: true, pushed: 0, pulled: 0, errors: [], finishedAt: nowIso() };
    }
    if (!this.clock) await this.configure();
    this.running = true;
    useSyncStore.setState({ phase: "running", running: true });
    try {
      const summary = await runSync({
        db: await getDb(),
        clock: this.clock!,
        ownFileName: `${this.deviceName}.jsonl`,
        store: this.logStore(),
        transport: this.transport,
        hooks: {
          persistClock: async ({ p, l }) => {
            await setSetting(KEY_CLOCK_P, String(p));
            await setSetting(KEY_CLOCK_L, String(l));
          },
          loadRemoteState: async (file) => {
            if (!this.remoteStatesLoaded) await this.loadRemoteStatesMap();
            return this.remoteStates.get(file) ?? null;
          },
          persistRemoteState: async (file, state) => {
            this.remoteStates.set(file, state);
            await this.saveRemoteStates();
          },
          persistLastSync: async () => {},
        },
        trigger,
      });
      await setSetting(KEY_LAST_SUMMARY, JSON.stringify(summary));
      useSyncStore.setState({
        phase: summary.ok ? "ok" : "error",
        lastSummary: summary,
        lastError: summary.errors[0] ?? null,
      });
      // 对端拉回了新写入：通知 UI 层重载，避免界面一直显示旧数据、
      // 要重启应用才看得到同步结果。手动与自动触发（启动/回前台）都走这里。
      if (summary.ok && summary.pulled > 0) {
        window.dispatchEvent(new Event("youqiu:sync-applied"));
      }
      return summary;
    } catch (err) {
      const message = errText(err);
      useSyncStore.setState({ phase: "error", lastError: message });
      return {
        ok: false,
        pushed: 0,
        pulled: 0,
        errors: [message],
        finishedAt: nowIso(),
      };
    } finally {
      const queued = this.queuedTrigger;
      this.queuedTrigger = null;
      this.running = false;
      useSyncStore.setState({ running: false });
      if (queued) void this.run(queued);
    }
  }

  /** 手动同步（设置页按钮）：先按最新配置重建，再跑一轮。 */
  async syncNow(): Promise<SyncSummary> {
    if (this.running) {
      this.queuedTrigger = "manual";
      return emptySummaryWith("已有同步在进行，已排队");
    }
    await this.configure();
    return this.run("manual");
  }

  /** 存量数据首接入：全表回填进 outbox，随后正常同步推送。幂等，可重复执行。 */
  async backfillBaseline(): Promise<number> {
    return backfillOutbox(await getDb());
  }

  private logStore(): FsLogStore {
    return new FsLogStore(`${this.deviceName}.jsonl`);
  }

  private async saveRemoteStates(): Promise<void> {
    const obj: Record<string, LogReadState> = {};
    for (const [file, state] of this.remoteStates.entries()) obj[file] = state;
    await setSetting(KEY_REMOTE_STATES, JSON.stringify(obj));
  }

  private async loadRemoteStatesMap(): Promise<void> {
    this.remoteStatesLoaded = true;
    const raw = await getSetting(KEY_REMOTE_STATES);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, LogReadState>;
      for (const [file, state] of Object.entries(parsed)) {
        if (state && typeof state.consumedLines === "number") {
          this.remoteStates.set(file, state);
        }
      }
    } catch {
      // 水位损坏按未消费处理：从头重读，合并幂等不会重复生效
    }
  }

  private async readLastSummary(): Promise<SyncSummary | null> {
    const raw = await getSetting(KEY_LAST_SUMMARY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SyncSummary;
    } catch {
      return null;
    }
  }
}

/** 应用级单例。设置页与 MainApp 直接引用。 */
export const syncService = new SyncService();
