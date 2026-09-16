/**
 * 飞书开放平台云盘传输（v1 传输实现）。
 *
 * 端点已于 2026-09-16 核实并实测（见 docs/local/android-sync-plan.md §5.6）：
 * - token：POST /open-apis/auth/v3/tenant_access_token/internal（2h，内存缓存提前 5 分钟刷新）
 * - 列目录：GET /drive/v1/files?folder_token=…（按名解析日志文件的 file_token）
 * - 建目录：POST /drive/v1/files/create_folder（folder_token:"" = 根目录）
 * - 上传：POST /drive/v1/files/upload_all（multipart；带可选 file_token 即原地覆盖，
 *   不带则同名会新建重复文件——所以每次上传前先解析已有 token）
 * - 下载：GET /drive/v1/files/:file_token/download（直接二进制流）
 *
 * HTTP 经 tauri-plugin-http（Rust reqwest，无 CORS 限制，桌面/Android 通用）；
 * fetch 实现可注入，单测用内存替身。
 */

import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { RemoteFileInfo, SyncTransport } from "./transport";

export const SYNC_FOLDER_NAME = "youqiu-sync";

export interface FeishuCredentials {
  appId: string;
  appSecret: string;
}

/** 飞书业务错误：HTTP 可能 200 但信封 code 非 0（如频控 1061045）。 */
export class FeishuApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(`飞书 API ${code}：${message}`);
    this.code = code;
  }
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

interface FeishuEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
}

/** 频控/可重试错误码（upload_all 文档：1061045 可稍后重试）。 */
const RETRYABLE_CODES = new Set([1061045]);

/** 自建应用租户凭证，内存缓存，提前 5 分钟过期，不落盘。 */
export class FeishuClient {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private credentials: () => Promise<FeishuCredentials | null>,
    private fetchFn: FetchFn = tauriFetch as FetchFn,
    private baseUrl = "https://open.feishu.cn",
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) return this.cached.token;
    const creds = await this.credentials();
    if (!creds?.appId || !creds?.appSecret) {
      throw new FeishuApiError(-1, "缺少飞书应用凭据（app_id / app_secret）");
    }
    const res = await this.fetchFn(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: creds.appId, app_secret: creds.appSecret }),
    });
    const body = (await res.json().catch(() => null)) as
      | { tenant_access_token?: string; expire?: number; code?: number; msg?: string }
      | null;
    const token = body?.tenant_access_token;
    if (!token) {
      throw new FeishuApiError(body?.code ?? res.status, body?.msg ?? "获取 tenant_access_token 失败");
    }
    this.cached = {
      token,
      expiresAt: Date.now() + Math.max(60, (body?.expire ?? 7200) - 300) * 1000,
    };
    return token;
  }

  /** 带认证的原始请求（download 等二进制响应直接用这个）。 */
  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return this.fetchFn(`${this.baseUrl}/open-apis${path}`, { ...init, headers });
  }

  /** 调 JSON 信封接口：HTTP 200 + code!==0 视为错误（频控 1061045 自动重试一次）。 */
  async callJson<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const res = await this.raw(path, init);
    const body = (await res.json().catch(() => null)) as FeishuEnvelope<T> | null;
    if (!body || typeof body.code !== "number") {
      throw new FeishuApiError(res.status, `HTTP ${res.status}（响应不是飞书信封）`);
    }
    if (body.code !== 0) {
      if (RETRYABLE_CODES.has(body.code) && !retried) {
        await new Promise((r) => setTimeout(r, 1500));
        return this.callJson<T>(path, init, true);
      }
      throw new FeishuApiError(body.code, body.msg ?? "未知错误");
    }
    return (body.data ?? {}) as T;
  }

  async fetchBinary(fileToken: string): Promise<Uint8Array | null> {
    const res = await this.raw(`/drive/v1/files/${fileToken}/download`, { method: "GET" });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new FeishuApiError(-1, `下载失败 HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** 手工拼 multipart/form-data（plugin-http 的 body 走 ArrayBuffer，避免 FormData 兼容问题）。 */
export function buildMultipart(
  fields: Record<string, string>,
  file: { data: Uint8Array },
  boundary: string,
): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  // filename 用占位名保持 header 纯 ASCII；真实文件名由 file_name 字段表达。
  parts.push(
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="log"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`,
    ),
  );
  parts.push(file.data);
  parts.push(enc.encode(`\r\n--${boundary}--\r\n`));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

