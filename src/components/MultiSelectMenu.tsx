import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SelectOption } from "@/components/SelectMenu";

type MultiSelectMenuProps = {
  values: string[];
  options: SelectOption[];
  onToggle: (value: string) => void;
  placeholder?: string;
  emptyHint?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
};

// SelectMenu 的多选版:收起态是同一个 .select-btn(与优先级等字段同款),
// 菜单里点选项只勾选/取消、不收起,✓ 标记全部已选项。标签这类一对多
// 字段用「多选的下拉」,而不是一直摊开的列表框。
export function MultiSelectMenu({
  values,
  options,
  onToggle,
  placeholder = "请选择",
  emptyHint,
  ariaLabel,
  className,
  disabled,
}: MultiSelectMenuProps) {
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
    if (options.length) {
      const current = options.findIndex((item) => values.includes(item.value));
      setActiveIndex(current >= 0 ? current : 0);
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      const estimatedHeight = Math.min(
        Math.max(options.length, 1) * 33 + 10,
        264,
      );
      const spaceBelow = window.innerHeight - rect.bottom;
      const upward =
        spaceBelow < estimatedHeight + 12 && rect.top > estimatedHeight + 12;
      setPos({
        left: Math.max(
          8,
          Math.min(
            rect.left,
            window.innerWidth - Math.max(rect.width, 160) - 8,
          ),
        ),
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
    const close = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const active = menu?.querySelector<HTMLElement>(".is-active");
    if (!menu || !active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < menu.scrollTop) {
      menu.scrollTop = top;
    } else if (bottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = bottom - menu.clientHeight;
    }
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
        const count = Math.max(options.length, 1);
        const next = current + (event.key === "ArrowDown" ? 1 : -1);
        return (next + count) % count;
      });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = options[activeIndex];
      if (item) onToggle(item.value);
    }
  };

  const selectedLabels = options
    .filter((item) => values.includes(item.value))
    .map((item) => item.label);

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
        {selectedLabels.length ? selectedLabels.join("、") : placeholder}
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="select-menu"
              role="listbox"
              aria-multiselectable="true"
              aria-label={ariaLabel}
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            >
              {options.length ? (
                options.map((item, index) => {
                  const on = values.includes(item.value);
                  return (
                    <button
                      type="button"
                      key={item.value}
                      role="option"
                      aria-selected={on}
                      className={`select-option${on ? " is-selected" : ""}${
                        index === activeIndex ? " is-active" : ""
                      }`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => onToggle(item.value)}
                    >
                      <span>{item.label}</span>
                      {on ? (
                        <span className="select-check" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="select-empty">{emptyHint ?? "暂无可选项"}</div>
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
