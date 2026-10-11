import {
  addMinutesToTime,
  ensureEndAfterStart,
  nowTimeString,
  parseTimeToMinutes,
} from "@/lib/dates";
import { SelectMenu } from "@/components/SelectMenu";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

const HOUR_OPTIONS = HOURS.map((h) => ({ value: String(h), label: pad(h) }));
const MINUTE_STEPS = MINUTES;

/** 空值时的兜底时刻：当前时间向下取整到 5 分钟。 */
function nowRounded(): { h: number; m: number } {
  const now = new Date();
  return { h: now.getHours(), m: Math.floor(now.getMinutes() / 5) * 5 };
}

/** 时/分下拉选择：替代原先的宫格时间面板，任务表单里直接两级下拉。
 *  值为空时显示当前时刻作为默认，而不是「时/分」占位符。 */
export function TimeDropdown({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  const fallback = nowRounded();
  const [rawH, rawM] = value
    ? value.split(":").map((x) => Number(x))
    : [fallback.h, fallback.m];
  const hh = Number.isFinite(rawH) && rawH >= 0 && rawH <= 23 ? rawH : fallback.h;
  const mm = Number.isFinite(rawM) && rawM >= 0 && rawM <= 59 ? rawM : fallback.m;

  // 自动排程可能给出非 5 分钟对齐的时间，把当前分钟补进选项，避免回显丢失。
  const minuteOptions = MINUTE_STEPS.includes(mm)
    ? MINUTE_STEPS
    : [...MINUTE_STEPS, mm].sort((a, b) => a - b);

  const pickHour = (raw: string) => {
    const hour = Number(raw);
    onChange(`${pad(hour)}:${pad(mm)}`);
  };
  const pickMinute = (raw: string) => {
    const minute = Number(raw);
    onChange(`${pad(hh)}:${pad(minute)}`);
  };

  return (
    <div className="time-dropdown-group">
      <SelectMenu
        ariaLabel={`${ariaLabel}小时`}
        className="time-dropdown"
        value={String(hh)}
        onChange={pickHour}
        options={HOUR_OPTIONS}
      />
      <span className="time-dropdown-unit" aria-hidden>时</span>
      <SelectMenu
        ariaLabel={`${ariaLabel}分钟`}
        className="time-dropdown"
        value={String(mm)}
        onChange={pickMinute}
        options={[
          ...minuteOptions.map((m) => ({ value: String(m), label: pad(m) })),
        ]}
      />
      <span className="time-dropdown-unit" aria-hidden>分</span>
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
        <TimeDropdown
          ariaLabel="开始时间"
          value={start}
          onChange={handleStart}
        />
      </div>
      <span className="time-range-arrow" aria-hidden>
        →
      </span>
      <div className="time-range-field">
        <span className="field-label">截止时间</span>
        <TimeDropdown
          ariaLabel="截止时间"
          value={end}
          onChange={handleEnd}
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
