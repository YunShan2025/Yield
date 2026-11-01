import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import type { Goal, TaskPriority } from "@/types";
import { TimeRangeFields } from "@/components/TimePicker";
import { SelectMenu } from "@/components/SelectMenu";
import { DatePicker } from "@/components/DatePicker";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { sortProjectsByName } from "@/lib/projects";
import { fetchGoals } from "@/lib/db";
import { ensureEndAfterStart } from "@/lib/dates";
import { isMobileShell } from "@/lib/platform";
import { useFloatingDismiss } from "@/lib/floatingDialog";
import { pushBackHandler } from "@/lib/mobileBack";
import { confirmAction } from "@/components/AppConfirm";
import { goalAcceptsSource } from "@/lib/growth";

/**
 * 「编辑任务」二级弹窗：点任务行（原详情抽屉入口）打开。样式与内容沿用
 * 「新建任务」弹窗（create-task-modal 同族），值从任务预填；详情抽屉已移除。
 * 完成留在行上；删除自移动长按面板移入本弹窗（2026-11-01 用户定：删掉长按面板，
 * 点按弹出的 取消 / 保存 之间加「删除」）。
 */
export function EditTaskDialog() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const saveTask = useAppStore((s) => s.saveTask);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const setToast = useAppStore((s) => s.setToast);
  const selectTask = useAppStore((s) => s.selectTask);
  const deleteTask = useAppStore((s) => s.deleteTask);

  const task = tasks.find((item) => item.id === selectedTaskId) ?? null;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(3);
  const [projectId, setProjectId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [goalId, setGoalId] = useState("");
  const [goalMeasure, setGoalMeasure] = useState<"none" | "one" | "custom">("none");
  const [goalContribution, setGoalContribution] = useState("1");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const projectOptions = useMemo(
    () => sortProjectsByName(projects.filter((project) => !project.archived)),
    [projects],
  );
  const linkableGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );

  useEffect(() => {
    void fetchGoals().then(setGoals);
  }, []);

  // 换任务（含首次打开）时整体预填一次；表单里的手改动不被覆盖。
  const loadedId = useRef<string | null>(null);
  useEffect(() => {
    if (!task) {
      loadedId.current = null;
      return;
    }
    if (loadedId.current === task.id) return;
    loadedId.current = task.id;
    setTitle(task.title);
    setDescription(task.description);
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? "");
    setEndTime(task.end_time ?? "");
    setPriority(task.priority);
    setProjectId(task.project_id ?? "");
    setSelectedTagId(tagMap[task.id]?.[0] ?? "");
    setGoalId(task.goal_id ?? "");
    setGoalContribution(String(task.goal_contribution || 0));
    setGoalMeasure(
      task.goal_contribution > 0
        ? task.goal_contribution === 1
          ? "one"
          : "custom"
        : "none",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const close = () => selectTask(null);

  useEffect(() => {
    titleRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 移动端：系统返回键关本弹窗而非退出应用。
  useEffect(() => {
    if (!isMobileShell()) return;
    return pushBackHandler(() => {
      close();
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 桌面悬浮卡：无遮罩、背景全亮可交互，点卡片以外任意处收起（同「新建任务」/「记一笔」）。
  useFloatingDismiss(Boolean(task), close);

  if (!task) return null;

  const selectedGoal = goals.find((goal) => goal.id === goalId) ?? null;
  const canMeasure = selectedGoal ? goalAcceptsSource(selectedGoal, "task") : false;
  const measuredContribution =
    !goalId || goalMeasure === "none"
      ? 0
      : goalMeasure === "one"
        ? 1
        : Math.max(0, Number(goalContribution) || 0);
  const goalOptions = [
    { value: "", label: "不关联目标" },
    ...linkableGoals.map((goal) => ({ value: goal.id, label: goal.title })),
    ...(selectedGoal && !linkableGoals.some((goal) => goal.id === selectedGoal.id)
      ? [{ value: selectedGoal.id, label: `${selectedGoal.title}（已归档/不适用）` }]
      : []),
  ];

  const submit = async () => {
    if (!title.trim() || saving) return;
    if (goalMeasure === "custom" && (!Number.isFinite(Number(goalContribution)) || Number(goalContribution) < 0)) {
      setToast("计入目标的单位数需为不小于 0 的数字");
      return;
    }
    setSaving(true);
    try {
      await saveTask(task.id, {
        title: title.trim(),
        description,
        priority,
        due_date: dueDate || null,
        due_time: dueTime || null,
        end_time: dueTime ? ensureEndAfterStart(dueTime, endTime || null) : null,
        // 备注不在表单里，透传现有值避免保存时被清掉。
        notes: task.notes,
        status: task.status,
        project_id: projectId || null,
        goal_id: goalId || null,
        goal_contribution: goalId ? measuredContribution : 0,
      });
      await setTaskTags(task.id, selectedTagId ? [selectedTagId] : []);
      setToast("已保存");
      close();
    } catch {
      setToast("保存失败");
    } finally {
      setSaving(false);
    }
  };

  // 删除入口自长按面板移来此处（点按进本弹窗即可删）：先收起悬浮卡（避免确认框
  // 在外、背景点击把弹窗连同本处一起收掉），二次确认后软删（deleteTask 自带
  // 「已移入回收站」toast、清选中与撤销）。
  const onDelete = async () => {
    close();
    const ok = await confirmAction({
      title: "移入回收站？",
      description: `将把「${task.title}」移入回收站。`,
      confirmText: "删除",
      danger: true,
    });
    if (ok) await deleteTask(task.id);
  };

  return (
    <div className="modal-backdrop floating-backdrop" onMouseDown={close}>
      <form
        className="create-task-modal floating-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-task-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="modal-head">
          <h3 id="edit-task-title">编辑任务</h3>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={close}>×</button>
        </div>
        <div className="create-task-body">
        <label>任务名称<input ref={titleRef} value={title} placeholder="现在要完成什么？" onChange={(event) => setTitle(event.target.value)} /></label>
        <label>任务说明<AutoGrowTextarea value={description} placeholder="可选：补充背景或完成标准" onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="create-task-grid">
          <label>优先级<SelectMenu ariaLabel="优先级" value={String(priority)} onChange={(value) => setPriority(Number(value) as TaskPriority)} options={[{ value: "1", label: "P1 紧急" }, { value: "2", label: "P2 高" }, { value: "3", label: "P3 普通" }, { value: "4", label: "P4 低" }]} /></label>

          <label>
            所属项目
            <SelectMenu
              ariaLabel="所属项目"
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                // 与新建一致：改项目时标签跟随项目标签，仍可再手改。
                const nextProject = projects.find((project) => project.id === value);
                setSelectedTagId(nextProject?.tag_id ?? "");
              }}
              options={[{ value: "", label: "无项目" }, ...projectOptions.map((project) => ({ value: project.id, label: project.name }))]}
            />
          </label>
          <label>标签<SelectMenu ariaLabel="标签" value={selectedTagId} onChange={setSelectedTagId} options={[{ value: "", label: "无标签" }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} /></label>
          <label>
            目标
            <SelectMenu
              ariaLabel="关联目标"
              value={goalId}
              onChange={(value) => {
                setGoalId(value);
                // 取消关联时计量归零；换目标保留既有计量口径（不擅自改用户设定）。
                if (!value) setGoalMeasure("none");
              }}
              options={goalOptions}
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
          </div>
          <div className="create-task-schedule">
            <label>
              <span className="field-label">日期</span>
              <DatePicker value={dueDate} onChange={setDueDate} allowClear ariaLabel="任务日期" />
            </label>
            <TimeRangeFields
              start={dueTime}
              end={endTime}
              onStartChange={setDueTime}
              onEndChange={setEndTime}
            />
          </div>
        </div>
        </div>
        <div className="create-task-actions">
          <button type="button" className="btn-ghost item-action-btn" onClick={close}>取消</button>
          <button type="submit" className="btn-primary item-action-btn item-action-primary" disabled={!title.trim() || saving}>{saving ? "保存中…" : "保存"}</button>
          <button type="button" className="item-action-btn item-action-danger edit-task-delete" onClick={() => void onDelete()}>删除</button>
        </div>
      </form>
    </div>
  );
}
