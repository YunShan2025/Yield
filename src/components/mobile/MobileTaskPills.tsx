import type { CSSProperties } from "react";

import type { Goal, Project, Tag, Task } from "@/types";

type MobileTaskPill = {
  key: string;
  name: string;
  color: string;
};

/**
 * 移动端的任务归属胶囊：项目在前、标签在后（目标徽标另算，排在它们后面）。
 * 今日、待办箱、周清单、项目与标签五处共用，避免几个页面在颜色、数量上限与
 * 排序上悄悄分叉。
 */
export function getMobileTaskPills(
  task: Task,
  projects: Project[],
  tags: Tag[],
  tagMap: Record<string, string[]>,
): MobileTaskPill[] {
  const pills: MobileTaskPill[] = [];
  const project = task.project_id
    ? projects.find((item) => item.id === task.project_id)
    : undefined;
  if (project) {
    pills.push({
      key: `project-${project.id}`,
      name: project.name,
      color: project.color,
    });
  }

  const tagIds = tagMap[task.id] ?? [];
  const tag = tagIds.length
    ? tags.find((item) => tagIds.includes(item.id))
    : undefined;
  if (tag) {
    pills.push({ key: `tag-${tag.id}`, name: tag.name, color: tag.color });
  }

  return pills;
}

/**
 * 任务关联目标的行内徽标：沿用今日时间轴那枚 `.goal-chip`，只留目标色底，
 * 不带前导点——移动壳里它和归属胶囊同一档尺寸，点反而让它看起来是另一种零件。
 * 目标解析不到（已彻底删除）就不显示，留空比挂错名字好。
 */
export function MobileGoalChip({ goal }: { goal?: Goal | null }) {
  if (!goal) return null;
  return (
    <span className="goal-chip" style={{ "--goal-color": goal.color } as CSSProperties}>
      {goal.title}
    </span>
  );
}

export function MobileTaskPillView({ pill }: { pill: MobileTaskPill }) {
  return (
    <span className="mtoday-pill" style={{ "--pill-color": pill.color } as CSSProperties}>
      {pill.name}
    </span>
  );
}
