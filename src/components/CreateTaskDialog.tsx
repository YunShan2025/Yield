import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import type { Goal, TaskPriority } from "@/types";
import { TimeRangeFields, defaultTimeRange } from "@/components/TimePicker";
import { SelectMenu } from "@/components/SelectMenu";
import { DatePicker } from "@/components/DatePicker";
import { findFirstAvailableTimeSlot } from "@/lib/planning";
import { sortProjectsByName } from "@/lib/projects";
import { fetchGoals } from "@/lib/db";
import {
  ensureEndAfterStart,
  nowTimeString,
  parseTimeToMinutes,
  todayDateString,
} from "@/lib/dates";
import { isMobileShell } from "@/lib/platform";
import { pushBackHandler } from "@/lib/mobileBack";
import { goalAcceptsSource } from "@/lib/growth";

// 新建任务不设预计时长，自动排程按默认 1 小时占位。
const DEFAULT_SLOT_MINUTES = 60;

export function CreateTaskDialog() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const calendarCursor = useAppStore((s) => s.calendarCursor);
  const createTaskInbox = useAppStore((s) => s.createTaskInbox);
  const presetGoalId = useAppStore((s) => s.createTaskGoalId);
  const addTask = useAppStore((s) => s.addTask);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const setToast = useAppStore((s) => s.setToast);
  const close = useAppStore((s) => s.closeCreateTask);
  const selectTask = useAppStore((s) => s.selectTask);
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(calendarCursor)
    ? calendarCursor
    : todayDateString();
  const projectOptions = useMemo(
    () => sortProjectsByName(projects.filter((project) => !project.archived)),
    [projects],
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // 目标条/目标页发起的"安排今日行动"固定以今天为截止日。
  const [dueDate, setDueDate] = useState(
    createTaskInbox ? "" : presetGoalId ? todayDateString() : initialDate,
  );
  // 时间默认给具体值（现在 / +1 小时），避免下拉框显示空占位。
  const [dueTime, setDueTime] = useState(() => defaultTimeRange().start);
  const [endTime, setEndTime] = useState(() => defaultTimeRange().end);
  const [priority, setPriority] = useState<TaskPriority>(3);
  const [projectId, setProjectId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [goalId, setGoalId] = useState(() => {
    // 目标页/今日目标条发起时预关联目标；贡献值仍可在表单里调整。
    return presetGoalId ?? "";
  });
  const [goalMeasure, setGoalMeasure] = useState<"none" | "one" | "custom">("none");
  const [goalContribution, setGoalContribution] = useState("1");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [timeManual, setTimeManual] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const autoKeyRef = useRef(
    createTaskInbox ? "-" : presetGoalId ? todayDateString() : initialDate,
  );
  // 所有进行中的目标都能关联（服务关系）；能不能"完成任务即计量"由目标自己决定。
  const linkableGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );
  const selectedGoal = goalId ? linkableGoals.find((goal) => goal.id === goalId) ?? null : null;
  const canMeasure = selectedGoal ? goalAcceptsSource(selectedGoal, "task") : false;
  const measuredContribution =
    !goalId || goalMeasure === "none"
      ? 0
      : goalMeasure === "one"
        ? 1
        : Math.max(0, Number(goalContribution) || 0);

  useEffect(() => {
    void fetchGoals().then(setGoals);
  }, []);

  const suggestedSlot = useMemo(() => {
    if (!dueDate) return null;
    const today = todayDateString();
    const now = parseTimeToMinutes(nowTimeString(false)) ?? 9 * 60;
    const notBefore = dueDate === today ? Math.max(9 * 60, now) : 9 * 60;
    return findFirstAvailableTimeSlot(tasks, dueDate, DEFAULT_SLOT_MINUTES, notBefore);
  }, [tasks, dueDate]);

  useEffect(() => {
    if (dueDate !== autoKeyRef.current) {
      autoKeyRef.current = dueDate;
      setTimeManual(false);
    }
  }, [dueDate]);

  useEffect(() => {
    if (timeManual || !suggestedSlot) return;
    setDueTime(suggestedSlot.start);
    setEndTime(suggestedSlot.end);
  }, [suggestedSlot, timeManual]);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  // 移动端：系统返回键关闭新建抽屉而非退出应用。
  useEffect(() => {
    if (!isMobileShell()) return;
    return pushBackHandler(() => {
      close();
      return true;
    });
  }, [close]);

  const submit = async () => {
    if (!title.trim() || saving) return;
    if (dueDate && (!dueTime || !endTime)) return;
    if (goalMeasure === "custom" && (!Number.isFinite(Number(goalContribution)) || Number(goalContribution) < 0)) {
      setToast("计入目标的单位数需为不小于 0 的数字");
      return;
    }
    setSaving(true);
    const task = await addTask({
      title: title.trim(),
      description: description.trim(),
      due_date: dueDate || null,
      due_time: dueTime || null,
      end_time: endTime ? ensureEndAfterStart(dueTime, endTime) : null,
      priority,
      project_id: projectId || null,
      goal_id: goalId || null,
      goal_contribution: measuredContribution,
    });
    if (task && selectedTagId) {
      await setTaskTags(task.id, [selectedTagId]);
    }
    setSaving(false);
    if (!task) return;
    close();
    selectTask(task.id);
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <form
        className="create-task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-task-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}
      >
        <div className="modal-head">
          <h3 id="create-task-title">新建任务</h3>
          <button type="button" aria-label="关闭" onClick={close}>×</button>
        </div>
        <label>任务名称<input ref={titleRef} value={title} placeholder="现在要完成什么？" onChange={(event) => setTitle(event.target.value)} /></label>
        <label>任务说明<textarea value={description} placeholder="可选：补充背景或完成标准" onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="create-task-grid">
          <label>优先级<SelectMenu ariaLabel="优先级" value={String(priority)} onChange={(value) => setPriority(Number(value) as TaskPriority)} options={[{ value: "1", label: "P1 紧急" }, { value: "2", label: "P2 高" }, { value: "3", label: "P3 普通" }, { value: "4", label: "P4 低" }]} /></label>

          <label>
            所属项目
            <SelectMenu
              ariaLabel="所属项目"
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                // 选中项目后标签行默认带项目标签，但仍可自行更改。
                const nextProject = projects.find((project) => project.id === value);
                setSelectedTagId(nextProject?.tag_id ?? "");
              }}
              options={[{ value: "", label: "无项目" }, ...projectOptions.map((project) => ({ value: project.id, label: project.name }))]}
            />
          </label>
          <label>标签<SelectMenu ariaLabel="标签" value={selectedTagId} onChange={setSelectedTagId} options={[{ value: "", label: "无标签" }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} /></label>
          <label>
            成长目标
            <SelectMenu
              ariaLabel="成长目标"
              value={goalId}
              onChange={(value) => {
                setGoalId(value);
                setGoalMeasure(value ? (presetGoalId ? "one" : "none") : "none");
              }}
              options={[
                { value: "", label: "不关联目标" },
                ...linkableGoals.map((goal) => ({
                  value: goal.id,
                  label: goal.title,
                })),
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

        <div className="create-task-time-card">
          <div className="create-task-time-head">
            <strong>时间安排</strong>
            {dueDate ? (
              <span className={`create-task-time-state${suggestedSlot ? "" : " warn"}`}>
                {!suggestedSlot
                  ? "当天空闲不足，请手动调整"
                  : timeManual
                    ? "已按你的调整保留"
                    : "已自动避开已有任务"}
              </span>
            ) : null}
          </div>
          {/* 日期与开始/截止时间同一行：三个控件共用 .field-label 标签样式，等高对齐。 */}
          <div className="create-task-schedule">
            <label>
              <span className="field-label">日期</span>
              <DatePicker value={dueDate} onChange={(next) => {
                setDueDate(next);
                if (!next) {
                  const range = defaultTimeRange();
                  setDueTime(range.start);
                  setEndTime(range.end);
                  setTimeManual(false);
                }
              }} allowClear ariaLabel="任务日期" />
            </label>
            <TimeRangeFields
              start={dueTime}
              end={endTime}
              onStartChange={(value) => {
                setTimeManual(true);
                setDueTime(value);
              }}
              onEndChange={(value) => {
                setTimeManual(true);
                setEndTime(value);
              }}
            />
          </div>
        </div>
        <div className="create-task-actions"><button type="button" className="btn-ghost item-action-btn" onClick={close}>取消</button><button type="submit" className="btn-primary item-action-btn item-action-primary" disabled={!title.trim() || (Boolean(dueDate) && (!dueTime || !endTime)) || saving}>{saving ? "新建中…" : "新建任务"}</button></div>
      </form>
    </div>
  );
}
