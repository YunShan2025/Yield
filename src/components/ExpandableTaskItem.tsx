import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/app";
import { getSubtasks, subtaskProgress } from "@/lib/tasks";
import { priorityLabel } from "@/lib/dates";
import { DatePicker } from "@/components/DatePicker";
import { TimePicker } from "@/components/TimePicker";
import type { Task } from "@/types";

/** 把完成时刻（ISO）拆成本地日期 + 时间供表单编辑。 */
function splitCompletedAt(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function CompletedTimeEditor({
  task,
  onClose,
}: {
  task: Task;
  onClose: () => void;
}) {
  const setTaskCompletedAt = useAppStore((s) => s.setTaskCompletedAt);
  const initial = task.completed_at ? splitCompletedAt(task.completed_at) : null;
  const [date, setDate] = useState(initial?.date ?? "");
  const [time, setTime] = useState(initial?.time ?? "09:00");

  const save = () => {
    if (!date || !time) return;
    const next = new Date(`${date}T${time}:00`);
    if (Number.isNaN(next.getTime())) return;
    void setTaskCompletedAt(task.id, next.toISOString()).then(onClose);
  };

  // Portal 到 body：任务行 hover 时带 transform，会把 fixed 弹窗错位到行内。
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form
        className="completed-time-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completed-time-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="modal-head">
          <div>
            <span>{task.title}</span>
            <h3>修改完成时间</h3>
          </div>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <div className="completed-time-fields">
          <label>
            完成日期
            <DatePicker value={date} onChange={setDate} ariaLabel="完成日期" />
          </label>
          <label>
            完成时间
            <TimePicker value={time} onChange={setTime} />
          </label>
        </div>
        <div className="completed-time-actions">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn-primary" disabled={!date || !time}>
            保存
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export function ExpandableTaskItem({
  task,
  meta,
  selection,
  actions,
  rowAction,
  expandable = true,
}: {
  task: Task;
  meta?: ReactNode;
  actions?: ReactNode;
  /** 行级动作:与「详情」按钮同层级直接挂在行网格上(快捷操作区之外,窄屏不随其隐藏)。 */
  rowAction?: ReactNode;
  selection?: {
    active: boolean;
    selected: boolean;
    onToggle: () => void;
  };
  /** false = plain display row: no subtask panel/add input, row click opens detail. */
  expandable?: boolean;
}) {
  const tasks = useAppStore((s) => s.tasks);
  const selectTask = useAppStore((s) => s.selectTask);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const addTask = useAppStore((s) => s.addTask);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [editCompletedAt, setEditCompletedAt] = useState(false);

  const subs = getSubtasks(tasks, task.id);
  const progress = subtaskProgress(tasks, task.id);
  const doneCount = subs.filter((s) => s.status === "completed").length;

  const toggleExpand = () => {
    setExpanded((v) => !v);
  };

  return (
    <div
      className={`expand-task ${task.status === "completed" ? "is-done" : ""} ${expanded ? "is-open" : ""}`}
    >
      <div
        className="expand-task-row"
        onClick={expandable ? toggleExpand : () => selectTask(task.id)}
      >
        {selection?.active ? (
          <button
            type="button"
            className={`batch-check ${selection.selected ? "is-selected" : ""}`}
            aria-label={selection.selected ? "取消选择" : "选择任务"}
            onClick={(e) => {
              e.stopPropagation();
              selection.onToggle();
            }}
          >
            {selection.selected ? "✓" : ""}
          </button>
        ) : (
          <button
            type="button"
            className="task-check"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              void toggleComplete(task.id);
            }}
          >
            {task.status === "completed" ? "✓" : ""}
          </button>
        )}
        <div className="expand-task-main">
          <p className="task-title">{task.title}</p>
          <div className="task-meta">
            {meta}
            {task.reminder_minutes.length > 1 ? (
              <span className="reminder-chip">
                {task.reminder_minutes.length} 个提醒
              </span>
            ) : null}
            {subs.length ? (
              <span className="subtask-count">
                子任务 {doneCount}/{subs.length}
                {progress > 0 ? ` · ${Math.round(progress * 100)}%` : ""}
              </span>
            ) : expandable ? (
              <span className="subtask-count muted">点击添加子任务</span>
            ) : null}
          </div>
        </div>
        {task.status === "completed" ? (
          <button
            type="button"
            className="btn-ghost expand-detail"
            title="修改完成时间"
            onClick={(e) => {
              e.stopPropagation();
              setEditCompletedAt(true);
            }}
          >
            修改完成时间
          </button>
        ) : null}
        <button
          type="button"
          className="btn-ghost expand-detail"
          title="打开详情"
          onClick={(e) => {
            e.stopPropagation();
            selectTask(task.id);
          }}
        >
          详情
        </button>
        {rowAction}
        {actions ? (
          <div className="task-quick-actions" onClick={(event) => event.stopPropagation()}>
            {actions}
          </div>
        ) : null}
        {expandable ? (
          <span className={`expand-caret ${expanded ? "open" : ""}`} aria-hidden>
            ▾
          </span>
        ) : null}
      </div>

      {expandable && expanded ? (
        <div className="expand-subtasks">
          {subs.map((sub) => (
            <div
              key={sub.id}
              className={`expand-sub ${sub.status === "completed" ? "is-done" : ""}`}
            >
              <button
                type="button"
                className="task-check"
                onClick={() => void toggleComplete(sub.id)}
              >
                {sub.status === "completed" ? "✓" : ""}
              </button>
              <button
                type="button"
                className="expand-sub-title"
                onClick={() => selectTask(sub.id)}
              >
                {sub.title}
              </button>
              <span className="task-meta">{priorityLabel(sub.priority)}</span>
            </div>
          ))}
          {!subs.length ? (
            <div className="expand-sub-empty">暂无子任务，在下方添加</div>
          ) : null}
          <input
            className="field expand-sub-input"
            placeholder="添加子任务，回车保存"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const title = draft.trim();
              if (!title) return;
              void addTask({
                title,
                parent_id: task.id,
                due_date: null,
                due_time: null,
              }).then(() => setDraft(""));
            }}
          />
        </div>
      ) : null}

      {editCompletedAt ? (
        <CompletedTimeEditor task={task} onClose={() => setEditCompletedAt(false)} />
      ) : null}
    </div>
  );
}
