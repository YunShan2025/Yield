import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import type { FocusTaskMode, Goal, TaskPriority, Timer } from "@/types";
import { formatCountdown, liveRemaining, parseFocusTaskDraft } from "@/lib/timers";
import { fetchGoals } from "@/lib/db";
import { goalAcceptsSource } from "@/lib/growth";
import { sortProjectsByName } from "@/lib/projects";
import { isMobileShell } from "@/lib/platform";
import { useFloatingDismiss } from "@/lib/floatingDialog";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { DesktopGuideCard } from "@/components/DesktopGuideCard";
import { ExpandRow } from "@/components/ExpandRow";
import { confirmAction } from "@/components/AppConfirm";
import { AppIcon } from "@/components/AppIcon";
import { SelectMenu } from "@/components/SelectMenu";

/** 番茄钟常用时长预设（分钟）。 */
const PRESET_MINUTES = [15, 25, 50];

/** 三档任务关联的选择器文案。 */
const LINK_MODES: { value: FocusTaskMode; label: string }[] = [
  { value: "none", label: "只专注" },
  { value: "existing", label: "关联已有任务" },
  { value: "new", label: "新建任务" },
];

/** 排序：进行中在前，已结束其次，暂停的按剩余时间升序。 */
function sortFocus(timers: Timer[]): Timer[] {
  const rank = (t: Timer) => (t.running ? 0 : liveRemaining(t) === 0 ? 1 : 2);
  return [...timers].sort((a, b) => {
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return liveRemaining(a) - liveRemaining(b);
  });
}

