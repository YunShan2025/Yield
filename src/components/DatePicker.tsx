import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { parseDate, toDateString, todayDateString } from "@/lib/dates";

const POP_ESTIMATED_HEIGHT = 356;
const WEEKDAY_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 应用主题的日期选择器，替代原生 input[type=date]（其弹出的日历是系统级
 * UI，无法套用应用主题）。触发钮与面板样式对齐 TimePicker：面板经 portal
 * 挂到 body 避免被弹窗/抽屉 overflow 裁剪，空间不足自动向上弹。
 * value 为 "YYYY-MM-DD"，allowClear 时允许清空为 ""。
 */
export function DatePicker({
  value,
  onChange,
  placeholder = "选择日期",
  allowClear = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // 面板内独立维护「正在浏览的年月」：翻页不影响已选值，打开时回到已选月。
  const [view, setView] = useState(() => {
    const base = value ? parseDate(value) : new Date();
    return { y: base.getFullYear(), m: base.getMonth() + 1 };
  });
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const openPop = () => {
    const anchor = value ? parseDate(value) : new Date();
    setView({ y: anchor.getFullYear(), m: anchor.getMonth() + 1 });
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.max(rect.width, 272);
      const upward =
        window.innerHeight - rect.bottom < POP_ESTIMATED_HEIGHT + 12 &&
        rect.top > POP_ESTIMATED_HEIGHT + 12;
      setPos({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        width,
        ...(upward
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      });
    }
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (triggerRef.current?.contains(target) || popRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (open && event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const shiftMonth = (delta: number) => {
    setView((current) => {
      const next = new Date(current.y, current.m - 1 + delta, 1);
      return { y: next.getFullYear(), m: next.getMonth() + 1 };
    });
  };

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m - 1, 1);
    const lead = (first.getDay() + 6) % 7; // 周一为一周起点
    const total = new Date(view.y, view.m, 0).getDate();
    const list: (number | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= total; d += 1) list.push(d);
    while (list.length % 7 !== 0) list.push(null);
    return list;
  }, [view]);

  const today = todayDateString();

  return (
    <div className={`date-picker${className ? ` ${className}` : ""}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`field date-picker-trigger${value ? "" : " is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openPop())}
      >
        <svg className="time-picker-glyph" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="2.2" y="3.4" width="11.6" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2.2 6.8h11.6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M5.4 1.6v2.6M10.6 1v2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>{value || placeholder}</span>
        <svg className="time-picker-caret" width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              className="date-picker-pop"
              role="dialog"
              aria-label={ariaLabel ?? "选择日期"}
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            >
              <div className="date-picker-head">
                <button type="button" aria-label="上个月" onClick={() => shiftMonth(-1)}>
                  ‹
                </button>
                <strong>{view.y} 年 {view.m} 月</strong>
                <button type="button" aria-label="下个月" onClick={() => shiftMonth(1)}>
                  ›
                </button>
              </div>
              <div className="date-picker-week" aria-hidden>
                {WEEKDAY_HEADS.map((head) => (
                  <span key={head}>{head}</span>
                ))}
              </div>
              <div className="date-picker-grid">
                {cells.map((day, index) =>
                  day === null ? (
                    <i key={`pad-${index}`} aria-hidden />
                  ) : (
                    <button
                      key={day}
                      type="button"
                      className={`date-cell${
                        value === toDateString(new Date(view.y, view.m - 1, day))
                          ? " is-selected"
                          : ""
                      }`}
                      onClick={() => {
                        onChange(toDateString(new Date(view.y, view.m - 1, day)));
                        setOpen(false);
                      }}
                    >
                      {day}
                    </button>
                  ),
                )}
              </div>
              <div className="date-picker-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    onChange(today);
                    setOpen(false);
                  }}
                >
                  今天
                </button>
                {allowClear ? (
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
