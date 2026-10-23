import type { KeyboardEvent, ReactNode } from "react";

import { useLongPress } from "@/components/mobile/useLongPress";

/**
 * 今日 / 待办箱共用的可点击列表行。
 *
 * 这里统一承载长按、触摸移动取消、键盘 Enter/Space、可见焦点和读屏状态。
 * 行内仍可放完成圆钮等独立按钮；事件冒泡由具体按钮自己 stopPropagation。
 */
export function MobileTaskRow({
  className,
  label,
  selected,
  disabled = false,
  pressEnabled = true,
  onActivate,
  onLongPress,
  children,
}: {
  className: string;
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  pressEnabled?: boolean;
  onActivate: () => void;
  onLongPress: () => void;
  children: ReactNode;
}) {
  const press = useLongPress({
    onLongPress,
    enabled: pressEnabled && !disabled,
  });
  const isToggle = typeof selected === "boolean";

  const activate = () => {
    if (!disabled) onActivate();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate();
    }
  };

  return (
    <li
      className={className}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-pressed={isToggle ? selected : undefined}
      aria-disabled={disabled ? true : undefined}
      onTouchStart={press.onTouchStart}
      onTouchMove={press.onTouchMove}
      onTouchEnd={press.onTouchEnd}
      onTouchCancel={press.onTouchCancel}
      onClick={() => {
        if (press.consumeClick()) return;
        activate();
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </li>
  );
}
