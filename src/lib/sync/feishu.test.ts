/**
 * 飞书传输单测：注入 mock fetch 驱动真实 FeishuClient / FeishuTransport，
 * 断言 token 缓存、目录引导、按名解析 file_token、覆盖上传携带 file_token、
 * 下载缺文件返回 null、频控重试。
 */
import { describe, expect, it } from "vitest";
import { buildMultipart, FeishuClient, FeishuTransport } from "./feishu";

interface Call {
  url: string;
  init?: RequestInit;
}

type Handler = (call: Call) => Response;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  handler: Handler,
  creds = { appId: "cli_a", appSecret: "s3cret" },
): { client: FeishuClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = new FeishuClient(
    async () => creds,
    async (url, init) => {
      // token 端点统一由桩处理，业务 handler 只看业务请求
      if (url.includes("/auth/v3/tenant_access_token")) {
        return jsonResponse({ code: 0, tenant_access_token: "t-test", expire: 7200 });
      }
      const call = { url, init };
      calls.push(call);
      return handler(call);
    },
  );
  return { client, calls };
}

describe("FeishuClient", () => {
  it("tenant_access_token 内存缓存：多个请求只取一次 token", async () => {
    let calls = 0;
    const client = new FeishuClient(
      async () => ({ appId: "cli_a", appSecret: "s3cret" }),
      async (url) => {
        if (url.includes("tenant_access_token")) {
          calls += 1;
          return jsonResponse({ code: 0, tenant_access_token: "t-1", expire: 7200 });
        }
        return jsonResponse({ code: 0, data: { files: [] } });
      },
    );
    await client.callJson("/drive/v1/files");
    await client.callJson("/drive/v1/files");
    expect(calls).toBe(1);
    expect(await client.getAccessToken()).toBe("t-1");
  });

  it("缺凭据时抛错，不发起网络请求", async () => {
    const { client, calls } = makeClient(() => jsonResponse({ code: 0, data: {} }));
    const broken = new FeishuClient(async () => null, client["fetchFn"]);
    await expect(broken.getAccessToken()).rejects.toThrow("凭据");
    expect(calls).toHaveLength(0);
  });

  it("callJson：信封 code 非 0 抛错；1061045 自动重试一次", async () => {
    let n = 0;
    const { client, calls } = makeClient(() =>
      n++ === 0
        ? jsonResponse({ code: 1061045, msg: "频控" })
        : jsonResponse({ code: 0, data: { ok: 1 } }),
    );
    const data = await client.callJson<{ ok: number }>("/drive/v1/files?folder_token=x");
    expect(data.ok).toBe(1);
    expect(calls).toHaveLength(2);
  });
});

describe("buildMultipart", () => {
  it("字段在前、文件体居中、结尾闭合边界", () => {
    const body = buildMultipart(
      { file_name: "desktop.jsonl", size: "5" },
      { data: new TextEncoder().encode("hello") },
      "BND",
    );
    const text = new TextDecoder().decode(body);
    expect(text).toContain("--BND\r\nContent-Disposition: form-data; name=\"file_name\"\r\n\r\ndesktop.jsonl\r\n");
    expect(text).toContain('name="file"; filename="log"');
    expect(text).toContain("\r\n\r\nhello\r\n--BND--\r\n");
    expect(text).toContain('name="size"\r\n\r\n5');
  });
});

