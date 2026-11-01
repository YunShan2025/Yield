import { useEffect, useState, type ReactNode } from "react";
import { AppIcon } from "@/components/AppIcon";
import { useAppStore } from "@/store/app";
import { isMacOS } from "@/lib/platform";

/* 窗口控制图标：统一 12×12 画布、currentColor 描边（跟随各主题已有的按钮配色）。
   取代原来的 ─ □ ❐ × 文本字符——字符按字体渲染，三者大小/基线/粗细不齐。 */
function WinGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const GLYPH_MINIMIZE = <path d="M2.5 6h7" />;
const GLYPH_MAXIMIZE = <rect x="2.5" y="2.5" width="7" height="7" rx="1.3" />;
// 还原：前挡方块 + 右上露出的后挡方块折角（Windows 还原记号的画法）。
const GLYPH_RESTORE = (
  <>
    <rect x="2.2" y="3.4" width="6.2" height="6.2" rx="1.3" />
    <path d="M4.4 3.4V3a1.1 1.1 0 0 1 1.1-1.1h3.1A1.1 1.1 0 0 1 9.6 3v3.1a1.1 1.1 0 0 1-1.1 1.1H8.2" />
  </>
);
const GLYPH_CLOSE = <path d="M3 3l6 6M9 3 3 9" />;

/** In-app drag strip. macOS keeps traffic lights; Windows uses custom controls. */
export function GlassTitlebar() {
  const [maximized, setMaximized] = useState(false);
  const openCommandPalette = useAppStore((state) => state.openCommandPalette);
  const mac = isMacOS();

  useEffect(() => {
    if (mac) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();
        const next = await win.isMaximized();
        if (!disposed) setMaximized(next);
        unlisten = await win.onResized(async () => {
          const value = await win.isMaximized();
          if (!disposed) setMaximized(value);
        });
      } catch {
        // ignore outside Tauri
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [mac]);

  const run = async (action: "minimize" | "toggle" | "close") => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (action === "minimize") await win.minimize();
      if (action === "close") await win.close();
      if (action === "toggle") {
        if (await win.isMaximized()) await win.unmaximize();
        else await win.maximize();
      }
    } catch {
      // ignore outside Tauri
    }
  };

  return (
    <header
      className={`glass-titlebar ${mac ? "glass-titlebar-mac" : "glass-titlebar-win"}`}
      data-tauri-drag-region
    >
      <div className="glass-titlebar-brand" data-tauri-drag-region>
        <span className="glass-titlebar-mark" aria-hidden />
        <strong data-tauri-drag-region>有秋</strong>
        <small data-tauri-drag-region>Yield</small>
      </div>
      {/* 命令面板入口：全局检索只保留标题栏这一处入口。 */}
      <button
        type="button"
        className="titlebar-command"
        onClick={openCommandPalette}
      >
        <AppIcon name="search" size={14} />
        <span>搜索</span>
      </button>
      {mac ? null : (
        <div className="glass-titlebar-controls">
          <button type="button" className="glass-titlebar-btn" aria-label="最小化" title="最小化" onClick={() => void run("minimize")}>
            <WinGlyph>{GLYPH_MINIMIZE}</WinGlyph>
          </button>
          <button
            type="button"
            className="glass-titlebar-btn"
            aria-label={maximized ? "还原" : "最大化"}
            title={maximized ? "还原" : "最大化"}
            onClick={() => void run("toggle")}
          >
            <WinGlyph>{maximized ? GLYPH_RESTORE : GLYPH_MAXIMIZE}</WinGlyph>
          </button>
          <button
            type="button"
            className="glass-titlebar-close"
            aria-label="关闭"
            title="关闭"
            onClick={() => void run("close")}
          >
            <WinGlyph>{GLYPH_CLOSE}</WinGlyph>
          </button>
        </div>
      )}
    </header>
  );
}
