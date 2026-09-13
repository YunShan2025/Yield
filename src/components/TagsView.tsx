import { useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { filterTasksByView, taskRowClassName } from "@/lib/tasks";
import { formatDueDate } from "@/lib/dates";

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
    const map: Record<string, number> = {};
    for (const task of tasks) {
      if (task.deleted_at || task.parent_id) continue;
      for (const tagId of tagMap[task.id] ?? []) {
        map[tagId] = (map[tagId] ?? 0) + 1;
      }
    }
    return map;
  }, [tasks, tagMap]);

  const filtered = useMemo(
    () =>
      activeTagId
        ? filterTasksByView(tasks, "tags", tagMap, activeTagId)
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
            给任务分类打标，周清单的目标分栏也按同名标签自动汇总。
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
                const count = counts[tag.id] ?? 0;
                const on = activeTagId === tag.id;
                return (
                  <article
                    key={tag.id}
                    className={`tag-card ${on ? "is-active" : ""}`}
                    style={{ "--tag-accent": tag.color || TAG_PALETTE[index % TAG_PALETTE.length] } as CSSProperties}
                  >
                    <button
                      type="button"
                      className="tag-card-main"
                      title={on ? "取消筛选" : "查看该标签下的任务"}
                      onClick={() => setActiveTag(on ? null : tag.id)}
                    >
                      <span className="tag-card-dot" aria-hidden />
                      <strong>{tag.name}</strong>
                      <span className="tag-card-count">{count} 项任务</span>
                    </button>
                    <div className="tag-card-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => {
                          const next = window.prompt(
                            `重命名标签「${tag.name}」`,
                            tag.name,
                          );
                          const trimmed = next?.trim();
                          if (trimmed && trimmed !== tag.name) {
                            void updateTag(tag.id, trimmed);
                          }
                        }}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        className="btn-ghost danger"
                        onClick={() => {
                          if (
                            window.confirm(
                              `删除标签「${tag.name}」？任务不会被删除，仅解除关联。`,
                            )
                          ) {
                            void removeTag(tag.id);
                          }
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
          <section className="tags-filtered" aria-label={`${activeTag.name} 的任务`}>
            <header>
              <h3>
                <span className="tag-card-dot" aria-hidden />
                「{activeTag.name}」的任务
                <span className="tags-filtered-count">{filtered.length}</span>
              </h3>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setActiveTag(null)}
              >
                取消筛选
              </button>
            </header>
            {filtered.length ? (
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
                      {task.due_date ? formatDueDate(task.due_date) : "无日期"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="tags-filtered-empty">
                该标签下暂无任务。新建任务或编辑任务详情时可打上「{activeTag.name}」。
              </div>
            )}
          </section>
        ) : (
          <p className="tags-hint">点击上方标签卡片，可筛选查看对应任务。</p>
        )}
      </div>
    </main>
  );
}
