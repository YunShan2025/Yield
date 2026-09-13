import { StrictMode, Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { detectDesktopPlatform } from "@/lib/platform";
import "@/styles/index.css";

// 窗口在配置中默认隐藏，前端内容就绪后再显示，避免启动时闪现未完成的界面。
let windowRevealed = false;
function revealWindow() {
  if (windowRevealed) return;
  windowRevealed = true;
  const current = getCurrentWindow();
  void current.show();
  void current.setFocus();
}

// 等 DOM 提交且首帧绘制完成后再显示；rAF 被挂起时由定时器兜底。
function revealWhenPainted() {
  requestAnimationFrame(() => {
    requestAnimationFrame(revealWindow);
  });
  window.setTimeout(revealWindow, 250);
}

function BootError({ message }: { message: string }) {
  const restart = async () => {
    try {
      await invoke("restart_app");
    } catch {
      window.location.reload();
    }
  };
  const openDataDirectory = async () => {
    try {
      await invoke("open_data_directory");
    } catch {
      /* keep the error screen interactive even if opening fails */
    }
  };
  return (
    <div
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
        color: "#1f2933",
        background: "#f6f4ef",
      }}
    >
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>界面加载失败</h1>
      <p style={{ margin: "0 0 12px", color: "#5b6570" }}>
        安装文件可能损坏，或某个模块没有正确加载。可以重启应用，或打开数据目录检查备份。
      </p>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          padding: 12,
          background: "#fff",
          borderRadius: 8,
          fontSize: 12,
        }}
      >
        {message}
      </pre>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={() => void restart()}>
          重启应用
        </button>
        <button type="button" onClick={() => void openDataDirectory()}>
          打开数据目录
        </button>
      </div>
    </div>
  );
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  render() {
    if (this.state.error) {
      return <BootError message={this.state.error} />;
    }
    return this.props.children;
  }
}

document.documentElement.dataset.theme ||= "system";
document.documentElement.dataset.platform = detectDesktopPlatform();

const root = createRoot(document.getElementById("root")!);

void import("@/app/MainApp")
  .then(({ MainApp }) => {
    flushSync(() => {
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <MainApp />
          </ErrorBoundary>
        </StrictMode>,
      );
    });
    revealWhenPainted();
  })
  .catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message || String(error)
        : String(error ?? "未知错误");
    flushSync(() => {
      root.render(<BootError message={message} />);
    });
    revealWindow();
  });
