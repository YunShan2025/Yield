import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("capability split", () => {
  it("keeps a single main-window capability after popup removal", () => {
    const conf = readFileSync("src-tauri/tauri.conf.json", "utf8");
    expect(conf).toContain('"label": "main"');
    expect(conf).not.toContain('"label": "quick-add"');
    expect(conf).not.toContain('"label": "inspiration"');
    expect(conf).not.toContain('"label": "float"');
    expect(conf).not.toContain('"label": "notification-popup"');
    expect(conf).not.toContain('"label": "widget-shortcuts"');

    const main = readFileSync("src-tauri/capabilities/main.json", "utf8");
    expect(main).toContain('"main"');
    expect(main).toContain('"fs:allow-write-text-file"');
    expect(main).toContain('"fs:allow-mkdir"');
    expect(main).toContain('"fs:allow-read-dir"');
    expect(main).toContain('"fs:allow-remove"');
    expect(main).toContain('"$APPDATA/backups/**"');
    expect(main).toContain('"$APPDATA/backups/**"');
    // 同步日志（appDataDir/sync/<device>.jsonl）需要读自身日志；读取授权
    // 只给 sync 目录，backups 的读取仍走定制命令不放开。
    expect(main).toContain('"fs:allow-read-text-file"');
    expect(main).toContain('"$APPDATA/sync/**"');
    expect(main).toContain("http:default");
    expect(main).not.toContain("allow-desktop-shortcuts");
    expect(main).not.toContain("global-shortcut");
    const mainCommands = readFileSync("src-tauri/permissions/main-app.toml", "utf8");
    expect(mainCommands).toContain('"create_database_backup"');
    expect(mainCommands).toContain('"cancel_database_restore"');
    expect(mainCommands).toContain('"write_backup_file"');
    expect(mainCommands).toContain('"read_backup_file"');
    expect(mainCommands).toContain('"open_notification_settings"');
    const generatedAcl = readFileSync("src-tauri/gen/schemas/acl-manifests.json", "utf8");
    expect(generatedAcl).toContain("create_database_backup");
    expect(generatedAcl).toContain("cancel_database_restore");
  });

  it("enables a non-null CSP in tauri.conf", () => {
    const conf = readFileSync("src-tauri/tauri.conf.json", "utf8");
    expect(conf).toContain('"csp"');
    expect(conf).not.toMatch(/"csp"\s*:\s*null/);
    expect(conf).toContain("connect-src");
  });
});
