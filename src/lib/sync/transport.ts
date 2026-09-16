/**
 * 同步传输接口（可插拔）。v1 实现：飞书开放平台云盘；备选：WebDAV；测试：内存。
 * 语义约定：文件名即设备身份（`<deviceName>.jsonl`），upload 为整文件覆盖，
 * 同一设备只写自己的文件 → 云端无写冲突。
 */

export interface RemoteFileInfo {
  name: string;
  size: number;
}

export interface SyncTransport {
  /** 列出同步目录下的日志文件。 */
  list(): Promise<RemoteFileInfo[]>;
  /** 下载远端文件；不存在返回 null。 */
  download(name: string): Promise<Uint8Array | null>;
  /** 整文件覆盖上传。 */
  upload(name: string, data: Uint8Array): Promise<void>;
}

/** 测试与开发用：内存实现（也用于合并引擎单测的本地模式）。 */
export class MemoryTransport implements SyncTransport {
  private files = new Map<string, Uint8Array>();

  async list(): Promise<RemoteFileInfo[]> {
    return [...this.files.entries()].map(([name, data]) => ({
      name,
      size: data.length,
    }));
  }

  async download(name: string): Promise<Uint8Array | null> {
    return this.files.get(name) ?? null;
  }

  async upload(name: string, data: Uint8Array): Promise<void> {
    this.files.set(name, data);
  }

  /** 测试断言用：读取原始内容。 */
  peekText(name: string): string {
    return new TextDecoder().decode(this.files.get(name) ?? new Uint8Array());
  }
}
