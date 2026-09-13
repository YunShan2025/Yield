import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app";
import { buildTaskDeferredUpdate } from "@/lib/planning";
import { addDays } from "@/lib/dates";
import type { Task, TaskUpdate } from "@/types";
import { confirmAction } from "@/components/AppConfirm";

/** Batch actions for selected day-board tasks. */
export function BatchToolbar({
  tasks,
  cursor,
  selectedIds,
  onClear,
}: {
  tasks: Task[];
  cursor: string;
  selectedIds: string[];
  onClear: () => void;
}) {
  const saveTasksBatch = useAppStore((s) => s.saveTasksBatch);
  const batchComplete = useAppStore((s) => s.batchComplete);
  const batchDelete = useAppStore((s) => s.batchDelete);
  const [batchDate, setBatchDate] = useState(addDays(cursor, 1));

  useEffect(() => {
    setBatchDate(addDays(cursor, 1));
  }, [cursor]);

  const deferSelected = async (date: string, message: string) => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    await saveTasksBatch(
      selectedIds
        .map((id) => {
          return byId.has(id)
            ? {
                id,
                updates: buildTaskDeferredUpdate(date),
              }
            : null;
        })
        .filter((item): item is { id: string; updates: TaskUpdate } => item !== null),
    );
    onClear();
    useAppStore.getState().setToast(message);
  };

  const deleteSelected = async () => {
    const ok = await confirmAction({
      title: "移入回收站？",
      description: `将把选中的 ${selectedIds.length} 项任务移入回收站。`,
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await batchDelete(selectedIds);
    onClear();
  };

  return (
    <div className="batch-toolbar">
      <span>已选择 {selectedIds.length} 项</span>
      <button
        type="button"
        className="btn-ghost"
        disabled={!selectedIds.length}
        onClick={() =>
          void deferSelected(
            addDays(cursor, 1),
            `已将 ${selectedIds.length} 项顺延到明天`,
          )
        }
      >
        顺延明天
      </button>
      <label className="batch-date-action">
        <span>改期</span>
        <input
          type="date"
          className="field"
          value={batchDate}
          onChange={(event) => setBatchDate(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn-ghost"
        disabled={!selectedIds.length || !batchDate}
        onClick={() =>
          void deferSelected(batchDate, `已调整 ${selectedIds.length} 项任务日期`)
        }
      >
        应用日期
      </button>
      <button
        type="button"
        className="btn-ghost"
        disabled={!selectedIds.length}
        onClick={() => {
          void batchComplete(selectedIds).then(onClear);
        }}
      >
        批量完成
      </button>
      <button
        type="button"
        className="btn-ghost danger"
        disabled={!selectedIds.length}
        onClick={() => void deleteSelected()}
      >
        批量删除
      </button>
    </div>
  );
}
