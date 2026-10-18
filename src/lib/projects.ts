import type { Project } from "@/types";

const projectNameCollator = new Intl.Collator(
  ["zh-Hans-CN-u-co-pinyin", "zh-Hans-CN", "und"],
  { numeric: true, sensitivity: "base" },
);

function projectSortGroup(name: string): number {
  const first = [...name.trim()][0] ?? "";
  if (/[a-z]/i.test(first)) return 0;
  if (/[0-9]/.test(first)) return 1;
  return first ? 2 : 3;
}

export function sortProjectsByName(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => {
    const group = projectSortGroup(a.name) - projectSortGroup(b.name);
    return group || projectNameCollator.compare(a.name, b.name);
  });
}
