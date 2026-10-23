import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/app";
import { AppIcon } from "@/components/AppIcon";
import { addDays, formatDueDateBadge, priorityLabel } from "@/lib/dates";
import { buildTaskDeferredUpdate } from "@/lib/planning";
import { confirmAction } from "@/components/AppConfirm";
import { DatePicker } from "@/components/DatePicker";
import type { Task, TaskPriority } from "@/types";

const PRIORITIES: TaskPriority[] = [1, 2, 3, 4];
const PRIORITY_NAMES: Record<TaskPriority, string> = {
  1: "紧急",
  2: "高",
  3: "普通",
  4: "低",
};
const SHEET_TITLE_ID = "task-action-sheet-title";
const DATE_SECTION_ID = "task-action-sheet-dates";
const PRIORITY_SECTION_ID = "task-action-sheet-priority";

/**
 * 触摸屏没有悬停/右键:长按任务行弹出的底部操作面板,承载原悬停菜单
 * (顺延/改期)与行级删除、优先级调整。经 portal 挂到 body,避免行内
 * transform 影响 fixed 定位。
 */
export function TaskActionSheet({
  task,
  cursor,
  onClose,
}: {
  task: Task;
  cursor: string;
  onClose: () => void;
}) {
  const saveTask = useAppStore((s) => s.saveTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const setToast = useAppStore((s) => s.setToast);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState(addDays(cursor, 1));

  useEffect(() => {
    document.body.classList.add("action-sheet-open");
    return () => document.body.classList.remove("action-sheet-open");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const due = formatDueDateBadge(task.due_date, cursor);

  const deferTo = (date: string) => {
    onClose();
    if (!date) return;
    const label = formatDueDateBadge(date, cursor).label;
    void saveTask(task.id, buildTaskDeferredUpdate(date))
      .then(() => setToast(`已安排到 ${label}`))
      .catch(() => undefined);
  };

  const clearDate = () => {
    onClose();
    void saveTask(task.id, {
      due_date: null,
      due_time: null,
      end_time: null,
    })
      .then(() => setToast("已清除日期"))
      .catch(() => undefined);
  };

  const onDelete = async () => {
    onClose();
    const ok = await confirmAction({
      title: "移入回收站？",
      description: `将把「${task.title}」移入回收站。`,
      confirmText: "删除",
      danger: true,
    });
    if (ok) await deleteTask(task.id);
  };

  return createPortal(
    <>
      <button
        type="button"
        className="action-sheet-backdrop"
        aria-label="关闭操作面板"
        onClick={onClose}
      />
      <div
        className="action-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="action-sheet-grip" aria-hidden="true" />
        <header className="action-sheet-head">
          <div className="action-sheet-heading">
            <h2 id={SHEET_TITLE_ID} className="action-sheet-title">
              {task.title}
            </h2>
            <p className="action-sheet-meta">
              <span className={`action-sheet-due is-${due.tone}`}>
                {due.label}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {priorityLabel(task.priority)} {PRIORITY_NAMES[task.priority]}
              </span>
            </p>
          </div>
          <button
            type="button"
            className="action-sheet-close"
            aria-label="关闭操作面板"
            onClick={onClose}
          >
            <AppIcon name="close" size={18} />
          </button>
        </header>

        <div className="action-sheet-body">
          <section
            className="action-sheet-section"
            aria-labelledby={DATE_SECTION_ID}
          >
            <div className="action-sheet-section-title" id={DATE_SECTION_ID}>
              安排
            </div>
            <div
              className={`action-sheet-grid${
                task.due_date === cursor ? " is-short" : ""
              }`}
            >
              {task.due_date !== cursor ? (
                <button
                  type="button"
                  className={task.due_date === cursor ? "active" : ""}
                  onClick={() => deferTo(cursor)}
                >
                  今天
                </button>
              ) : null}
              <button
                type="button"
                className={
                  task.due_date === addDays(cursor, 1) ? "active" : ""
                }
                onClick={() => deferTo(addDays(cursor, 1))}
              >
                明天
              </button>
              <button
                type="button"
                className={
                  task.due_date === addDays(cursor, 2) ? "active" : ""
                }
                onClick={() => deferTo(addDays(cursor, 2))}
              >
                后天
              </button>
              <button
                type="button"
                className={`action-sheet-custom${
                  customOpen ? " active" : ""
                }`}
                aria-expanded={customOpen}
                onClick={() => setCustomOpen((v) => !v)}
              >
                自定义日期…
              </button>
            </div>
            {customOpen ? (
              <label className="action-sheet-date">
                <span>改期到</span>
                <DatePicker
                  value={customDate}
                  onChange={(next) => {
                    setCustomDate(next);
                    if (next) deferTo(next);
                  }}
                  ariaLabel="改期到"
                />
              </label>
            ) : null}
            {task.due_date ? (
              <button
                type="button"
                className="action-sheet-clear"
                onClick={clearDate}
              >
                清除当前日期
              </button>
            ) : null}
          </section>

          <section
            className="action-sheet-section"
            aria-labelledby={PRIORITY_SECTION_ID}
          >
            <div
              className="action-sheet-section-title"
              id={PRIORITY_SECTION_ID}
            >
              优先级
            </div>
            <div className="action-sheet-priority">
              {PRIORITIES.map((priority) => (
                <button
                  key={priority}
                  type="button"
                  className={`action-sheet-priority-button pr${priority}${
                    task.priority === priority ? " active" : ""
                  }`}
                  aria-pressed={task.priority === priority}
                  onClick={() => {
                    onClose();
                    void saveTask(task.id, { priority });
                  }}
                >
                  <i className="action-sheet-priority-dot" aria-hidden="true" />
                  {priorityLabel(priority)}
                </button>
              ))}
            </div>
          </section>

          <button
            type="button"
            className="action-sheet-danger"
            onClick={() => void onDelete()}
          >
            <AppIcon name="trash" size={18} />
            移入回收站
          </button>
          <button
            type="button"
            className="action-sheet-cancel"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
