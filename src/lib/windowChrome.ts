import type { ThemeMode } from "@/types";
import { isMacOS, isMobileShell } from "@/lib/platform";

type NativeTheme = "light" | "dark" | null;

function resolveNativeTheme(theme: ThemeMode): NativeTheme {
  if (theme === "system") return null;
  if (theme === "dark" || theme === "glass") return "dark";
  return "light";
}

/** 系统栏带该用深色图标还是浅色图标：glass（璃幕）与静夜都是深底。 */
function isLightSurface(theme: ThemeMode): boolean {
  const native = resolveNativeTheme(theme);
  if (native !== null) return native === "light";
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * 安卓壳：把状态栏一带贴成在应用底色（真机反馈：系统深色 + 应用清昼时
 * DayNight 窗口底色露出成一条黑带，与应用割裂）。取解析后的 --surface-base
 * 实色随明暗档传给原生；透明底（如 glass 挂 desktop 预览）回退二元底色。
 */
async function syncAndroidSystemBar(theme: ThemeMode): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const token = getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-base")
      .trim();
    const light = isLightSurface(theme);
    const color = /^#[0-9a-f]{6}$/i.test(token)
      ? token
      : light
        ? "#f6f8fc"
        : "#101722";
    await invoke("set_window_appearance", { color, lightBackground: light });
  } catch {
    // 浏览器评审预览 / 尚未内置该命令的旧安装包 — 忽略。
  }
}

/** Sync OS chrome with the in-app theme. Windows and macOS diverge on titlebar. */
export async function syncWindowChrome(theme: ThemeMode): Promise<void> {
  if (isMobileShell()) {
    await syncAndroidSystemBar(theme);
    return;
  }
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { setTheme } = await import("@tauri-apps/api/app");
    const win = getCurrentWindow();
    await setTheme(resolveNativeTheme(theme));
    await win.setBackgroundColor([0, 0, 0, 0]);
    await win.clearEffects();

    if (isMacOS()) {
      // macOS: native traffic lights + overlay titlebar; keep soft window shadow
      await win.setDecorations(true);
      await win.setTitleBarStyle("overlay");
      await win.setShadow(true);
    } else {
      // Windows: custom chrome, no acrylic/rect shadow so CSS corners stay clean
      await win.setDecorations(false);
      await win.setShadow(false);
    }
  } catch {
    // Browser / non-Tauri preview — ignore.
  }
}