interface FolderEntry {
  token?: string;
  name?: string;
  type?: string;
}

/**
 * 飞书云盘传输。folder_token 持久化在 settings（应用首次自动建目录）；
 * 日志文件 token 进程内缓存——上传必带 file_token 才是覆盖语义。
 */
export class FeishuTransport implements SyncTransport {
  private fileTokens = new Map<string, string>();
  private folderTokenPromise: Promise<string> | null = null;

  constructor(
    private client: FeishuClient,
    private loadFolderToken: () => Promise<string | null>,
    private saveFolderToken: (token: string) => Promise<void>,
    private folderName: string = SYNC_FOLDER_NAME,
  ) {}

  private async listFolder(folderToken: string): Promise<FolderEntry[]> {
    const out: FolderEntry[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: "200" });
      if (folderToken) query.set("folder_token", folderToken);
      if (pageToken) query.set("page_token", pageToken);
      const data = await this.client.callJson<{
        files?: FolderEntry[];
        has_more?: boolean;
        next_page_token?: string;
      }>(`/drive/v1/files?${query.toString()}`);
      out.push(...(data.files ?? []));
      pageToken = data.has_more ? data.next_page_token : undefined;
    } while (pageToken);
    return out;
  }

  private async folderToken(): Promise<string> {
    if (!this.folderTokenPromise) {
      this.folderTokenPromise = this.ensureFolder().catch((err) => {
        this.folderTokenPromise = null;
        throw err;
      });
    }
    return this.folderTokenPromise;
  }

  /** 目录定位：settings 已存 → 用；否则根目录按名找；找不到则创建。 */
  private async ensureFolder(): Promise<string> {
    const stored = await this.loadFolderToken();
    if (stored) return stored;
    const root = await this.listFolder("");
    const found = root.find((f) => f.type === "folder" && f.name === this.folderName);
    if (found?.token) {
      await this.saveFolderToken(found.token);
      return found.token;
    }
    const created = await this.client.callJson<{ token?: string }>("/drive/v1/files/create_folder", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: this.folderName, folder_token: "" }),
    });
    if (!created.token) throw new FeishuApiError(-1, "创建同步目录未返回 token");
    await this.saveFolderToken(created.token);
    return created.token;
  }

  private async resolveFileToken(name: string): Promise<string | null> {
    const cached = this.fileTokens.get(name);
    if (cached) return cached;
    const folder = await this.folderToken();
    const files = await this.listFolder(folder);
    const hit = files.find((f) => f.type === "file" && f.name === name);
    if (hit?.token) this.fileTokens.set(name, hit.token);
    return hit?.token ?? null;
  }

  async list(): Promise<RemoteFileInfo[]> {
    const folder = await this.folderToken();
    const files = await this.listFolder(folder);
    return files
      .filter((f) => f.type === "file" && (f.name ?? "").endsWith(".jsonl"))
      .map((f) => ({ name: f.name as string, size: 0 }));
  }

  async download(name: string): Promise<Uint8Array | null> {
    const token = await this.resolveFileToken(name);
    if (!token) return null;
    return this.client.fetchBinary(token);
  }

  async upload(name: string, data: Uint8Array): Promise<void> {
    const folder = await this.folderToken();
    const existing = await this.resolveFileToken(name);
    const boundary = `youqiuSync${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const fields: Record<string, string> = {
      file_name: name,
      parent_type: "explorer",
      parent_node: folder,
      size: String(data.byteLength),
    };
    if (existing) fields.file_token = existing;
    const body = buildMultipart(fields, { data }, boundary);
    // 频控等错误直接抛给上层（引擎按「上传失败，下次整文件重传」处理），不做请求级重试。
    const res = await this.client.raw("/drive/v1/files/upload_all", {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: body as unknown as BodyInit,
    });
    const bodyJson = (await res.json().catch(() => null)) as FeishuEnvelope<{ file_token?: string }> | null;
    if (!bodyJson || bodyJson.code !== 0) {
      throw new FeishuApiError(bodyJson?.code ?? res.status, bodyJson?.msg ?? `上传失败 HTTP ${res.status}`);
    }
    if (bodyJson.data?.file_token) this.fileTokens.set(name, bodyJson.data.file_token);
  }
}
