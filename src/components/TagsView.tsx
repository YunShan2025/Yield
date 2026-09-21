import { useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { confirmAction, promptAction } from "@/components/AppConfirm";
import { filterTasksByView, taskRowClassName } from "@/lib/tasks";
import { formatDueDate, formatDayStamp } from "@/lib/dates";

const TAG_PALETTE = [
  "#5B8FF9",
  "#f0a05a",
  "#8b7cf6",
  "#3ecf8e",
  "#f472b6",
  "#3bb3c3",
  "#e05d5d",
];

export function TagsView() {
  const tasks = useAppStore((s) => s.tasks);
  const projects = useAppStore((s) => s.projects);
  const tags = useAppStore((s) => s.tags);
  const tagMap = useAppStore((s) => s.tagMap);
  const activeTagId = useAppStore((s) => s.activeTagId);
  const setActiveTag = useAppStore((s) => s.setActiveTag);
  const addTag = useAppStore((s) => s.addTag);
  const updateTag = useAppStore((s) => s.updateTag);
  const removeTag = useAppStore((s) => s.removeTag);
  const selectTask = useAppStore((s) => s.selectTask);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const [name, setName] = useState("");

  const counts = useMemo(() => {
    // 统计口径：项目优先——先数带该标签的项目数，再数「无所属项目」且带
    // 该标签的任务数。归属了项目的任务不再重复计入（由项目代表）。
    const map: Record<string, { projects: number; tasks: number }> = {};
    for (const project of projects) {
      if (!project.tag_id) continue;
      map[project.tag_id] ??= { projects: 0, tasks: 0 };
      map[project.tag_id].projects += 1;
    }
    for (const task of tasks) {
      if (task.deleted_at || task.parent_id || task.project_id) continue;
      for (const tagId of tagMap[task.id] ?? []) {
        const entry = (map[tagId] ??= { projects: 0, tasks: 0 });
        entry.tasks += 1;
      }
    }
    return map;
  }, [projects, tasks, tagMap]);

  const taggedProjects = useMemo(
    () =>
      activeTagId
        ? projects.filter((project) => project.tag_id === activeTagId)
        : [],
    [projects, activeTagId],
  );
  const filtered = useMemo(
    () =>
      activeTagId
        ? filterTasksByView(tasks, "tags", tagMap, activeTagId).filter(
            (task) => !task.project_id,
          )
        : [],
    [tasks, tagMap, activeTagId],
  );
  const activeTag = tags.find((tag) => tag.id === activeTagId) ?? null;

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    void addTag(trimmed);
    setName("");
  };

  return (
    <main className="main-workspace tags-view">
      <div className="workspace-top">
        <div>
          <h2>标签</h2>
          <p className="workspace-subtitle">
            给项目与任务分类打标，项目自带标签，周清单的目标分栏也按同名标签自动汇总。
          </p>
        </div>
        <div className="top-controls">
          <input
            className="field tags-name-input"
            placeholder="新标签名称"
            value={name}
            maxLength={16}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={!name.trim()}
            onClick={submit}
          >
            添加标签
          </button>
        </div>
      </div>
      {/* 与「今日」同款的暖色引导框。 */}
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
          <span className="today-eyebrow">条理 · 标签</span>
          <h3>把散落的事，按线归拢。</h3>
          <p className="today-hero-note">跨项目、跨清单的同类任务，一个标签就能聚合查看。</p>
        </div>
      </section>
      <div className="tags-body">
        <section className="tags-manager" aria-label="标签管理">
          {tags.length ? (
            <div className="tags-grid">
              {tags.map((tag, index) => {
                const count = counts[tag.id];
                const on = activeTagId === tag.id;
                const countText = count
                  ? [
                      count.projects ? `${count.projects} 个项目` : "",
                      count.tasks ? `${count.tasks} 项任务` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : "暂无关联";
                return (
                  <article
                    key={tag.id}
                    className={`tag-card ${on ? "is-active" : ""}`}
                    style={{ "--tag-accent": tag.color || TAG_PALETTE[index % TAG_PALETTE.length] } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="tag-card-main"
                      title={on ? "取消筛选" : "查看该标签下的项目与任务"}
                      onClick={() => setActiveTag(on ? null : tag.id)}
                    >
                      <span className="tag-card-dot" aria-hidden />
                      <strong>{tag.name}</strong>
                      <span className="tag-card-count">{countText}</span>
                    </button>
                    <div className="tag-card-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          void promptAction({
                            title: `重命名标签「${tag.name}」`,
                            initial: tag.name,
                            maxLength: 16,
                            confirmText: "重命名",
                          }).then((next) => {
                            const trimmed = next?.trim();
                            if (trimmed && trimmed !== tag.name) {
                              void updateTag(tag.id, trimmed);
                            }
                          });
                        }}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        className="btn-ghost danger"
                        onClick={() => {
                          void confirmAction({
                            title: `删除标签「${tag.name}」？`,
                            description: "任务不会被删除，仅解除关联。",
                            confirmText: "删除",
                            danger: true,
                          }).then((ok) => {
                            if (ok) void removeTag(tag.id);
                          });
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              还没有标签。在上方输入名称，创建第一个标签。
            </div>
          )}
        </section>

        {activeTag ? (
          <section className="tags-filtered" aria-label={`${activeTag.name} 的项目与任务`}>
            <header>
              <h3>
                <span className="tag-card-dot" aria-hidden />
                「{activeTag.name}」的项目与任务
                <span className="tags-filtered-count">
                  {taggedProjects.length + filtered.length}
                </span>
              </h3>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setActiveTag(null)}
              >
                取消筛选
              </button>
            </header>
            {taggedProjects.length ? (
              <div className="tags-project-section">
                <h4>项目</h4>
                <div className="tags-project-list">
                  {taggedProjects.map((project) => (
                    <div key={project.id} className="tags-project-row">
                      <span className="tag-card-dot" style={{ background: project.color }} aria-hidden />
                      <p className="tags-project-name">{project.name}</p>
                      <span className="tags-task-due">
                        {tasks.filter((task) => task.project_id === project.id && !task.deleted_at).length} 项任务
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {filtered.length ? (
              <div className="tags-task-section">
                <h4>任务</h4>
                <div className="tags-task-list">
                  {filtered.map((task) => (
                    <div
                      key={task.id}
                      className={taskRowClassName(task, false)}
                      role="button"
                      tabIndex={0}
                      onClick={() => selectTask(task.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          selectTask(task.id);
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="task-check"
                        aria-label={task.status === "completed" ? "标记为未完成" : "标记为完成"}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleComplete(task.id);
                        }}
                      >
                        {task.status === "completed" ? "✓" : ""}
                      </button>
                      <p className="task-title">{task.title}</p>
                      <span className="tags-task-due">
                        {task.completed_at
                          ? formatDayStamp(task.completed_at)
                          : task.due_date
                            ? formatDueDate(task.due_date)
                            : "无日期"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {!taggedProjects.length && !filtered.length ? (
              <div className="tags-filtered-empty">
                该标签下暂无项目或独立任务。新建项目时可选择标签；未归属项目的任务也可在详情里打上「{activeTag.name}」。
              </div>
            ) : null}
          </section>
        ) : (
          <p className="tags-hint">点击上方标签卡片，可查看对应的项目与任务。</p>
        )}
      </div>
    </main>
  );
}
