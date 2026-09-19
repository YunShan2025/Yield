type BackHandler = () => boolean;

// 后进先出：抽屉/弹层在打开时注册关闭回调，关闭时注销。
// Android 返回键桥与应用内右滑手势都经 runBackHandlers 消费，
// 保证「返回不退出应用、只关闭最上层浮层」的一致语义。
const stack: BackHandler[] = [];

/** 注册一个返回处理（返回 true 表示已消费）；返回值用于注销。 */
export function pushBackHandler(fn: BackHandler): () => void {
  stack.push(fn);
  return () => {
    const index = stack.indexOf(fn);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** 交给最上层的处理器；无人消费时返回 false（原生层退后台）。 */
export function runBackHandlers(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true;
    } catch {
      /* 单个处理器异常不阻断其余浮层的关闭 */
    }
  }
  return false;
}

/**
 * 抽屉/全屏浮层的右滑关闭手势：从触点起横向右拖超过阈值即触发 onClose。
 * 纵向意图（滚动列表）不触发；每次触摸只触发一次。仅限触摸事件。
 */
export function attachSwipeRightToClose(
  el: HTMLElement,
  onClose: () => void,
  threshold = 72,
): () => void {
  let start: { x: number; y: number } | null = null;
  let closed = false;
  const onStart = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    start = { x: touch.clientX, y: touch.clientY };
    closed = false;
  };
  const onMove = (event: TouchEvent) => {
    if (!start || closed) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (dx > threshold && Math.abs(dx) > Math.abs(dy) * 1.4) {
      closed = true;
      start = null;
      onClose();
    }
  };
  const onEnd = () => {
    start = null;
    closed = false;
  };
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: true });
  el.addEventListener("touchend", onEnd, { passive: true });
  el.addEventListener("touchcancel", onEnd, { passive: true });
  return () => {
    el.removeEventListener("touchstart", onStart);
    el.removeEventListener("touchmove", onMove);
    el.removeEventListener("touchend", onEnd);
    el.removeEventListener("touchcancel", onEnd);
  };
}
