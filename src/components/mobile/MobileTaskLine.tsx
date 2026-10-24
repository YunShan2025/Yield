import type { ReactNode } from "react";

import {
  MobileGoalChip,
  MobileTaskPillView,
  getMobileTaskPills,
} from "@/components/mobile/MobileTaskPills";
import { MobileTaskRow } from "@/components/mobile/MobileTaskRow";
import { formatDueDateBadge } from "@/lib/dates";
import type { Goal, Project, Tag, Task } from "@/types";

/** 完成时间小注：ISO 时间戳 → 「10/21」。行尾小字要的是短戳，不是「2026年10月21日」。 */
export function mobileDoneStamp(iso: string | null): string | null {
  if (!iso) return null;
  const [, month, day] = iso.slice(0, 10).split("-");
  if (!month || !day) return null;
  return `${Number(month)}/${Number(day)}`;
}

/**
 * 移动壳的统一任务行：周清单「本周任务」、当周日历、项目面板、标签任务列表共用。
 *
 * 原子全部复用今日 / 待办那一套（优先级方点 `.minbox-pdot`、日期语气药丸
 * `.minbox-due`、归属胶囊 `.mtoday-pill`、完成圆钮 `.mtoday-check`），行外壳是
 * `MobileTaskRow`：长按弹操作面板、触摸位移取消、Enter/Space、可见焦点。
 * 完成状态不再用 ○/✓ 文本字形（DESIGN.md：不用 Unicode 字形充当图标）。
 *
 * `day` 变体给「当周日历」用：那一列本身就是日期，语气药丸是噪声，行首色点是分类色
 * （`dotColor`）而不是优先级点；归属胶囊照旧，一屏七天才有信息可读。
 */
export function MobileTaskLine({
  task,
  today,
  projects,
  tags,
  tagMap,
  goalById,
  variant = "list",
  dotColor,
  tail,
  doneStamp = false,
  showProjectPill = true,
  showTagPill = true,
  onOpen,
  onComplete,
  onMore,
}: {
  task: Task;
  today: string;
  projects: Project[];
  tags: Tag[];
  tagMap: Record<string, string[]>;
  /** 目标表索引（`useGoals()` 在宿主页面取一次）；给了才显示目标徽标。 */
  goalById?: Map<string, Goal>;
  variant?: "list" | "day";
  /** `day` 变体的行首分类色点（`categoryColor`）。 */
  dotColor?: string;
  /** 右对齐小注；`doneStamp` 未命中时用它。 */
  tail?: ReactNode;
  /** 已完成时把完成日期收成行尾小注。 */
  doneStamp?: boolean;
  showProjectPill?: boolean;
  showTagPill?: boolean;
  onOpen: () => void;
  onComplete: () => void;
  onMore: () => void;
}) {
  const done = task.status === "completed";
  const isDay = variant === "day";
  /** 已完成不标截止语气（与详情栏同一口径）：「逾期 32 天」压在划掉的事上只是噪声，
   *  它哪天做完的由行尾小注（`doneStamp`）说。 */
  const due = done ? null : formatDueDateBadge(task.due_date, today);
  const attribution = getMobileTaskPills(task, projects, tags, tagMap);
  const pills = isDay
    ? attribution
    : attribution.filter((pill) =>
        pill.key.startsWith("project-") ? showProjectPill : showTagPill,
      );
  const goal = task.goal_id ? goalById?.get(task.goal_id) : undefined;
  const stamp = doneStamp ? mobileDoneStamp(task.completed_at) : null;
  const hasMeta = !isDay || pills.length > 0 || !!goal;

  return (
    <MobileTaskRow
      className={`mrow${done ? " is-done" : ""}${isDay ? " is-dense" : ""}`}
      label={task.title}
      onActivate={onOpen}
      onLongPress={onMore}
    >
      {isDay && dotColor ? (
        <i className="mrow-cdot" style={{ background: dotColor }} aria-hidden="true" />
      ) : null}
      <span className="mrow-main">
        <span className="mrow-title">{task.title}</span>
        {hasMeta ? (
          <span className="mrow-meta">
            {isDay ? null : (
              <>
                <i className={`minbox-pdot pr${task.priority}`} aria-hidden="true" />
                {due ? (
                  <span
                    className={`minbox-due is-${due.tone}`}
                    title={due.title}
                    aria-label={
                      due.tone === "none" ? "未安排日期" : `${due.label}，${due.title}`
                    }
                  >
                    {due.label}
                  </span>
                ) : null}
              </>
            )}
            {pills.map((pill) => (
              <MobileTaskPillView key={pill.key} pill={pill} />
            ))}
            <MobileGoalChip goal={goal} />
          </span>
        ) : null}
      </span>
      {stamp || tail ? <span className="mrow-tail">{stamp ?? tail}</span> : null}
      <button
        type="button"
        className={`mtoday-check${done ? " is-done" : ""}`}
        aria-label={done ? `已完成 ${task.title}` : `完成 ${task.title}`}
        aria-pressed={done}
        onClick={(event) => {
          event.stopPropagation();
          onComplete();
        }}
      />
    </MobileTaskRow>
  );
}
