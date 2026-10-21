import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import type { Timer } from "@/types";
import { formatCountdown, intervalLabel, liveRemaining } from "@/lib/timers";
import { isMobileShell } from "@/lib/platform";
import { confirmAction } from "@/components/AppConfirm";
import { TimeDropdown } from "@/components/TimePicker";
import { AppIcon } from "@/components/AppIcon";

/** 当前时刻起 sec 秒后的钟点（HH:MM），用于「预计几点提醒」预览。 */
function finishClockIn(seconds: number): string {
  const end = new Date(Date.now() + seconds * 1000);
  return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
}

/** 列表排序：运行中在前，已结束垫底，其余按剩余时间升序。 */
function sortTimers(timers: Timer[]): Timer[] {
  return [...timers].sort((a, b) => {
    if (a.running !== b.running) return a.running ? -1 : 1;
    return liveRemaining(a) - liveRemaining(b);
  });
}

/** 「到指定时间」的默认结束时间：当前时刻 + 1 小时，向上取整到 5 分钟。 */
function defaultFinishTime(): string {
  const end = new Date(Date.now() + 60 * 60 * 1000);
  const minutes = Math.ceil(end.getMinutes() / 5) * 5;
  if (minutes >= 60) {
    end.setHours(end.getHours() + 1);
    end.setMinutes(0);
  } else {
    end.setMinutes(minutes);
  }
  end.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

export function RemindersView() {
  const timers = useAppStore((s) => s.timers);
  const addTimer = useAppStore((s) => s.addTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const pauseTimer = useAppStore((s) => s.pauseTimer);
  const resetTimer = useAppStore((s) => s.resetTimer);
  const extendTimer = useAppStore((s) => s.extendTimer);
  const removeTimer = useAppStore((s) => s.removeTimer);
  const [tab, setTab] = useState<"countdown" | "interval">("countdown");
  const [creating, setCreating] = useState(false);
  const [countdownTitle, setCountdownTitle] = useState("");
  const [countdownMinutes, setCountdownMinutes] = useState(25);
  const [timeMode, setTimeMode] = useState<"duration" | "finish">("duration");
  const [finishAt, setFinishAt] = useState(defaultFinishTime);
  const [intervalTitle, setIntervalTitle] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [, setTick] = useState(0);

  // 每秒重渲染一次，驱动倒计时数字与状态栏刷新。
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const intervals = timers.filter((timer) => timer.kind === "interval");
  const countdowns = timers.filter((timer) => timer.kind === "task");
  const visibleTimers = tab === "countdown" ? countdowns : intervals;
  const active = useMemo(
    () =>
      visibleTimers
        .filter((timer) => timer.running)
        .sort((a, b) => liveRemaining(a) - liveRemaining(b))[0] ?? null,
    [visibleTimers],
  );
  const runningCount = visibleTimers.filter((timer) => timer.running).length;
  const finishedCount = visibleTimers.filter((timer) => !timer.running && liveRemaining(timer) === 0).length;

  const countdownSeconds = () => {
    if (timeMode === "duration") return Math.max(1, Math.floor(countdownMinutes)) * 60;
    if (!finishAt) return 0;
    const [hours, minutes] = finishAt.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0;
    const end = new Date();
    end.setHours(hours, minutes, 0, 0);
    if (end.getTime() <= Date.now()) end.setDate(end.getDate() + 1);
    return Math.max(60, Math.ceil((end.getTime() - Date.now()) / 1000));
  };

  const closeCreate = () => setCreating(false);

  const submitCountdown = async () => {
    const seconds = countdownSeconds();
    if (!seconds) return;
    const timer = await addTimer({
      kind: "task",
      title: countdownTitle.trim() || "倒计时",
      interval_sec: seconds,
      start: true,
    });
    if (timer) {
      setCountdownTitle("");
      setCreating(false);
    }
  };

  const submitInterval = async (start: boolean) => {
    const timer = await addTimer({
      kind: "interval",
      title: intervalTitle.trim() || "循环提醒",
      interval_sec: Math.max(1, Math.floor(intervalMinutes)) * 60,
      start,
    });
    if (timer) {
      setIntervalTitle("");
      setCreating(false);
    }
  };

  const finishHint =
    timeMode === "finish" && !finishAt ? "" : `预计 ${finishClockIn(countdownSeconds())} 提醒`;

  return (
    <div className="reminders-view">
      {/* 与「今日」同构的标题区:h2 标题 + 副标题,右侧为计时类型切换与新建按钮。 */}
      <div className="workspace-top">
        <div>
          <h2>提醒</h2>
          <p className="workspace-subtitle">临时事项用倒计时，喝水、护眼等固定节奏用循环提醒。</p>
        </div>
        <div className="top-controls">
          <div className="timer-tabs" role="tablist" aria-label="计时类型">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "countdown"}
              className={tab === "countdown" ? "active" : ""}
              onClick={() => setTab("countdown")}
            >
              倒计时 <span>{countdowns.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "interval"}
              className={tab === "interval" ? "active" : ""}
              onClick={() => setTab("interval")}
            >
              循环提醒 <span>{intervals.length}</span>
            </button>
          </div>
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            {tab === "countdown" ? "新建倒计时" : "新建循环提醒"}
          </button>
        </div>
      </div>

      {/* 与「今日/成长」同款的暖色引导框。 */}
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
          <h3>关掉窗口，提醒也不会丢。</h3>
          <p className="today-hero-note">
            {isMobileShell()
              ? "到期提醒由系统送达，应用退到后台也能收到。"
              : "到期提醒由系统送达；彻底退出请用托盘菜单的「退出应用」。"}
          </p>
        </div>
      </section>

      <div className="reminders-body">
        <section className={`timer-status-rail ${active ? "has-active" : ""}`} aria-label="提醒状态">
          <i className="timer-status-pulse" />
          <div className="timer-status-primary">
            <span>{active ? "当前正在计时" : "当前没有运行中的提醒"}</span>
            <strong>
              {active?.title ?? "时间空闲，可以开始一段新计时"}
              {active ? <em className="timer-status-remain">剩余 {formatCountdown(liveRemaining(active))}</em> : null}
            </strong>
          </div>
          <div>
            <span>运行中</span>
            <strong>{runningCount}</strong>
          </div>
          <div>
            <span>{tab === "countdown" ? "已结束" : "已保存"}</span>
            <strong>{tab === "countdown" ? finishedCount : visibleTimers.length}</strong>
          </div>
        </section>

        {tab === "countdown" ? (
          <TimerList
            title="我的倒计时"
            timers={countdowns}
            empty="还没有倒计时。点击右上角「新建倒计时」开始。"
            onStart={startTimer}
            onPause={pauseTimer}
            onReset={resetTimer}
            onExtend={(id) => extendTimer(id, 300)}
            onRemove={removeTimer}
          />
        ) : (
          <TimerList
            title="循环提醒"
            timers={intervals}
            empty="还没有循环提醒。点击右上角「新建循环提醒」创建自己的节奏。"
            onStart={startTimer}
            onPause={pauseTimer}
            onReset={resetTimer}
            onRemove={removeTimer}
          />
        )}
      </div>

      {/* 新建倒计时弹窗：与项目/标签页同构；时长只保留自定义。 */}
      {creating && tab === "countdown" ? (
        <div className="modal-backdrop" onMouseDown={closeCreate}>
          <form
            className="project-edit-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitCountdown();
            }}
          >
            <div className="modal-head">
              <div>
                <h3>新建倒计时</h3>
              </div>
              <button type="button" onClick={closeCreate}>×</button>
            </div>
            <label>
              名称
              <input
                autoFocus
                value={countdownTitle}
                placeholder="这个倒计时叫什么？"
                maxLength={20}
                onChange={(event) => setCountdownTitle(event.target.value)}
              />
            </label>
            <label>
              计时方式
              <div className="countdown-mode-switch" role="radiogroup" aria-label="计时方式">
                <button
                  type="button"
                  className={timeMode === "duration" ? "active" : ""}
                  onClick={() => setTimeMode("duration")}
                >
                  按时长
                </button>
                <button
                  type="button"
                  className={timeMode === "finish" ? "active" : ""}
                  onClick={() => setTimeMode("finish")}
                >
                  到指定时间
                </button>
              </div>
            </label>
            {timeMode === "duration" ? (
              <label>
                时长
                <div className="countdown-custom-time is-active">
                  <div className="countdown-custom-stepper">
                    <button
                      type="button"
                      className="countdown-custom-step"
                      aria-label="减少一分钟"
                      onClick={() => setCountdownMinutes((m) => Math.max(1, Math.floor(m) - 1))}
                    >
                      −
                    </button>
                    <input
                      aria-label="倒计时分钟数"
                      type="number"
                      min={1}
                      max={1440}
                      inputMode="numeric"
                      value={countdownMinutes}
                      onChange={(event) => setCountdownMinutes(Number(event.target.value) || 1)}
                    />
                    <span className="countdown-custom-unit">分钟</span>
                    <button
                      type="button"
                      className="countdown-custom-step"
                      aria-label="增加一分钟"
                      onClick={() => setCountdownMinutes((m) => Math.min(1440, Math.floor(m) + 1))}
                    >
                      ＋
                    </button>
                  </div>
                </div>
              </label>
            ) : (
              <label>
                结束时间
                <TimeDropdown ariaLabel="结束时间" value={finishAt} onChange={setFinishAt} />
                <small className="reminders-field-hint">早于当前时间时，将按明天计算。</small>
              </label>
            )}
            {finishHint ? <small className="countdown-create-hint">{finishHint}</small> : null}
            <div className="project-edit-actions">
              <button type="button" className="btn-ghost item-action-btn" onClick={closeCreate}>取消</button>
              <button
                type="submit"
                className="btn-primary item-action-btn item-action-primary"
                disabled={timeMode === "finish" && !finishAt}
              >
                开始倒计时
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* 新建循环提醒弹窗：无预设模板，只自定义名称与间隔。 */}
      {creating && tab === "interval" ? (
        <div className="modal-backdrop" onMouseDown={closeCreate}>
          <form
            className="project-edit-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitInterval(true);
            }}
          >
            <div className="modal-head">
              <div>
                <h3>新建循环提醒</h3>
              </div>
              <button type="button" onClick={closeCreate}>×</button>
            </div>
            <label>
              名称
              <input
                autoFocus
                value={intervalTitle}
                placeholder="例如：喝水、护眼休息"
                maxLength={20}
                onChange={(event) => setIntervalTitle(event.target.value)}
              />
            </label>
            <label>
              间隔
              <div className="countdown-custom-time is-active">
                <div className="countdown-custom-stepper">
                  <button
                    type="button"
                    className="countdown-custom-step"
                    aria-label="减少间隔一分钟"
                    onClick={() => setIntervalMinutes((m) => Math.max(1, Math.floor(m) - 1))}
                  >
                    −
                  </button>
                  <input
                    aria-label="循环间隔分钟数"
                    type="number"
                    min={1}
                    max={1440}
                    inputMode="numeric"
                    value={intervalMinutes}
                    onChange={(event) => setIntervalMinutes(Number(event.target.value) || 1)}
                  />
                  <span className="countdown-custom-unit">分钟</span>
                  <button
                    type="button"
                    className="countdown-custom-step"
                    aria-label="增加间隔一分钟"
                    onClick={() => setIntervalMinutes((m) => Math.min(1440, Math.floor(m) + 1))}
                  >
                    ＋
                  </button>
                </div>
              </div>
            </label>
            <div className="project-edit-actions">
              <button type="button" className="btn-ghost item-action-btn" onClick={() => void submitInterval(false)}>
                仅保存
              </button>
              <button type="submit" className="btn-primary item-action-btn item-action-primary">开始提醒</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

type TimerListProps = {
  title: string;
  timers: Timer[];
  empty: string;
  onStart: (id: string) => Promise<void>;
  onPause: (id: string) => Promise<void>;
  onReset: (id: string) => Promise<void>;
  onExtend?: (id: string) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

function TimerList({ title, timers, empty, onStart, onPause, onReset, onExtend, onRemove }: TimerListProps) {
  const sorted = sortTimers(timers);
  return (
    <section className="reminders-section">
      <div className="reminders-section-head">
        <h3>{title}</h3>
        <span>{timers.length}</span>
      </div>
      {!timers.length ? (
        <div className="reminders-empty">{empty}</div>
      ) : (
        <div className="reminders-stack">
          {sorted.map((timer) => (
            <TimerCard
              key={timer.id}
              timer={timer}
              onStart={() => void onStart(timer.id)}
              onPause={() => void onPause(timer.id)}
              onReset={() => void onReset(timer.id)}
              onExtend={onExtend ? () => void onExtend(timer.id) : undefined}
              onRemove={() => {
                void confirmAction({
                  title: `删除「${timer.title}」？`,
                  confirmText: "删除",
                  danger: true,
                }).then((ok) => {
                  if (ok) void onRemove(timer.id);
                });
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TimerCard({
  timer,
  onStart,
  onPause,
  onReset,
  onExtend,
  onRemove,
}: {
  timer: Timer;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onExtend?: () => void;
  onRemove: () => void;
}) {
  const remaining = liveRemaining(timer);
  const running = Boolean(timer.running);
  const finished = !running && remaining === 0;
  const progress = Math.min(1, Math.max(0, 1 - remaining / Math.max(1, timer.interval_sec)));
  const badge =
    timer.kind === "interval"
      ? `每 ${intervalLabel(timer.interval_sec)}`
      : running
        ? `进行中 · ${finishClockIn(remaining)} 提醒`
        : finished
          ? "已结束"
          : "已暂停";
  return (
    <article className={`timer-card ${running ? "is-running" : ""}${finished ? " is-finished" : ""}`}>
      <div className="timer-card-top">
        <div className="timer-card-text">
          <strong>{timer.title}</strong>
          <span className={`timer-badge${running ? " is-running" : ""}${finished ? " is-finished" : ""}`}>
            {running ? <i className="timer-live-dot" aria-hidden /> : null}
            {badge}
          </span>
        </div>
        <div className="timer-countdown">{formatCountdown(remaining)}</div>
      </div>
      <div className="timer-progress" aria-hidden>
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="timer-actions">
        {running ? (
          <button type="button" className="item-action-btn item-action-primary" onClick={onPause}>
            <AppIcon name="pause" size={14} />
            <span>暂停</span>
          </button>
        ) : (
          <button type="button" className="item-action-btn item-action-primary" onClick={onStart}>
            <AppIcon name="play" size={14} />
            <span>{finished ? "再次开始" : "继续"}</span>
          </button>
        )}
        {onExtend && remaining > 0 ? (
          <button type="button" className="item-action-btn" onClick={onExtend}>
            <AppIcon name="timer" size={14} />
            <span>+5 分钟</span>
          </button>
        ) : null}
        <button type="button" className="item-action-btn" onClick={onReset}>
          <AppIcon name="review" size={14} />
          <span>重置</span>
        </button>
        <button type="button" className="item-action-btn item-action-danger" onClick={onRemove}>
          <AppIcon name="trash" size={14} />
          <span>删除</span>
        </button>
      </div>
    </article>
  );
}
