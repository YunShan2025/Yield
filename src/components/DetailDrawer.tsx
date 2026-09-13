import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { parseRepeatRule, stringifyRepeatRule, describeRepeatRule, weeklyRuleFromDate, monthlyRuleFromDate, nextDateMatchingWeekdays } from "@/lib/repeat";
import { RepeatWeekdayPicker } from "@/components/RepeatWeekdayPicker";
import { SelectMenu } from "@/components/SelectMenu";
import type {
  Attachment,
  RepeatRule,
  TaskPriority,
  TaskStatus,
  Goal,
} from "@/types";
import { open } from "@tauri-apps/plugin-dialog";
import { TimeRangeFields, defaultTimeRange } from "@/components/TimePicker";
import { PomodoroPanel } from "@/components/PomodoroPanel";
import { parseReminderMinutes } from "@/lib/planning";
import { fetchGoals } from "@/lib/db";
import {
  ensureEndAfterStart,
  formatTimeRange,
  nowTimeString,
  todayDateString,
} from "@/lib/dates";

type Mode = "view" | "edit";

const PRIORITY_LABEL: Record<number, string> = {
  1: "P1 紧急",
  2: "P2 高",
  3: "P3 普通",
  4: "P4 低",
};

function repeatLabel(rule: string | null): string {
  return describeRepeatRule(parseRepeatRule(rule));
}

function statusLabel(status: TaskStatus): string {
  return {
    draft: "草稿",
    pending: "待处理",
    in_progress: "进行中",
    waiting: "等待",
    blocked: "阻塞",
    completed: "已完成",
    cancelled: "已取消",
  }[status];
}

