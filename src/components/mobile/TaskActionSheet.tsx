import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "@/store/app";
import { addDays, priorityLabel } from "@/lib/dates";
import { buildTaskDeferredUpdate } from "@/lib/planning";
import { confirmAction } from "@/components/AppConfirm";
import { DatePicker } from "@/components/DatePicker";
import type { Task, TaskPriority } from "@/types";

const PRIORITIES: TaskPriority[] = [1, 2, 3, 4];

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
  const [customOpen, setCustomOpen] = useState(false);
  const [customDate, setCustomDate] = useState(addDays(cursor, 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const deferTo = (date: string) => {
    onClose();
    if (!date) return;
    void saveTask(task.id, buildTaskDeferredUpdate(date));
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
        role="menu"
        aria-label={`任务操作：${task.title}`}
        onClick={(event) => event.stopPropagation()}
      >
        <p className="action-sheet-title">{task.title}</p>
        <div className="action-sheet-grid">
          <button type="button" onClick={() => deferTo(addDays(cursor, 1))}>
            顺延到明天
          </button>
          <button type="button" onClick={() => setCustomOpen((v) => !v)}>
            改期到自定义日期…
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
        <div className="action-sheet-priority">
          {PRIORITIES.map((priority) => (
            <button
              key={priority}
              type="button"
              className={task.priority === priority ? "active" : ""}
              onClick={() => {
                onClose();
                void saveTask(task.id, { priority });
              }}
            >
              {priorityLabel(priority)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="action-sheet-danger"
          onClick={() => void onDelete()}
        >
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
    </>,
    document.body,
  );
}
