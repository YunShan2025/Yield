import { useCallback, useEffect, useRef } from "react";
import type { TouchEvent } from "react";

const DEFAULT_DELAY_MS = 480;
const DEFAULT_MOVE_CANCEL_PX = 12;
const INTERACTIVE_SELECTOR = "button, input, textarea, select, a";

function distance(start: { x: number; y: number }, x: number, y: number) {
  return Math.max(Math.abs(x - start.x), Math.abs(y - start.y));
}

/**
 * 移动端列表行的长按交互。
 *
 * 返回给行的四个触摸处理器只负责定时器与移动取消；`consumeClick` 负责吞掉
 * 长按结束后浏览器补发的 click，避免刚打开操作面板又立即进入任务详情。
 */
export function useLongPress({
  onLongPress,
  enabled = true,
  delay = DEFAULT_DELAY_MS,
  moveCancelPx = DEFAULT_MOVE_CANCEL_PX,
}: {
  onLongPress: () => void;
  enabled?: boolean;
  delay?: number;
  moveCancelPx?: number;
}) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
    start.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const onTouchStart = (event: TouchEvent<HTMLElement>) => {
    fired.current = false;
    if (!enabled) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest(INTERACTIVE_SELECTOR)) return;

    const touch = event.touches[0];
    if (!touch) return;

    clear();
    start.current = { x: touch.clientX, y: touch.clientY };
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      start.current = null;
      fired.current = true;
      onLongPress();
    }, delay);
  };

  const onTouchMove = (event: TouchEvent<HTMLElement>) => {
    const origin = start.current;
    const touch = event.touches[0];
    if (!origin || !touch) return;
    if (distance(origin, touch.clientX, touch.clientY) > moveCancelPx) clear();
  };

  const onTouchEnd = () => {
    if (timer.current !== undefined) clear();
    else start.current = null;
  };

  const consumeClick = () => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
    consumeClick,
  };
}
