import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 设计评审：浏览器预览接真实数据副本，生产构建不经过这条路径。
// 必须条件动态 import：插件链顶格加载 node:sqlite（Node ≥22.5），
// 若静态 import，未设环境变量的机器在「读配置」阶段就会炸掉构建。
async function designReviewPlugins() {
  if (process.env.YOUQIU_DESIGN_REVIEW !== "1") return [];
  const { designReview } = await import("./scripts/design-review/vite-plugin.mjs");
  return [designReview()];
}

export default defineConfig(async () => ({
  plugins: [react(), ...(await designReviewPlugins())],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  clearScreen: false,
  server: {
    // 安卓开发模式由 CLI 注入 TAURI_DEV_HOST（本机局域网 IP），模拟器/真机经该地址访问 dev server。
    host: process.env.TAURI_DEV_HOST || "localhost",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Android 用系统 WebView（老旧设备可能停在 Chrome 83 一带），语法目标必须下探；
    // 桌面端 WebView2 永久更新，维持 es2021 产物更小更快。
    target: process.env.TAURI_ENV_PLATFORM === "android" ? "chrome83" : "es2021",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (normalized.includes("lunar-typescript")) return "lunar";
          if (normalized.includes("/src/lib/anniversaries")) return "anniversaries";
          if (!normalized.includes("node_modules")) return;
          if (normalized.includes("react-dom") || normalized.includes("/react/") || id.includes("\\react\\")) {
            return "react-vendor";
          }
          if (normalized.includes("@tauri-apps")) return "tauri-vendor";
          if (normalized.includes("@dnd-kit")) return "dnd-vendor";
          if (
            normalized.includes("react-markdown") ||
            normalized.includes("remark-") ||
            normalized.includes("mdast") ||
            normalized.includes("micromark") ||
            normalized.includes("unist") ||
            normalized.includes("vfile")
          ) {
            return "markdown-vendor";
          }
          if (normalized.includes("zustand")) return "zustand";
        },
      },
    },
  },
}));


