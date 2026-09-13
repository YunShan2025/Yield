import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type SelectOption = { value: string; label: string };

type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

// 替代原生 <select>:原生下拉展开后的选项列表是系统级弹层,CSS 无法定制,
// 因此收起态与展开态全部自绘。菜单经 portal 挂到 body,避免被抽屉/弹窗的
// overflow 裁剪;菜单开启时吞掉 Escape 等按键,防止连带关闭所在抽屉或弹窗。
export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  className,
  disabled,
}: SelectMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    if (disabled) return;
    const current = options.findIndex((item) => item.value === value);
    setActiveIndex(current >= 0 ? current : 0);
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const estimatedHeight = Math.min(options.length * 33 + 10, 264);
      const spaceBelow = window.innerHeight - rect.bottom;
      const upward = spaceBelow < estimatedHeight + 12 && rect.top > estimatedHeight + 12;
      setPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 160) - 8)),
        width: Math.max(rect.width, 140),
        ...(upward
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (btnRef.current?.contains(event.target)) return;
      if (event.target.closest(".select-menu")) return;
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setActiveIndex((current) => {
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        return (next + options.length) % options.length;
      });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = options[activeIndex];
      if (item) {
        onChange(item.value);
        setOpen(false);
      }
    }
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`select-btn${className ? ` ${className}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {(options.find((item) => item.value === value) ?? options[0])?.label ?? ""}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="select-menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            >
              {options.map((item, index) => (
                <button
                  type="button"
                  key={item.value}
                  role="option"
                  aria-selected={item.value === value}
                  className={`select-option${item.value === value ? " is-selected" : ""}${
                    index === activeIndex ? " is-active" : ""
                  }`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <span>{item.label}</span>
                  {item.value === value ? (
                    <span className="select-check" aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
