import { useEffect } from "react";

import { isMobileShell } from "./platform";

/**
 * 桌面「悬浮卡」二级弹窗的收起交互（形态定稿 2026-10-28，同「记一笔」抽屉）。
 *
 * 桌面侧遮罩被置成 display:contents（.floating-backdrop）：背景全亮可交互，
 * 代价是「点卡片以外任意处收起」不再由遮罩接住，改由此处的 pointerdown 监听接管。
 * Esc 一并在这里收口。
 *
 * 豁免 .modal-backdrop（AppConfirm 的居中确认卡）、.select-menu / .date-picker-pop
 * （经 portal 挂在 body 上的下拉与日历）——否则点下拉选项、选日期、确认删除
 * 都会被当成「点了外面」而误收整张卡。
 *
 * 移动壳不注册：底部弹层仍由 backdrop onMouseDown 关闭，真机另有系统返回键。
 */
export function useFloatingDismiss(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open || isMobileShell()) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".floating-card, .modal-backdrop, .select-menu, .date-picker-pop")) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);
}
