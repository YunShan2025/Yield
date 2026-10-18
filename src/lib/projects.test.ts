import { describe, expect, it } from "vitest";
import { sortProjectsByName } from "./projects";
import type { Project } from "@/types";

function project(name: string): Project {
  return {
    id: name,
    name,
    color: "#7D9BE8",
    due_date: null,
    archived: 0,
    deleted_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    tag_id: null,
  };
}

describe("project name sorting", () => {
  it("sorts mixed CJK and Latin project names alphabetically", () => {
    const sorted = sortProjectsByName([
      project("论文"),
      project("app"),
      project("Blog"),
      project("毕业"),
    ]);

    expect(sorted.map((item) => item.name)).toEqual([
      "app",
      "Blog",
      "毕业",
      "论文",
    ]);
  });
});
