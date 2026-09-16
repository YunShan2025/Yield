/**
 * 同步配置键与设备本地键。
 *
 * 所有 sync_ 前缀的 settings 键都是设备本地的：不参与同步（不在
 * SYNC_SETTINGS_KEYS 白名单），也不写入备份文件（backup 导出时按前缀剥离）——
 * 否则凭据会进备份明文，设备名会把两台设备挤成同一个日志文件。
 */

export const KEY_SYNC_PROVIDER = "sync_provider";
export const KEY_SYNC_DEVICE_NAME = "sync_device_name";
export const KEY_SYNC_FEISHU_APP_ID = "sync_feishu_app_id";
export const KEY_SYNC_FEISHU_APP_SECRET = "sync_feishu_app_secret";
export const KEY_SYNC_FEISHU_FOLDER_TOKEN = "sync_feishu_folder_token";

/** 同步引擎节流：两次自动同步的最小间隔（毫秒），防止编辑风暴期间反复整文件上传。 */
export const SYNC_DEBOUNCE_MS = 30_000;

/** 设备本地键判定：backup 导出时剔除，同步白名单天然不含。 */
export function isSyncLocalOnlyKey(key: string): boolean {
  return key.startsWith("sync_");
}
