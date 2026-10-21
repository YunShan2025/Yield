import { useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { confirmAction } from "@/components/AppConfirm";
import { filterTasksByView, taskRowClassName } from "@/lib/tasks";
import { formatDueDate, formatDayStamp } from "@/lib/dates";
import { AppIcon } from "@/components/AppIcon";
import type { Tag } from "@/types";

const TAG_PALETTE = [
  "#5B8FF9",
  "#3BB3C3",
  "#3ecf8e",
  "#8FBF4D",
  "#F0A05A",
  "#EAB308",
  "#f472b6",
  "#E05D5D",
  "#8B7CF6",
  "#8A94A6",
];

// 统一成大写，方便与存量颜色值比对高亮。
const COLOR_SWATCHES = TAG_PALETTE.map((color) => color.toUpperCase());

/** 标签色板：新建/修改共用的十个默认颜色。 */
function ColorPalette({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tag-color-palette" role="radiogroup" aria-label={ariaLabel}>
      {COLOR_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value.toUpperCase() === color}
          aria-label={color}
          className={`color-swatch${value.toUpperCase() === color ? " is-selected" : ""}`}
          style={{ background: color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

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
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState(COLOR_SWATCHES[0]);
  const [savingCreate, setSavingCreate] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

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

  const openCreate = () => {
    setCreateName("");
    setCreateColor(COLOR_SWATCHES[0]);
    setCreating(true);
  };

  const submitCreate = async () => {
    const trimmed = createName.trim();
    if (!trimmed || savingCreate) return;
    setSavingCreate(true);
    try {
      await addTag(trimmed, createColor);
      setCreating(false);
    } finally {
      setSavingCreate(false);
    }
  };

  const beginEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setEditName(tag.name);
    setEditColor(tag.color || COLOR_SWATCHES[0]);
  };

  const saveTag = async () => {
    if (!editingTag || !editName.trim()) {
      useAppStore.getState().setToast("标签名称不能为空");
      return;
    }
    await updateTag(editingTag.id, {
      name: editName.trim(),
      color: editColor,
    });
    setEditingTag(null);
    useAppStore.getState().setToast("标签已更新");
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
          <button
            type="button"
            className="btn-primary"
            onClick={openCreate}
          >
            新建标签
          </button>
        </div>
      </div>
      {/* 与「今日」同款的暖色引导框。 */}
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
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
                        className="item-action-btn item-action-edit"
                        onClick={() => beginEditTag(tag)}
                      >
                        <AppIcon name="edit" size={14} />
                        <span>编辑</span>
                      </button>
                      <button
                        type="button"
                        className="item-action-btn item-action-danger"
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
                        <AppIcon name="trash" size={14} />
                        <span>删除</span>
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

      {creating ? (
        <div className="modal-backdrop" onMouseDown={() => setCreating(false)}>
          <form
            className="project-edit-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitCreate();
            }}
          >
            <div className="modal-head">
              <div>
                <h3>新建标签</h3>
              </div>
              <button type="button" onClick={() => setCreating(false)}>×</button>
            </div>
            <label>
              标签名称
              <input
                autoFocus
                value={createName}
                placeholder="这个标签叫什么？"
                maxLength={16}
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <label>
              标签颜色
              <ColorPalette
                ariaLabel="标签颜色"
                value={createColor}
                onChange={setCreateColor}
              />
            </label>
            <div className="project-edit-actions">
              <button type="button" className="btn-ghost item-action-btn" onClick={() => setCreating(false)}>取消</button>
              <button
                type="submit"
                className="btn-primary item-action-btn item-action-primary"
                disabled={!createName.trim() || savingCreate}
              >
                {savingCreate ? "新建中…" : "新建标签"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingTag ? (
        <div className="modal-backdrop" onMouseDown={() => setEditingTag(null)}>
          <form
            className="project-edit-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveTag();
            }}
          >
            <div className="modal-head">
              <div>
                <h3>修改标签</h3>
              </div>
              <button type="button" onClick={() => setEditingTag(null)}>×</button>
            </div>
            <label>
              标签名称
              <input
                autoFocus
                value={editName}
                maxLength={16}
                onChange={(event) => setEditName(event.target.value)}
              />
            </label>
            <label>
              标签颜色
              <ColorPalette
                ariaLabel="标签颜色"
                value={editColor}
                onChange={setEditColor}
              />
            </label>
            <div className="project-edit-actions">
              <button type="button" className="btn-ghost item-action-btn" onClick={() => setEditingTag(null)}>取消</button>
              <button type="submit" className="btn-primary item-action-btn item-action-primary">保存修改</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
