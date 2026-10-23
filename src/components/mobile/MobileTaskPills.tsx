import type { CSSProperties } from "react";

import { mixHex } from "@/lib/color";
import type { Project, Tag, Task } from "@/types";

export type MobileTaskPill = {
  key: string;
  name: string;
  color: string;
};

const PILL_INK_LIGHT = "#0b1428";
const PILL_INK_DARK = "#ffffff";

/**
 * 移动端的任务归属胶囊：项目在前、标签在后，最多两枚。
 * 今日和待办箱共用，避免两个页面在颜色、数量上限与排序上悄悄分叉。
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

export function MobileTaskPillView({ pill }: { pill: MobileTaskPill }) {
  return (
    <span
      className="mtoday-pill"
      style={
        {
          "--pill-color": pill.color,
          "--pill-ink": mixHex(pill.color, PILL_INK_LIGHT, 0.55),
          "--pill-ink-dark": mixHex(pill.color, PILL_INK_DARK, 0.45),
        } as CSSProperties
      }
    >
      {pill.name}
    </span>
  );
}
