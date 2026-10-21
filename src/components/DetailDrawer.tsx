import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { SelectMenu } from "@/components/SelectMenu";
import type { Goal, TaskPriority } from "@/types";
import { TimeRangeFields, defaultTimeRange } from "@/components/TimePicker";
import { confirmAction } from "@/components/AppConfirm";
import { DatePicker } from "@/components/DatePicker";
import { isMobileShell } from "@/lib/platform";
import { attachSwipeRightToClose, pushBackHandler } from "@/lib/mobileBack";
import { fetchGoals } from "@/lib/db";
import {
  ensureEndAfterStart,
  formatTimeRange,
  nowTimeString,
} from "@/lib/dates";

type Mode = "view" | "edit";

const PRIORITY_LABEL: Record<number, string> = {
  1: "P1 紧急",
  2: "P2 高",
  3: "P3 普通",
  4: "P4 低",
};



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

  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const projects = useAppStore((s) => s.projects);

  const task = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(3);
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [goalId, setGoalId] = useState("");
  const [goalMeasure, setGoalMeasure] = useState<"none" | "one" | "custom">("none");
  const [goalContribution, setGoalContribution] = useState("1");  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const loadedId = useRef<string | null>(null);

  useEffect(() => {
    void fetchGoals(true).then(setGoals);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, detailPreferEdit]);

  const hydrateFromTask = () => {
    if (!task) return;
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    const range = defaultTimeRange();
    setDueDate(task.due_date ?? "");
    setDueTime(task.due_time ?? range.start);
    setEndTime(
      task.end_time ??
        ensureEndAfterStart(task.due_time ?? range.start, null),
    );
    setGoalId(task.goal_id ?? "");
    setGoalContribution(String(task.goal_contribution || 0));
    setGoalMeasure(
      task.goal_contribution > 0
        ? task.goal_contribution === 1
          ? "one"
          : "custom"
        : "none",
    );
  };

  const enterEdit = () => {
    hydrateFromTask();
    setDirty(false);
    setMode("edit");
  };

  const cancelEdit = () => {
    if (!dirty) {
      hydrateFromTask();
      setDirty(false);
      setMode("view");
      return;
    }
    void confirmAction({
      title: "当前修改尚未保存，确定放弃吗？",
      danger: true,
      confirmText: "放弃修改",
    }).then((ok) => {
      if (!ok) return;
      hydrateFromTask();
      setDirty(false);
      setMode("view");
    });
  };

  const closeDetail = () => {
    if (mode === "edit" && dirty) {
      void confirmAction({
        title: "当前修改尚未保存，确定关闭吗？",
        danger: true,
        confirmText: "不保存关闭",
      }).then((ok) => {
        if (ok) selectTask(null);
      });
      return;
    }
    selectTask(null);
  };

  // 点击抽屉以外的任意区域(主区、侧栏、标题栏)收起抽屉,沿用 closeDetail 的未保存确认。
  // 应用级浮层(确认弹窗遮罩、任务行菜单、SelectMenu/DatePicker/TimePicker 的 portal
  // 弹层)承载自己的交互,不算"点了外面"——否则点选下拉选项或日历选日期会连带收起
  // 整个抽屉、选择丢失。
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    closeRef.current = closeDetail;
  });
  const panelRef = useRef<HTMLElement>(null);
  // 移动端:系统返回键与抽屉内右滑手势都走「关闭抽屉」,
  // 未保存时的确认流程由 closeDetail 统一处理。
  useEffect(() => {
    if (!isMobileShell()) return;
    const unregister = pushBackHandler(() => {
      closeRef.current();
      return true;
    });
    return unregister;
  }, []);
  useEffect(() => {
    if (!isMobileShell() || !panelRef?.current) return;
    return attachSwipeRightToClose(panelRef.current, () => closeRef.current());
  }, []);
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".detail-panel")) return;
      if (
        event.target.closest(
          ".modal-backdrop, .select-menu, .date-picker-pop",
        )
      ) {
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
    const contribution = Number(goalContribution);
    if (goalMeasure === "custom" && (!Number.isFinite(contribution) || contribution < 0)) {
      setToast("计入目标的单位数需为不小于 0 的数字");
      return false;
    }
    setSaving(true);
    try {
      await saveTask(task.id, {
        title: nextTitle,
        description,
        priority,
        due_date: dueDate || null,
        due_time: start,
        end_time: end,
        // 备注已从编辑表单移除，透传现有值避免保存时被清掉。
        notes: task.notes,
        status: task.status,
        goal_id: goalId || null,
        goal_contribution: goalId ? measuredContribution : 0,
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
  const timeText = formatTimeRange(task.due_time, task.end_time);
  const goal = task.goal_id
    ? goals.find((item) => item.id === task.goal_id) ?? null
    : null;
  const linkableGoals = goals.filter((item) => item.status === "active");
  const measuredContribution =
    !goalId || goalMeasure === "none"
      ? 0
      : goalMeasure === "one"
        ? 1
        : Math.max(0, Number(goalContribution) || 0);
  const goalOptions = [
    { value: "", label: "不关联目标" },
    ...linkableGoals.map((item) => ({ value: item.id, label: item.title })),
    ...(goal && !linkableGoals.some((item) => item.id === goal.id)
      ? [{ value: goal.id, label: `${goal.title}（已归档/不适用）` }]
      : []),
  ];


  const confirmDelete = () => {
    void confirmAction({
      title: `确定将「${task.title}」移入回收站吗？`,
      description: "回收站中的任务可随时恢复。",
      confirmText: "移入回收站",
      danger: true,
    }).then((ok) => {
      if (ok) void deleteTask(task.id);
    });
  };

  return (
    <aside ref={panelRef} className="detail-panel">
      <div className="panel-head">
        <h3>{mode === "view" ? "任务详情" : "编辑任务"}</h3>
        <div className="detail-head-actions">
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
              <span className="field-label">所属项目</span>
              <strong>{project ? project.name : "无项目"}</strong>
            </div>
            <div className="detail-meta">
              <span className="field-label">成长目标</span>
              <strong>{goal ? goal.title : "未关联"}</strong>
            </div>
            {goal ? (
              <div className="detail-meta">
                <span className="field-label">目标计量</span>
                <strong>
                  {task.goal_contribution > 0
                    ? `完成时计入 ${Math.round(task.goal_contribution * 100) / 100}${goal.unit}`
                    : "只关联，不计入"}
                </strong>
              </div>
            ) : null}
            <div className="detail-meta">
              <span className="field-label">标签</span>
              <strong>
                {selectedTags.length
                  ? selectedTags
                      .map((id) => tags.find((item) => item.id === id)?.name)
                      .filter(Boolean)
                      .join("、") || "无标签"
                  : "无标签"}
              </strong>
            </div>
          </div>


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
            <label className="field-label">日期</label>
            <DatePicker
              value={dueDate}
              onChange={setDueDate}
              allowClear
              ariaLabel="日期"
            />
          </div>
          <TimeRangeFields
            start={dueTime}
            end={endTime}
            onStartChange={setDueTime}
            onEndChange={setEndTime}
          />
          <div className="detail-form-row">
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
              <label className="field-label">所属项目</label>
              <SelectMenu
                className="field"
                ariaLabel="所属项目"
                value={task.project_id ?? ""}
                onChange={(value) => {
                  void saveTask(task.id, {
                    project_id: value || null,
                  });
                  // 选中项目后标签默认跟随项目自带的标签；之后仍可在标签行单独修改。
                  const nextProject = projects.find((item) => item.id === value);
                  void setTaskTags(
                    task.id,
                    nextProject?.tag_id ? [nextProject.tag_id] : [],
                  );
                }}
                options={[{ value: "", label: "无项目" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]}
              />
            </div>
          </div>
          <div className="detail-form-row">
            <div>
              <label className="field-label">标签</label>
              <SelectMenu
                ariaLabel="标签"
                className="field"
                value={selectedTags[0] ?? ""}
                onChange={(tagId) =>
                  void setTaskTags(task.id, tagId ? [tagId] : [])
                }
                options={[
                  { value: "", label: "无标签" },
                  ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                ]}
              />
            </div>
            <div>
              <label className="field-label">成长目标</label>
              <SelectMenu
                className="field"
                ariaLabel="成长目标"
                value={goalId}
                onChange={(value) => {
                  setGoalId(value);
                  setDirty(true);
                  setGoalMeasure(
                    value ? (task.goal_contribution > 0 ? "one" : "none") : "none",
                  );
                }}
                options={goalOptions}
              />
            </div>
          </div>

          {goalId ? (
            <div className="detail-form-row">
              <div>
                <label className="field-label">目标计量</label>
                <SelectMenu
                  className="field"
                  ariaLabel="目标计量"
                  value={goalMeasure}
                  onChange={(value) => {
                    setGoalMeasure(value as "none" | "one" | "custom");
                    setDirty(true);
                  }}
                  options={[
                    { value: "none", label: "不计入（只关联）" },
                    { value: "one", label: "算 1 个单位" },
                    { value: "custom", label: "自定义单位数" },
                  ]}
                />
              </div>
              {goalMeasure === "custom" ? (
                <div>
                  <label className="field-label">计入的单位数</label>
                  <input
                    className="field"
                    type="number"
                    min={0}
                    step={0.5}
                    value={goalContribution}
                    onChange={(event) => {
                      setGoalContribution(event.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

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
            {task.status !== "completed" ? (
              <button
                type="button"
                className="btn-primary"
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
