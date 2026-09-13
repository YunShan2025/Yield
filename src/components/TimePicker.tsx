import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addMinutesToTime,
  ensureEndAfterStart,
  nowTimeString,
  parseTimeToMinutes,
} from "@/lib/dates";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const POP_ESTIMATED_HEIGHT = 320;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** 宽松解析时间输入:分隔符可省,'930'/'09:30'/'9' 都接受,返回 HH:MM 或 null。 */
function parseTimeInput(raw: string): string | null {
  const digits = raw.trim().replace(/[:：.]/g, "");
  if (!/^\d{1,4}$/.test(digits)) return null;
  const hour = digits.length <= 2 ? Number(digits) : Number(digits.slice(0, -2));
  const minute = digits.length <= 2 ? 0 : Number(digits.slice(-2));
  if (hour > 23 || minute > 59) return null;
  return `${pad(hour)}:${pad(minute)}`;
}

/** Click-to-confirm time picker (no native OK step).
 *  面板经 portal 挂到 body:弹窗/抽屉的 overflow 不再裁剪它,空间不足自动向上弹。 */
export function TimePicker({
  value,
  onChange,
  placeholder = "选择时间",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [precise, setPrecise] = useState("");
  const [preciseInvalid, setPreciseInvalid] = useState(false);
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const [hh, mm] = value
    ? value.split(":").map((x) => Number(x))
    : [null, null];

  const openPop = () => {
    setPrecise(value);
    setPreciseInvalid(false);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      const width = Math.max(rect.width, 264);
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
    const onDoc = (e: MouseEvent) => {
      const target = e.target;
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

  const pick = (hour: number, minute: number) => {
    onChange(`${pad(hour)}:${pad(minute)}`);
    setOpen(false);
  };

  const applyPrecise = () => {
    const parsed = parseTimeInput(precise);
    if (!parsed) {
      setPreciseInvalid(true);
      return;
    }
    onChange(parsed);
    setOpen(false);
  };

  return (
    <div className="time-picker" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={`field time-picker-trigger${value ? "" : " is-empty"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPop())}
      >
        <svg className="time-picker-glyph" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.8V8l2.2 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
              className="time-picker-pop"
              style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}
            >
              <div className="time-picker-section">
                <p className="time-picker-section-label">小时 · 点击即确认</p>
                <div className="time-picker-grid hours">
                  {HOURS.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`time-chip ${hh === h ? "active" : ""}`}
                      onClick={() =>
                        pick(h, mm != null && !Number.isNaN(mm) ? mm : 0)
                      }
                    >
                      {pad(h)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="time-picker-section">
                <p className="time-picker-section-label">分钟 · 每 5 分钟一档</p>
                <div className="time-picker-grid minutes">
                  {MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`time-chip ${mm === m ? "active" : ""}`}
                      onClick={() =>
                        pick(hh != null && !Number.isNaN(hh) ? hh : 9, m)
                      }
                    >
                      :{pad(m)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="time-picker-precise">
                <input
                  className={`field${preciseInvalid ? " is-invalid" : ""}`}
                  value={precise}
                  placeholder="精确输入，如 9:30"
                  onChange={(event) => {
                    setPrecise(event.target.value);
                    setPreciseInvalid(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      applyPrecise();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    onChange(nowTimeString());
                    setOpen(false);
                  }}
                >
                  此刻
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

/** Required start + deadline (end) time range. */
export function TimeRangeFields({
  start,
  end,
  onStartChange,
  onEndChange,
}: {
  start: string;
  end: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  const handleStart = (v: string) => {
    onStartChange(v);
    onEndChange(ensureEndAfterStart(v, end));
  };

  const handleEnd = (v: string) => {
    if (!start) {
      onStartChange(nowTimeString());
      onEndChange(ensureEndAfterStart(nowTimeString(), v));
      return;
    }
    onEndChange(ensureEndAfterStart(start, v));
  };

  const startMin = start ? parseTimeToMinutes(start) : null;
  const endMin = end ? parseTimeToMinutes(end) : null;
  let durationLabel = "";
  if (startMin != null && endMin != null) {
    let diff = endMin - startMin;
    if (diff < 0) diff += 24 * 60;
    const hours = Math.floor(diff / 60);
    const minutes = diff % 60;
    durationLabel = hours
      ? minutes
        ? `预计投入 ${hours} 小时 ${minutes} 分钟`
        : `预计投入 ${hours} 小时`
      : `预计投入 ${minutes} 分钟`;
  }

  return (
    <div className="time-range">
      <div className="time-range-field">
        <span className="field-label">开始时间</span>
        <TimePicker
          value={start}
          onChange={handleStart}
          placeholder="点击选择（默认现在）"
        />
      </div>
      <span className="time-range-arrow" aria-hidden>
        →
      </span>
      <div className="time-range-field">
        <span className="field-label">截止时间</span>
        <TimePicker
          value={end}
          onChange={handleEnd}
          placeholder="点击选择（默认 +1 小时）"
        />
      </div>
      {durationLabel ? (
        <p className="time-range-duration">{durationLabel}</p>
      ) : (
        <p className="time-range-hint">开始时间与截止时间均为必填</p>
      )}
    </div>
  );
}

export function defaultTimeRange(): { start: string; end: string } {
  const start = nowTimeString();
  return { start, end: addMinutesToTime(start, 60) };
}