export function DetailDrawer() {
  const tasks = useAppStore((s) => s.tasks);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const detailPreferEdit = useAppStore((s) => s.detailPreferEdit);
  const selectTask = useAppStore((s) => s.selectTask);
  const saveTask = useAppStore((s) => s.saveTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const setToast = useAppStore((s) => s.setToast);
  const attachments = useAppStore((s) => s.attachments);
  const loadAttachments = useAppStore((s) => s.loadAttachments);
  const addAttachment = useAppStore((s) => s.addAttachment);
  const removeAttachment = useAppStore((s) => s.removeAttachment);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const setFocusTask = useAppStore((s) => s.setFocusTask);
  const focusTaskId = useAppStore((s) => s.focusTaskId);
  const focusRunning = useAppStore((s) => s.focusRunning);
  const toggleFocus = useAppStore((s) => s.toggleFocus);
  const projects = useAppStore((s) => s.projects);

  const task = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(3);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [remind, setRemind] = useState("");
  const [estimatedMinutes, setEstimatedMinutes] = useState("");
  const [status, setStatus] = useState<TaskStatus>("pending");
  const [completionCriteria, setCompletionCriteria] = useState("");
  const [energyLevel, setEnergyLevel] =
    useState<"low" | "medium" | "high">("medium");
  const [flexible, setFlexible] = useState(true);
  const [scheduleLocked, setScheduleLocked] = useState(false);
  const [blockedById, setBlockedById] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const linkedGoal = task?.goal_id
    ? goals.find((goal) => goal.id === task.goal_id) ?? null
    : null;
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    void fetchGoals().then(setGoals);
  }, []);

  useEffect(() => {
    if (!task) {
      loadedId.current = null;
      setMode("view");
      return;
    }
    if (loadedId.current === task.id) return;
    loadedId.current = task.id;
    setDirty(false);
    setMode(detailPreferEdit ? "edit" : "view");
    hydrateFromTask();
    void loadAttachments(task.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, detailPreferEdit]);

  const hydrateFromTask = () => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setNotes(task.notes);
    setPriority(task.priority);
    const range = defaultTimeRange();
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? range.start);
    setEndTime(
      task.end_time ??
        ensureEndAfterStart(task.due_time ?? range.start, null),
    );
    setRemind(task.reminder_minutes.join(", "));
    setEstimatedMinutes(
      task.estimated_minutes != null ? String(task.estimated_minutes) : "",
    );
    setStatus(task.status);
    setCompletionCriteria(task.completion_criteria);
    setEnergyLevel(task.energy_level);
    setFlexible(Boolean(task.flexible));
    setScheduleLocked(Boolean(task.schedule_locked));
    setBlockedById(task.blocked_by_id ?? "");
    setRepeat(parseRepeatRule(task.repeat_rule));
  };

  const enterEdit = () => {
    hydrateFromTask();
    setDirty(false);
    setMode("edit");
  };

  const cancelEdit = () => {
    if (dirty && !window.confirm("当前修改尚未保存，确定放弃吗？")) return;
    hydrateFromTask();
    setDirty(false);
    setMode("view");
  };

  const closeDetail = () => {
    if (
      mode === "edit" &&
      dirty &&
      !window.confirm("当前修改尚未保存，确定关闭吗？")
    ) {
      return;
    }
    selectTask(null);
  };

  // 点击抽屉以外的任意区域(主区、侧栏、标题栏)收起抽屉,沿用 closeDetail 的未保存确认。
  // 应用级浮层(确认弹窗遮罩、任务行菜单)承载自己的交互,不算"点了外面"。
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    closeRef.current = closeDetail;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".detail-panel")) return;
      if (event.target.closest(".modal-backdrop, .row-menu, .row-menu-backdrop")) {
        return;
      }
      closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (mode !== "edit" || !dirty) return;
    const preventClose = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, [mode, dirty]);

  const persist = async () => {
    if (!task || saving) return false;
    const nextTitle = title.trim() || "新任务";
    const start = dueTime || nowTimeString();
    const end = ensureEndAfterStart(start, endTime);
    setSaving(true);
    try {
      await saveTask(task.id, {
        title: nextTitle,
        description,
        notes,
        priority,
        due_date: dueDate || null,
        due_time: start,
        end_time: end,
        reminder_minutes: remind ? parseReminderMinutes(remind) : [],
        estimated_minutes: estimatedMinutes
          ? Math.max(1, Number(estimatedMinutes))
          : null,
        status,
        completion_criteria: completionCriteria,
        energy_level: energyLevel,
        flexible: flexible ? 1 : 0,
        schedule_locked: scheduleLocked ? 1 : 0,
        blocked_by_id: blockedById || null,
        repeat_rule: stringifyRepeatRule(repeat),
      });
      setToast("已保存");
      setDirty(false);
      setMode("view");
      return true;
    } catch {
      setToast("保存失败");
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!task) return null;

  const selectedTags = tagMap[task.id] ?? [];
  const project = task.project_id
    ? projects.find((item) => item.id === task.project_id) ?? null
    : null;
  const blockedBy = task.blocked_by_id
    ? tasks.find((item) => item.id === task.blocked_by_id) ?? null
    : null;
  const timeText = formatTimeRange(task.due_time, task.end_time);
  const estimateSamples = tasks.filter(
    (candidate) =>
      candidate.id !== task.id &&
      candidate.status === "completed" &&
      candidate.actual_minutes > 0 &&
      (task.project_id
        ? candidate.project_id === task.project_id
        : candidate.priority === task.priority),
  );
  const suggestedEstimate = estimateSamples.length
    ? Math.round(
        estimateSamples.reduce(
          (sum, candidate) => sum + candidate.actual_minutes,
          0,
        ) / estimateSamples.length,
      )
    : null;

  const pickFile = async () => {
    const selected = await open({ multiple: false });
    if (!selected || Array.isArray(selected)) return;
    const name = selected.split(/[/\\]/).pop() ?? selected;
    await addAttachment(task.id, { kind: "file", name, path: selected });
  };

  const confirmDelete = () => {
    if (!window.confirm(`确定将「${task.title}」移入回收站吗？`)) return;
    void deleteTask(task.id);
  };

  const startFocus = () => {
    if (focusRunning && focusTaskId !== task.id) {
      setToast("请先暂停当前专注");
      return;
    }
    setFocusTask(task.id);
    if (task.status !== "in_progress") {
      void saveTask(task.id, { status: "in_progress" });
    }
    if (!focusRunning) void toggleFocus();
  };

  return (
    <aside className="detail-panel">
      <div className="panel-head">
        <h3>{mode === "view" ? "任务详情" : "编辑任务"}</h3>
        <div className="detail-head-actions">
          {mode === "view" ? (
            <button type="button" className="btn-ghost" onClick={enterEdit}>
              编辑
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={closeDetail}
          >
            ✕
          </button>
        </div>
      </div>

      {mode === "view" ? (
        <div className="detail-body detail-view">
          <div className="detail-view-hero">
            <button
              type="button"
              className={`task-check ${task.status === "completed" ? "is-done" : ""}`}
              title={task.status === "completed" ? "标为未完成" : "标为完成"}
              onClick={() => void toggleComplete(task.id)}
            >
              {task.status === "completed" ? "✓" : ""}
            </button>
            <h2 className="detail-view-title">{task.title}</h2>
          </div>

          {task.description ? (
            <p className="detail-view-desc">{task.description}</p>
          ) : null}

          <div className="detail-meta-grid">
            <div className="detail-meta">
              <span className="field-label">日期</span>
              <strong>{task.due_date ?? "未设置"}</strong>
            </div>
            <div className="detail-meta">
              <span className="field-label">时间</span>
              <strong>{timeText || "未设置"}</strong>
            </div>
            <div className="detail-meta">
              <span className="field-label">优先级</span>
              <strong className={`prio p${task.priority}`}>
                {PRIORITY_LABEL[task.priority] ?? `P${task.priority}`}
              </strong>
            </div>
            <div className="detail-meta">
              <span className="field-label">当前状态</span>
              <strong>{statusLabel(task.status)}</strong>
            </div>
            <div className="detail-meta">
              <span className="field-label">所属项目</span>
              <strong>{project ? project.name : "无项目"}</strong>
            </div>
            <div className="detail-meta">
              <span className="field-label">关联成长目标</span>
              <strong>
                {linkedGoal
                  ? `${linkedGoal.title} · ${
                      linkedGoal.goal_type === "time"
                        ? "专注时长计入"
                        : `贡献 ${task.goal_contribution}`
                    }`
                  : "不关联目标"}
              </strong>
            </div>
          </div>

          {selectedTags.length ? (
            <div className="detail-view-tags">
              <span className="field-label">标签</span>
              <div className="tag-pills">
                {selectedTags.map((id) => {
                  const tag = tags.find((item) => item.id === id);
                  return tag ? (
                    <span key={id} className="tag-pill on">
                      {tag.name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          ) : null}

          <details className="detail-section">
            <summary>计划信息</summary>
            <div className="detail-section-body">
              <div className="detail-meta-grid">
                <div className="detail-meta">
                  <span className="field-label">提醒</span>
                  <strong>
                    {task.reminder_minutes.length
                      ? task.reminder_minutes.map((m) => `提前 ${m} 分钟`).join("、")
                      : "无"}
                  </strong>
                </div>
                <div className="detail-meta">
                  <span className="field-label">预计 / 实际</span>
                  <strong>
                    {task.estimated_minutes ?? "—"} / {task.actual_minutes} 分钟
                  </strong>
                </div>
                <div className="detail-meta">
                  <span className="field-label">精力</span>
                  <strong>
                    {task.energy_level === "high" ? "高" : task.energy_level === "low" ? "低" : "中"}
                  </strong>
                </div>
                <div className="detail-meta">
                  <span className="field-label">排程</span>
                  <strong>
                    {task.flexible ? "可灵活排程" : "固定时间"}
                    {task.schedule_locked ? " · 已锁定" : ""}
                  </strong>
                </div>
                <div className="detail-meta">
                  <span className="field-label">重复</span>
                  <strong>{repeatLabel(task.repeat_rule)}</strong>
                </div>
                <div className="detail-meta">
                  <span className="field-label">前置任务</span>
                  <strong>{blockedBy ? blockedBy.title : "无"}</strong>
                </div>
              </div>
              {task.completion_criteria ? (
                <div>
                  <span className="field-label">完成标准</span>
                  <p className="detail-view-notes">{task.completion_criteria}</p>
                </div>
              ) : null}
              {task.notes ? (
                <div>
                  <span className="field-label">备注</span>
                  <p className="detail-view-notes">{task.notes}</p>
                </div>
              ) : null}
            </div>
          </details>

          {attachments.length ? (
            <div>
              <span className="field-label">附件</span>
              <div className="subtask-list">
                {attachments.map((a: Attachment) => (
                  <div key={a.id} className="subtask-item">
                    <span style={{ flex: 1, fontSize: 12 }}>
                      {a.kind}: {a.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <PomodoroPanel compact boundTaskId={task.id} />
        </div>
      ) : (
        <div
          className="detail-body"
          onChangeCapture={() => setDirty(true)}
        >
          <div>
            <label className="field-label">标题</label>
            <input
              className="field"
              value={title}
              autoFocus={mode === "edit"}
              onFocus={(e) => {
                if (title === "新任务") e.currentTarget.select();
              }}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">描述</label>
            <textarea
              className="field"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="field-label">截止日期</label>
            <input
              className="field"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <TimeRangeFields
            start={dueTime}
            end={endTime}
            onStartChange={setDueTime}
            onEndChange={setEndTime}
          />
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <div>
              <label className="field-label">优先级</label>
              <SelectMenu
                className="field"
                ariaLabel="优先级"
                value={String(priority)}
                onChange={(value) => setPriority(Number(value) as TaskPriority)}
                options={[
                  { value: "1", label: "P1" },
                  { value: "2", label: "P2" },
                  { value: "3", label: "P3" },
                  { value: "4", label: "P4" },
                ]}
              />
            </div>
            <div>
              <label className="field-label">提前提醒（可填多个）</label>
              <input
                className="field"
                value={remind}
                onChange={(e) => setRemind(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="field-label">预计耗时（分钟）</label>
            <input
              className="field"
              type="number"
              min={1}
              value={estimatedMinutes}
              onChange={(e) => setEstimatedMinutes(e.target.value)}
              />
            <div className="estimate-presets">
              {[15, 30, 45, 60, 90].map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className="btn-ghost"
                  onClick={() => setEstimatedMinutes(String(minutes))}
                >
                  {minutes} 分
                </button>
              ))}
              {suggestedEstimate ? (
                <button
                  type="button"
                  className="btn-ghost estimate-suggestion"
                  onClick={() =>
                    setEstimatedMinutes(String(suggestedEstimate))
                  }
                >
                  根据历史建议 {suggestedEstimate} 分
                </button>
              ) : null}
            </div>
          </div>
          <div>
            <label className="field-label">所属项目</label>
            <SelectMenu
              className="field"
              ariaLabel="所属项目"
              value={task.project_id ?? ""}
              onChange={(value) =>
                void saveTask(task.id, {
                  project_id: value || null,
                })
              }
              options={[{ value: "", label: "无项目" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]}
            />
          </div>
          <div className="lifecycle-grid">
            <div>
              <label className="field-label">关联成长目标</label>
              <SelectMenu
                className="field"
                ariaLabel="关联成长目标"
                value={task.goal_id ?? ""}
                onChange={(value) =>
                  void saveTask(task.id, { goal_id: value || null })
                }
                options={[{ value: "", label: "不关联目标" }, ...goals.filter((goal) =>
                  goal.status === "active" &&
                  ["quantity", "frequency", "time"].includes(goal.goal_type)
                ).map((goal) => ({ value: goal.id, label: goal.title }))]}
              />
            </div>
            <div>
              <label className="field-label">
                {linkedGoal?.goal_type === "time" ? "计入方式" : "完成贡献值"}
              </label>
              <input
                className="field"
                type="number"
                disabled={linkedGoal?.goal_type === "time"}
                min={0.1}
                step={0.1}
                value={task.goal_contribution}
                onChange={(event) =>
                  void saveTask(task.id, {
                    goal_contribution: Math.max(0.1, Number(event.target.value) || 1),
                  })
                }
              />
              {linkedGoal?.goal_type === "time" ? (
                <small className="field-hint">按专注会话分钟自动计入，完成任务不会重复增加。</small>
              ) : null}
            </div>
          </div>
          <div className="lifecycle-grid">
            <div>
              <label className="field-label">任务状态</label>
              <SelectMenu
                className="field"
                ariaLabel="任务状态"
                value={status}
                onChange={(value) => setStatus(value as TaskStatus)}
                options={[
                  { value: "draft", label: "草稿" },
                  { value: "pending", label: "待处理" },
                  { value: "in_progress", label: "进行中" },
                  { value: "waiting", label: "等待" },
                  { value: "blocked", label: "阻塞" },
                  { value: "completed", label: "完成" },
                  { value: "cancelled", label: "取消" },
                ]}
              />
            </div>
            <div>
              <label className="field-label">精力要求</label>
              <SelectMenu
                className="field"
                ariaLabel="精力要求"
                value={energyLevel}
                onChange={(value) => setEnergyLevel(value as "low" | "medium" | "high")}
                options={[
                  { value: "low", label: "低" },
                  { value: "medium", label: "中" },
                  { value: "high", label: "高" },
                ]}
              />
            </div>
          </div>
          <div>
            <label className="field-label">完成标准</label>
            <textarea
              className="field"
              rows={2}
              value={completionCriteria}
              onChange={(event) => setCompletionCriteria(event.target.value)}
            />
          </div>
          <div>
            <label className="field-label">前置任务</label>
            <SelectMenu
              className="field"
              ariaLabel="前置任务"
              value={blockedById}
              onChange={setBlockedById}
              options={[{ value: "", label: "无" }, ...tasks
                .filter(
                  (candidate) =>
                    candidate.id !== task.id &&
                    !candidate.parent_id &&
                    candidate.status !== "completed",
                )
                .map((candidate) => ({ value: candidate.id, label: candidate.title }))]}
            />
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={flexible}
              onChange={(event) => setFlexible(event.target.checked)}
            />
            可由智能排程调整时间
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={scheduleLocked}
              onChange={(event) => setScheduleLocked(event.target.checked)}
            />
            锁定当前排程（重启后仍保留）
          </label>
          <div>
            <label className="field-label">重复</label>
            <SelectMenu
              className="field"
              ariaLabel="重复"
              value={repeat?.frequency ?? ""}
              onChange={(value) => {
                if (!value) setRepeat(null);
                else if (value === "custom")
                  setRepeat({
                    frequency: "custom",
                    interval: 1,
                    nthWeekday: { n: -1, weekday: 5 },
                  });
                else if (value === "weekly")
                  setRepeat(weeklyRuleFromDate(dueDate || todayDateString()));
                else if (value === "monthly")
                  setRepeat(monthlyRuleFromDate(dueDate || todayDateString()));
                else
                  setRepeat({
                    frequency: value as RepeatRule["frequency"],
                    interval: 1,
                  });
              }}
              options={[
                { value: "", label: "不重复" },
                { value: "daily", label: "每天" },
                { value: "weekly", label: "每周" },
                { value: "monthly", label: "每月" },
                { value: "custom", label: "每月最后周五" },
              ]}
            />
            {repeat?.frequency === "weekly" ? (
              <div className="create-task-weekdays" style={{ marginTop: 8 }}>
                <RepeatWeekdayPicker
                  weekdays={
                    repeat.weekdays ??
                    weeklyRuleFromDate(dueDate || todayDateString()).weekdays!
                  }
                  onChange={(weekdays) => {
                    setRepeat({ ...repeat, weekdays });
                    if (dueDate) {
                      setDueDate(nextDateMatchingWeekdays(dueDate, weekdays));
                    }
                  }}
                />
              </div>
            ) : null}
          </div>
          <div>
            <label className="field-label">备注</label>
            <textarea
              className="field"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div>
            <label className="field-label">标签</label>
            {tags.length ? (
              <div className="tag-pills">
                {tags.map((tag) => {
                  const on = selectedTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      className={`tag-pill ${on ? "on" : ""}`}
                      onClick={() => {
                        const next = on
                          ? selectedTags.filter((id) => id !== tag.id)
                          : [...selectedTags, tag.id];
                        void setTaskTags(task.id, next);
                      }}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="field-hint">
                暂无标签，可在左侧栏「更多 → 标签」中新建
              </span>
            )}
          </div>

          <div>
            <label className="field-label">附件</label>
            <div
              className={`drop-zone ${dragOver ? "active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                const uri = e.dataTransfer.getData("text/uri-list");
                if (uri?.startsWith("http")) {
                  void addAttachment(task.id, {
                    kind: "url",
                    name: uri,
                    path: uri,
                  });
                  return;
                }
                if (file) {
                  void addAttachment(task.id, {
                    kind: "file",
                    name: file.name,
                    path: (file as File & { path?: string }).path || file.name,
                  });
                }
              }}
            >
              拖拽文件/链接到此处，或
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void pickFile()}
              >
                选择文件
              </button>
            </div>
            {attachments.map((a: Attachment) => (
              <div key={a.id} className="subtask-item">
                <span style={{ flex: 1, fontSize: 12 }}>
                  {a.kind}: {a.name}
                </span>
                <button
                  type="button"
                  className="btn-ghost danger"
                  onClick={() => void removeAttachment(a.id)}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-footer">
        {mode === "edit" ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={saving}
              onClick={() => void persist()}
            >
              {saving ? "保存中…" : "保存"}
            </button>
            <button type="button" className="btn-ghost" onClick={cancelEdit}>
              取消
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary" onClick={startFocus}>
              {focusRunning && focusTaskId === task.id ? "专注中" : "开始专注"}
            </button>
            {task.status !== "completed" ? (
              <button
                type="button"
                className="btn-ghost detail-complete-action"
                onClick={() => void toggleComplete(task.id)}
              >
                完成
              </button>
            ) : null}
            <button type="button" className="btn-ghost" onClick={enterEdit}>
              编辑
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-ghost danger"
          onClick={confirmDelete}
        >
          删除任务
        </button>
      </div>
    </aside>
  );
}