/** 从专注任务推导起止钟点，用于卡片上的时间区间展示。 */
function focusWindow(timer: Timer): string {
  const parsedEnd =
    timer.running && timer.ends_at
      ? Date.parse(timer.ends_at)
      : timer.last_fired_at
        ? Date.parse(timer.last_fired_at)
        : NaN;
  if (!Number.isFinite(parsedEnd)) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const end = new Date(parsedEnd);
  const start = new Date(parsedEnd - Math.max(60, timer.interval_sec) * 1000);
  return `${pad(start.getHours())}:${pad(start.getMinutes())}–${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

/** 卡片/弹窗共用的专注态标签。 */
function focusBadge(timer: Timer, window: string): string {
  if (timer.running) return "进行中";
  if (liveRemaining(timer) === 0) return window ? `已结束 · ${window}` : "已结束";
  return "已暂停";
}

export function FocusView() {
  const timers = useAppStore((s) => s.timers);
  const addTimer = useAppStore((s) => s.addTimer);
  const startTimer = useAppStore((s) => s.startTimer);
  const pauseTimer = useAppStore((s) => s.pauseTimer);
  const resetTimer = useAppStore((s) => s.resetTimer);
  const editFocus = useAppStore((s) => s.editFocus);
  const removeTimer = useAppStore((s) => s.removeTimer);
  const completeFocus = useAppStore((s) => s.completeFocus);
  const focusTodayCount = useAppStore((s) => s.focusTodayCount);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Timer | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // 每秒重渲染一次，驱动倒计时数字与状态刷新。
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (timer: Timer) => {
    setEditing(timer);
    setDialogOpen(true);
  };
  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
  };

  useFloatingDismiss(dialogOpen, closeDialog);

  const submit = async (payload: DraftPayload) => {
    const seconds = Math.max(1, Math.floor(payload.minutes)) * 60;
    const title = payload.title.trim() || "专注";
    const taskDraft =
      payload.linkMode === "new"
        ? {
            priority: payload.priority,
            projectId: payload.projectId || null,
            tagId: payload.tagId || null,
            goalId: payload.goalId || null,
            goalMeasure: payload.goalMeasure,
            goalContribution: payload.goalContribution,
          }
        : null;
    const taskRefId = payload.linkMode === "existing" ? payload.existingTaskId || null : null;

    if (editing) {
      await editFocus(editing.id, {
        title,
        interval_sec: seconds,
        task_mode: payload.linkMode,
        task_ref_id: taskRefId,
        task_draft: taskDraft,
      });
    } else {
      const timer = await addTimer({
        kind: "task",
        title,
        interval_sec: seconds,
        start: true,
        taskMode: payload.linkMode,
        taskRefId,
        taskDraft,
      });
      if (!timer) return;
    }
    closeDialog();
  };

  const sorted = sortFocus(timers);

  return (
    <div className="reminders-view">
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "专注" : undefined}>
            {isMobileShell() ? <MobileTitleChars text="专注" /> : "专注"}
          </h2>
          <p className="workspace-subtitle">
            专注一段时间，结束时可只专注，也可一键记为任务。
          </p>
        </div>
        <div className="top-controls">
          <button type="button" className="btn-primary" onClick={openCreate}>
            开始专注
          </button>
        </div>
      </div>

      {/* 顶卡（2026-11-01 用户定）：一句「今日已专注 x 次」，x 数的是完成流水
          （focus_logs），三档关联都算；同日升为引导卡族（DesktopGuideCard /
          MobileGuideCard 紧凑档），与习惯/目标/足迹等页顶卡同款卡面。 */}
      {isMobileShell() ? (
        <MobileGuideCard value={focusTodayCount} unit="次" label="今日已专注" />
      ) : (
        <DesktopGuideCard
          value={focusTodayCount}
          unit="次"
          label="今日已专注"
          note="三档关联（只专注／关联任务／新建任务）都记入这条记录。"
        />
      )}

      <div className="reminders-body">
        <section className="reminders-section">
          <div className="reminders-section-head">
            <h3>专注中</h3>
            <span>{timers.length}</span>
          </div>
          {!timers.length ? (
            <div className="reminders-empty">还没有专注，点右上角「开始专注」计一段时间。</div>
          ) : (
            <div className="reminders-stack">
              {sorted.map((timer) => (
                <FocusCard
                  key={timer.id}
                  timer={timer}
                  expanded={expandedId === timer.id}
                  onToggle={() => setExpandedId((current) => (current === timer.id ? null : timer.id))}
                  onStart={() => void startTimer(timer.id)}
                  onPause={() => void pauseTimer(timer.id)}
                  onReset={() => void resetTimer(timer.id)}
                  onEdit={() => openEdit(timer)}
                  onRecord={() => void completeFocus(timer)}
                  onRemove={() => {
                    void confirmAction({
                      title: `丢弃「${timer.title}」这段专注？`,
                      description: "不会写入任务，且不可恢复。",
                      confirmText: "丢弃",
                      danger: true,
                    }).then((ok) => {
                      if (ok) void removeTimer(timer.id);
                    });
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {dialogOpen ? (
        <FocusDialog
          key={editing?.id ?? "new"}
          timer={editing}
          onCancel={closeDialog}
          onSubmit={(payload) => void submit(payload)}
        />
      ) : null}
    </div>
  );
}

type DraftPayload = {
  title: string;
  minutes: number;
  linkMode: FocusTaskMode;
  existingTaskId: string;
  priority: TaskPriority;
  projectId: string;
  tagId: string;
  goalId: string;
  goalMeasure: "none" | "one" | "custom";
  goalContribution: number;
};

type DialogProps = {
  timer: Timer | null;
  onCancel: () => void;
  onSubmit: (payload: DraftPayload) => void;
};

/** 新建 / 编辑专注共用的浮层：标题、时长、三档任务关联与（新建档的）任务信息。 */
function FocusDialog({ timer, onCancel, onSubmit }: DialogProps) {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);

  const prefill = timer ? parseFocusTaskDraft(timer.task_draft) : null;
  const [title, setTitle] = useState(timer?.title ?? "");
  const [minutes, setMinutes] = useState(timer ? Math.round(timer.interval_sec / 60) : 25);
  const [linkMode, setLinkMode] = useState<FocusTaskMode>(timer?.task_mode ?? "none");
  const [existingTaskId, setExistingTaskId] = useState(timer?.task_ref_id ?? "");
  const [priority, setPriority] = useState<TaskPriority>(prefill?.priority ?? 3);
  const [projectId, setProjectId] = useState(prefill?.projectId ?? "");
  const [tagId, setTagId] = useState(prefill?.tagId ?? "");
  // 目标关联：与「新建任务」弹窗同原子（目标 + 计量档 + 自定义单位数）。
  // 旧草稿没存计量档：贡献 1 读回「算 1 个单位」，其余读回「不计入（只关联）」。
  const [goalId, setGoalId] = useState(prefill?.goalId ?? "");
  const [goalMeasure, setGoalMeasure] = useState<"none" | "one" | "custom">(
    prefill?.goalMeasure ?? (prefill?.goalId ? (prefill.goalContribution === 1 ? "one" : "none") : "none"),
  );
  const [goalContribution, setGoalContribution] = useState(String(prefill?.goalContribution ?? 1));
  const [goals, setGoals] = useState<Goal[]>([]);

  const linkableGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );
  useEffect(() => {
    void fetchGoals().then(setGoals);
  }, []);
  const selectedGoal = goalId ? linkableGoals.find((goal) => goal.id === goalId) ?? null : null;
  const canMeasure = selectedGoal ? goalAcceptsSource(selectedGoal, "task") : false;
  const measuredContribution =
    !goalId || goalMeasure === "none"
      ? 0
      : goalMeasure === "one"
        ? 1
        : Math.max(0, Number(goalContribution) || 0);

  const openTasks = useMemo(
    () => tasks.filter((task) => !task.deleted_at && task.status !== "completed" && task.status !== "cancelled"),
    [tasks],
  );
  const projectOptions = useMemo(
    () => sortProjectsByName(projects.filter((project) => !project.archived)),
    [projects],
  );

  const canSubmit = linkMode !== "existing" || Boolean(existingTaskId);

  const submit = () => {
    if (!canSubmit) return;
    if (linkMode === "new" && goalMeasure === "custom" && (!Number.isFinite(Number(goalContribution)) || Number(goalContribution) < 0)) {
      useAppStore.getState().setToast("计入目标的单位数需为不小于 0 的数字");
      return;
    }
    onSubmit({
      title,
      minutes,
      linkMode,
      existingTaskId,
      priority,
      projectId,
      tagId,
      goalId,
      goalMeasure: goalId ? goalMeasure : "none",
      goalContribution: measuredContribution,
    });
  };

  return (
    <div className="modal-backdrop floating-backdrop" onMouseDown={onCancel}>
      <form
        className="project-edit-modal floating-card"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="modal-head">
          <div>
            <h3>{timer ? "编辑专注" : "开始专注"}</h3>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel}>×</button>
        </div>

        <label>
          {linkMode === "new" ? "任务名称" : "任务详情"}
          <input
            autoFocus
            value={title}
            placeholder="这段时间要做什么？"
            maxLength={40}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label>
          时长
          <div className="countdown-custom-time is-active">
            <div className="countdown-custom-stepper">
              <button
                type="button"
                className="countdown-custom-step"
                aria-label="减少一分钟"
                onClick={() => setMinutes((m) => Math.max(1, Math.floor(m) - 1))}
              >
                −
              </button>
              <input
                aria-label="专注分钟数"
                type="number"
                min={1}
                max={1440}
                inputMode="numeric"
                value={minutes}
                onChange={(event) => setMinutes(Number(event.target.value) || 1)}
              />
              <span className="countdown-custom-unit">分钟</span>
              <button
                type="button"
                className="countdown-custom-step"
                aria-label="增加一分钟"
                onClick={() => setMinutes((m) => Math.min(1440, Math.floor(m) + 1))}
              >
                ＋
              </button>
            </div>
          </div>
        </label>
        <div className="countdown-mode-switch" role="group" aria-label="时长预设">
          {PRESET_MINUTES.map((preset) => (
            <button
              key={preset}
              type="button"
              className={minutes === preset ? "active" : ""}
              onClick={() => setMinutes(preset)}
            >
              {preset} 分钟
            </button>
          ))}
        </div>

        <div className="focus-link-block">
          <span className="field-label">与任务的关联</span>
          <div className="countdown-mode-switch" role="group" aria-label="与任务的关联">
            {LINK_MODES.map((mode) => (
              <button
                key={mode.value}
                type="button"
                className={linkMode === mode.value ? "active" : ""}
                onClick={() => setLinkMode(mode.value)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        {linkMode === "existing" ? (
          <label>
            关联任务
            {openTasks.length ? (
              <SelectMenu
                ariaLabel="关联任务"
                value={existingTaskId}
                onChange={setExistingTaskId}
                options={[
                  { value: "", label: "选择要完成的任务…" },
                  ...openTasks.map((task) => ({ value: task.id, label: task.title })),
                ]}
              />
            ) : (
              <span className="focus-link-empty">暂无未完成任务，可改用「新建任务」。</span>
            )}
          </label>
        ) : null}

        {linkMode === "new" ? (
          <div className="focus-task-fields">
            <div className="create-task-grid">
              <label>
                优先级
                <SelectMenu
                  ariaLabel="优先级"
                  value={String(priority)}
                  onChange={(value) => setPriority(Number(value) as TaskPriority)}
                  options={[
                    { value: "1", label: "P1 紧急" },
                    { value: "2", label: "P2 高" },
                    { value: "3", label: "P3 普通" },
                    { value: "4", label: "P4 低" },
                  ]}
                />
              </label>
              <label>
                所属项目
                <SelectMenu
                  ariaLabel="所属项目"
                  value={projectId}
                  onChange={(value) => {
                    setProjectId(value);
                    const next = projects.find((project) => project.id === value);
                    setTagId(next?.tag_id ?? "");
                  }}
                  options={[
                    { value: "", label: "无项目" },
                    ...projectOptions.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                />
              </label>
              <label>
                标签
                <SelectMenu
                  ariaLabel="标签"
                  value={tagId}
                  onChange={setTagId}
                  options={[
                    { value: "", label: "无标签" },
                    ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                  ]}
                />
              </label>
              <label>
                目标
                <SelectMenu
                  ariaLabel="目标"
                  value={goalId}
                  onChange={(value) => {
                    setGoalId(value);
                    // 换目标视作新关联：计量默认「不计入」，可显式改（与新建任务同规）。
                    setGoalMeasure("none");
                  }}
                  options={[
                    { value: "", label: "不关联目标" },
                    ...linkableGoals.map((goal) => ({ value: goal.id, label: goal.title })),
                  ]}
                />
              </label>
              {goalId ? (
                <label>
                  目标计量
                  <SelectMenu
                    ariaLabel="目标计量"
                    value={goalMeasure}
                    onChange={(value) => setGoalMeasure(value as "none" | "one" | "custom")}
                    options={canMeasure
                      ? [
                          { value: "none", label: "不计入（只关联）" },
                          { value: "one", label: "算 1 个单位" },
                          { value: "custom", label: "自定义单位数" },
                        ]
                      : [{ value: "none", label: "不计入（只关联）" }]}
                  />
                </label>
              ) : null}
              {goalId && goalMeasure === "custom" ? (
                <label>
                  计入的单位数
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={goalContribution}
                    onChange={(event) => setGoalContribution(event.target.value)}
                  />
                </label>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="project-edit-actions">
          <button type="button" className="btn-ghost item-action-btn" onClick={onCancel}>取消</button>
          <button
            type="submit"
            className="btn-primary item-action-btn item-action-primary"
            disabled={!canSubmit}
          >
            {timer ? "保存" : "开始专注"}
          </button>
        </div>
      </form>
    </div>
  );
}

type FocusCardProps = {
  timer: Timer;
  expanded: boolean;
  onToggle: () => void;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onEdit: () => void;
  onRecord: () => void;
  onRemove: () => void;
};

function FocusCard({ timer, expanded, onToggle, onStart, onPause, onReset, onEdit, onRecord, onRemove }: FocusCardProps) {
  const tasks = useAppStore((s) => s.tasks);
  const remaining = liveRemaining(timer);
  const running = Boolean(timer.running);
  const finished = !running && remaining === 0;
  const progress = Math.min(1, Math.max(0, 1 - remaining / Math.max(1, timer.interval_sec)));
  const window = focusWindow(timer);
  const badge = focusBadge(timer, window);
  // 关联徽标：说清这段专注完成时怎么落账、落到哪件事上。
  let linkNote = "";
  if (timer.task_mode === "existing") {
    const linked = tasks.find((task) => task.id === timer.task_ref_id);
    linkNote = `关联「${linked?.title ?? "任务已删除"}」`;
  } else if (timer.task_mode === "new") {
    linkNote = "完成将新建任务";
  }
  const editBtn = (
    <button
      type="button"
      className="item-action-btn item-action-edit"
      aria-label="编辑这段专注"
      title="编辑"
      onClick={onEdit}
    >
      <AppIcon name="edit" size={14} />
      <span>编辑</span>
    </button>
  );
  const runBtn = running ? (
    <button
      type="button"
      className="item-action-btn"
      aria-label="暂停"
      title="暂停"
      onClick={onPause}
    >
      <AppIcon name="pause" size={14} />
      <span>暂停</span>
    </button>
  ) : (
    <button
      type="button"
      className="item-action-btn"
      aria-label={finished ? "开始" : "继续"}
      title={finished ? "开始" : "继续"}
      onClick={onStart}
    >
      <AppIcon name={finished ? "play" : "review"} size={14} />
      <span>{finished ? "开始" : "继续"}</span>
    </button>
  );
  const resetBtn = !running && !finished ? (
    <button
      type="button"
      className="item-action-btn"
      aria-label="重置"
      title="重置"
      onClick={onReset}
    >
      <AppIcon name="review" size={14} />
      <span>重置</span>
    </button>
  ) : null;
  const recordBtn = (
    <button
      type="button"
      className="item-action-btn item-action-primary"
      aria-label="完成并落账"
      title="完成"
      onClick={onRecord}
    >
      <AppIcon name="check" size={14} />
      <span>完成</span>
    </button>
  );
  const removeBtn = (
    <button
      type="button"
      className="item-action-btn item-action-danger"
      aria-label={finished ? "丢弃这段专注" : "删除这段专注"}
      title={finished ? "丢弃" : "删除"}
      onClick={onRemove}
    >
      <AppIcon name="trash" size={14} />
      <span>{finished ? "丢弃" : "删除"}</span>
    </button>
  );

  // 移动壳（2026-11-01 用户定）：并入「行即卡片」ExpandRow 族（习惯/项目/目标同款），
  // 收起＝标题＋状态＋倒计时读数，动作不再常驻满屏；展开＝进度条＋两行带字动作条
  // （卡底动作条原子：40dp sunken 等分，语义色与全壳一致）。桌面保持长条形态。
  if (isMobileShell()) {
    return (
      <ExpandRow
        open={expanded}
        onToggle={onToggle}
        className={`focus-expand${running ? " is-running" : ""}${finished ? " is-finished" : ""}`}
        rowId={timer.id}
        title={timer.title}
        toggleTitle={expanded ? "收起进度与操作" : "查看进度与操作"}
        meta={
          running ? (
            <>
              <i className="timer-live-dot focus-meta-dot" aria-hidden />
              {badge}
            </>
          ) : (
            badge
          )
        }
        trailing={<span className="focus-countdown">{formatCountdown(remaining)}</span>}
        subline={
          linkNote ? (
            <div className="focus-sub" role="presentation" onClick={onToggle}>
              <p className="focus-subrow">{linkNote}</p>
            </div>
          ) : undefined
        }
      >
        {expanded ? (
          <>
            <div className="timer-progress" aria-hidden>
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            {linkNote ? <p className="focus-subrow">{linkNote}</p> : null}
            <div className="expand-row-foot focus-foot">
              <div className="focus-foot-row">
                {runBtn}
                {recordBtn}
              </div>
              <div className="focus-foot-row">
                {editBtn}
                {resetBtn}
                {removeBtn}
              </div>
            </div>
          </>
        ) : null}
      </ExpandRow>
    );
  }

  const card = (
    <article className={`timer-card ${running ? "is-running" : ""}${finished ? " is-finished" : ""}`}>
      <div className="timer-card-top">
        <div className="timer-card-text">
          <strong>{timer.title}</strong>
          <span className={`timer-badge${running ? " is-running" : ""}${finished ? " is-finished" : ""}`}>
            {running ? <i className="timer-live-dot" aria-hidden /> : null}
            {badge}
          </span>
          {linkNote ? <span className="timer-badge is-link">{linkNote}</span> : null}
        </div>
        <div className="timer-countdown">{formatCountdown(remaining)}</div>
        <div className="timer-actions">
          {editBtn}
          {runBtn}
          {resetBtn}
          {recordBtn}
          {removeBtn}
        </div>
      </div>
      <div className="timer-progress" aria-hidden>
        <span style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </article>
  );
  return card;
}