describe("FeishuTransport", () => {
  it("目录引导：settings 无 token 时按名找，找不到则创建并持久化", async () => {
    const saved: string[] = [];
    const { client, calls } = makeClient((call) => {
      if (call.url.includes("/drive/v1/files?")) {
        return jsonResponse({ code: 0, data: { files: [], has_more: false } });
      }
      if (call.url.includes("create_folder")) {
        return jsonResponse({ code: 0, data: { token: "fldNew" } });
      }
      throw new Error(`unexpected ${call.url}`);
    });
    const transport = new FeishuTransport(
      client,
      async () => null,
      async (t) => {
        saved.push(t);
      },
    );
    const files = await transport.list();
    expect(files).toEqual([]);
    expect(calls.some((c) => c.url.includes("create_folder"))).toBe(true);
    expect(saved).toEqual(["fldNew"]);
  });

  it("按名解析已有文件：覆盖上传带 file_token；新文件首传不带并缓存新 token", async () => {
    const { client, calls } = makeClient((call) => {
      if (call.url.includes("/drive/v1/files?")) {
        return jsonResponse({
          code: 0,
          data: {
            files: [
              { token: "fld-1", name: "youqiu-sync", type: "folder" },
              { token: "box-1", name: "desktop.jsonl", type: "file" },
            ],
            has_more: false,
          },
        });
      }
      if (call.url.includes("upload_all")) {
        return jsonResponse({ code: 0, data: { file_token: "box-new" } });
      }
      throw new Error(`unexpected ${call.url}`);
    });
    const transport = new FeishuTransport(
      client,
      async () => "fld-1",
      async () => {},
    );
    // 覆盖：云端已有 desktop.jsonl → 解析出 box-1 并随上传携带
    await transport.upload("desktop.jsonl", new TextEncoder().encode("v1"));
    const first = new TextDecoder().decode(calls.find((c) => c.url.includes("upload_all"))!.init!.body as Uint8Array);
    expect(first).toContain('name="file_name"\r\n\r\ndesktop.jsonl');
    expect(first).toContain('name="parent_node"\r\n\r\nfld-1');
    expect(first).toContain('name="size"\r\n\r\n2');
    expect(first).toContain('name="file_token"\r\n\r\nbox-1');
    // 首传：云端无 android.jsonl → 不带 file_token，响应 token 进缓存
    await transport.upload("android.jsonl", new TextEncoder().encode("v1"));
    const second = new TextDecoder().decode(
      calls.filter((c) => c.url.includes("upload_all"))[1]!.init!.body as Uint8Array,
    );
    expect(second).not.toContain('name="file_token"');
    // 第三次上传 desktop：文件 token 已缓存，无需再列目录
    await transport.upload("desktop.jsonl", new TextEncoder().encode("v3"));
    const uploads = calls.filter((c) => c.url.includes("upload_all"));
    expect(uploads).toHaveLength(3);
    const lists = calls.filter((c) => c.url.includes("/drive/v1/files?"));
    // 列目录两次：desktop 与 android 各解析一次 token；第三次 desktop 用缓存不再列
    expect(lists).toHaveLength(2);
  });

  it("download：文件不存在时无下载请求、返回 null", async () => {
    const { client, calls } = makeClient(() =>
      jsonResponse({ code: 0, data: { files: [], has_more: false } }),
    );
    const transport = new FeishuTransport(
      client,
      async () => "fld-1",
      async () => {},
    );
    expect(await transport.download("missing.jsonl")).toBeNull();
    expect(calls.every((c) => !c.url.includes("/download"))).toBe(true);
  });

  it("download：按 token 取二进制", async () => {
    const content = new TextEncoder().encode("log-bytes");
    const { client } = makeClient((call) => {
      if (call.url.includes("/drive/v1/files?")) {
        return jsonResponse({
          code: 0,
          data: { files: [{ token: "box-9", name: "desktop.jsonl", type: "file" }], has_more: false },
        });
      }
      if (call.url.endsWith("/download")) {
        return new Response(content as unknown as BodyInit, { status: 200 });
      }
      throw new Error(`unexpected ${call.url}`);
    });
    const transport = new FeishuTransport(
      client,
      async () => "fld-1",
      async () => {},
    );
    expect(await transport.download("desktop.jsonl")).toEqual(content);
  });

  it("list：只回 .jsonl 文件", async () => {
    const { client } = makeClient(() =>
      jsonResponse({
        code: 0,
        data: {
          files: [
            { token: "box-1", name: "desktop.jsonl", type: "file" },
            { token: "box-2", name: "readme.txt", type: "file" },
            { token: "fld-2", name: "sub", type: "folder" },
          ],
          has_more: false,
        },
      }),
    );
    const transport = new FeishuTransport(
      client,
      async () => "fld-1",
      async () => {},
    );
    expect(await transport.list()).toEqual([{ name: "desktop.jsonl", size: 0 }]);
  });
});
