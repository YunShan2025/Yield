/** Runtime platform helper (Tauri desktop). */
export type DesktopPlatform = "macos" | "windows" | "linux" | "unknown";

export function detectDesktopPlatform(): DesktopPlatform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
}

export function isMacOS(): boolean {
  return detectDesktopPlatform() === "macos";
}

/**
 * 是否运行在移动端壳（Android WebView）下。
 * Tauri Android 的系统 WebView UA 固定包含 android，桌面 WebView2/WKWebView 不会；
 * 用 UA 判断即可在首帧前同步决定布局，不依赖异步的 os 插件。
 */
export function isMobileShell(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("android")
  );
}
