import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import type { RepeatRule, TaskPriority } from "@/types";
import { TimeRangeFields } from "@/components/TimePicker";
import { RepeatWeekdayPicker } from "@/components/RepeatWeekdayPicker";
import { SelectMenu } from "@/components/SelectMenu";
import { DatePicker } from "@/components/DatePicker";
import { findFirstAvailableTimeSlot } from "@/lib/planning";
import { nowTimeString, parseTimeToMinutes, todayDateString } from "@/lib/dates";
import {
  nextDateMatchingWeekdays,
  stringifyRepeatRule,
  weeklyRuleFromDate,
  monthlyRuleFromDate,
} from "@/lib/repeat";

function repeatFromFrequency(value: string, dueDate: string): RepeatRule | null {
  if (!value) return null;
  if (value === "custom") {
    return {
      frequency: "custom",
      interval: 1,
      nthWeekday: { n: -1, weekday: 5 },
    };
  }
  if (value === "weekly") return weeklyRuleFromDate(dueDate);
  if (value === "monthly") return monthlyRuleFromDate(dueDate);
  return {
    frequency: value as RepeatRule["frequency"],
    interval: 1,
  };
}

export function CreateTaskDialog() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const calendarCursor = useAppStore((s) => s.calendarCursor);
  const createTaskInbox = useAppStore((s) => s.createTaskInbox);
  const addTask = useAppStore((s) => s.addTask);
  const setTaskTags = useAppStore((s) => s.setTaskTags);
  const close = useAppStore((s) => s.closeCreateTask);
  const selectTask = useAppStore((s) => s.selectTask);
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(calendarCursor)
    ? calendarCursor
    : todayDateString();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(createTaskInbox ? "" : initialDate);
  const [dueTime, setDueTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [priority, setPriority] = useState<TaskPriority>(3);
  const [estimatedMinutes, setEstimatedMinutes] = useState(60);
  const [projectId, setProjectId] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [repeat, setRepeat] = useState<RepeatRule | null>(null);
  const [saving, setSaving] = useState(false);
  const [timeManual, setTimeManual] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const autoKeyRef = useRef(createTaskInbox ? ":60" : `${initialDate}:60`);

  const suggestedSlot = useMemo(() => {
    if (!dueDate) return null;
    const today = todayDateString();
    const now = parseTimeToMinutes(nowTimeString(false)) ?? 9 * 60;
    const notBefore = dueDate === today ? Math.max(9 * 60, now) : 9 * 60;
    return findFirstAvailableTimeSlot(tasks, dueDate, estimatedMinutes, notBefore);
  }, [tasks, dueDate, estimatedMinutes]);

  useEffect(() => {
    const key = `${dueDate}:${estimatedMinutes}`;
    if (key !== autoKeyRef.current) {
      autoKeyRef.current = key;
      setTimeManual(false);
    }
  }, [dueDate, estimatedMinutes]);

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

  const submit = async () => {
    if (!title.trim() || saving) return;
    if (dueDate && (!dueTime || !endTime)) return;
    let finalDue = dueDate;
    let finalRepeat = repeat;
    if (repeat?.frequency === "weekly") {
      const weekdays = repeat.weekdays?.length
        ? repeat.weekdays
        : weeklyRuleFromDate(dueDate).weekdays!;
      finalRepeat = { ...repeat, weekdays };
      finalDue = nextDateMatchingWeekdays(dueDate, weekdays);
    }
    setSaving(true);
    const task = await addTask({
      title: title.trim(),
      description: description.trim(),
      due_date: finalDue || null,
      due_time: dueDate ? dueTime : null,
      end_time: dueDate ? endTime : null,
      priority,
      estimated_minutes: estimatedMinutes,
      project_id: projectId || null,
      repeat_rule: stringifyRepeatRule(finalRepeat),
      flexible: dueDate ? 0 : 1,
      schedule_locked: dueDate ? 1 : 0,
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
          <label>日期<DatePicker value={dueDate} onChange={(next) => {
            setDueDate(next);
            if (!next) {
              setRepeat(null);
              setDueTime("");
              setEndTime("");
              setTimeManual(false);
            } else if (repeat?.frequency === "weekly") {
              setRepeat(weeklyRuleFromDate(next));
            }
          }} allowClear ariaLabel="任务日期" /></label>
          <label>优先级<SelectMenu ariaLabel="优先级" value={String(priority)} onChange={(value) => setPriority(Number(value) as TaskPriority)} options={[{ value: "1", label: "P1 紧急" }, { value: "2", label: "P2 高" }, { value: "3", label: "P3 普通" }, { value: "4", label: "P4 低" }]} /></label>
          <label>预计时长<SelectMenu ariaLabel="预计时长" value={String(estimatedMinutes)} onChange={(value) => setEstimatedMinutes(Number(value))} options={[{ value: "30", label: "30 分钟" }, { value: "45", label: "45 分钟" }, { value: "60", label: "1 小时" }, { value: "90", label: "1.5 小时" }, { value: "120", label: "2 小时" }]} /></label>
          <label>所属项目<SelectMenu ariaLabel="所属项目" value={projectId} onChange={setProjectId} options={[{ value: "", label: "无项目" }, ...projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name }))]} /></label>
          <label>标签<SelectMenu ariaLabel="标签" value={selectedTagId} onChange={setSelectedTagId} options={[{ value: "", label: "无标签" }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]} /></label>
          {dueDate ? (
            <label>
              重复
              <SelectMenu
                ariaLabel="重复"
                value={repeat?.frequency ?? ""}
                onChange={(value) => setRepeat(repeatFromFrequency(value, dueDate))}
                options={[
                  { value: "", label: "不重复" },
                  { value: "daily", label: "每天" },
                  { value: "weekly", label: "每周" },
                  { value: "monthly", label: "每月" },
                  { value: "custom", label: "每月最后周五" },
                ]}
              />
            </label>
          ) : null}
        </div>
        {repeat?.frequency === "weekly" ? (
          <div className="create-task-weekdays">
            <span className="create-task-hint">选择星期（可多选）</span>
            <RepeatWeekdayPicker
              weekdays={repeat.weekdays ?? weeklyRuleFromDate(dueDate).weekdays!}
              onChange={(weekdays) => {
                setRepeat({ ...repeat, weekdays });
                setDueDate(nextDateMatchingWeekdays(dueDate, weekdays));
              }}
            />
          </div>
        ) : null}
        {dueDate ? (
          <div className="create-task-time-card">
            <div className="create-task-time-head">
              <strong>时间安排</strong>
              <span className={`create-task-time-state${suggestedSlot ? "" : " warn"}`}>
                {!suggestedSlot
                  ? "当天空闲不足，请手动调整"
                  : timeManual
                    ? "已按你的调整保留"
                    : "已自动避开已有任务"}
              </span>
            </div>
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
        ) : null}
        <div className="create-task-actions"><button type="button" className="btn-ghost" onClick={close}>取消</button><button type="submit" className="btn-primary" disabled={!title.trim() || (Boolean(dueDate) && (!dueTime || !endTime)) || saving}>{saving ? "创建中…" : "创建任务"}</button></div>
      </form>
    </div>
  );
}
