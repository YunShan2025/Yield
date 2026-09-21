import { useRef, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { DatePicker } from "@/components/DatePicker";
import { SelectMenu } from "@/components/SelectMenu";
import type { Project } from "@/types";
import { projectTasks as selectProjectTasks } from "@/lib/tasks";
import { formatDayStamp } from "@/lib/dates";
import { updateProject } from "@/lib/db";

export function ProjectsView() {
  const projects = useAppStore((state) => state.projects);
  const tags = useAppStore((state) => state.tags);
  const tasks = useAppStore((state) => state.tasks);
  const addProject = useAppStore((state) => state.addProject);
  const archiveProject = useAppStore((state) => state.archiveProject);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState("#7D9BE8");
  const [createTagId, setCreateTagId] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#7D9BE8");
  const [editDueDate, setEditDueDate] = useState("");
  const [editTagId, setEditTagId] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  const openCreate = () => {
    setCreateName("");
    setCreateColor("#7D9BE8");
    setCreateTagId("");
    setCreating(true);
  };

  const submitCreate = async () => {
    const projectName = createName.trim();
    if (!projectName || savingCreate) {
      if (!projectName) nameInputRef.current?.focus();
      return;
    }
    setSavingCreate(true);
    try {
      await addProject(projectName, createTagId || null);
      setCreating(false);
    } finally {
      setSavingCreate(false);
    }
  };

  const beginEditProject = (project: Project) => {
    setEditingProject(project);
    setEditName(project.name);
    setEditColor(project.color);
    setEditDueDate(project.due_date ?? "");
    setEditTagId(project.tag_id ?? "");
  };

  const saveProject = async () => {
    if (!editingProject || !editName.trim()) {
      useAppStore.getState().setToast("项目名称不能为空");
      return;
    }
    await updateProject(editingProject.id, {
      name: editName.trim(),
      color: editColor,
      due_date: editDueDate || null,
      tag_id: editTagId || null,
    });
    await useAppStore.getState().refreshAll();
    setEditingProject(null);
    useAppStore.getState().setToast("项目已更新");
  };

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <main className="main-workspace projects-view">
      <div className="workspace-top">
        <div>
          <h2>项目</h2>
          <p className="workspace-subtitle">组织长期事项，聚合相关任务</p>
        </div>
        <div className="top-controls">
          <button
            type="button"
            className="btn-primary"
            onClick={openCreate}
          >
            ＋ 新建项目
          </button>
        </div>
      </div>

      <div className="projects-scroll">
        {/* 与「今日/成长」同款的暖色引导框。 */}
        <section className="today-hero guide-hero">
          <div className="today-hero-copy">
            <span className="today-eyebrow">百工 · 项目</span>
            <h3>百工居肆以成其事。</h3>
            <p className="today-hero-note">项目是长期事项的工坊：相关任务都在这里聚拢。</p>
          </div>
        </section>
        <section>
          <div className="section-title-row">
            <h3>项目</h3>
          </div>

          {/* 与标签页同构：上方紧凑卡片，点击卡片在下方展开具体任务 */}
          <div className="projects-grid">
            {projects.map((project) => {
              const projectTasks = selectProjectTasks(tasks, project.id);
              const done = projectTasks.filter(
                (task) => task.status === "completed",
              ).length;
              const on = activeProjectId === project.id;
              return (
                <article
                  key={project.id}
                  className={`tag-card project-tile ${on ? "is-active" : ""}`}
                  style={{ "--tag-accent": project.color } as CSSProperties}
                >
                  <button
                    type="button"
                    className="tag-card-main"
                    title={on ? "收起该项目" : "查看该项目的任务"}
                    onClick={() => setActiveProjectId(on ? null : project.id)}
                  >
                    <span className="tag-card-dot" aria-hidden />
                    <strong>{project.name}</strong>
                    <span className="tag-card-count">
                      {projectTasks.length
                        ? `${projectTasks.length} 项任务 · 已完成 ${done}`
                        : "暂无任务"}
                    </span>
                  </button>
                </article>
              );
            })}
            {!projects.length ? (
              <div className="scope-empty">创建第一个项目来组织相关任务。</div>
            ) : null}
          </div>
        </section>

        {activeProject ? (
          <ProjectDetail
            project={activeProject}
            tasks={tasks}
            tags={tags}
            onEdit={() => beginEditProject(activeProject)}
            onArchive={() => void archiveProject(activeProject.id)}
            onClose={() => setActiveProjectId(null)}
          />
        ) : (
          <p className="projects-hint">点击上方项目卡片，可查看对应的任务与进度。</p>
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
                <span>项目</span>
                <h3>新建项目</h3>
              </div>
              <button type="button" onClick={() => setCreating(false)}>×</button>
            </div>
            <label>
              项目名称
              <input
                ref={nameInputRef}
                autoFocus
                value={createName}
                placeholder="这个项目叫什么？"
                onChange={(event) => setCreateName(event.target.value)}
              />
            </label>
            <label>
              项目标识色
              <div className="project-color-field">
                <input type="color" value={createColor} onChange={(event) => setCreateColor(event.target.value)} />
                <span>{createColor.toUpperCase()}</span>
              </div>
            </label>
            <label>
              项目标签
              <SelectMenu
                ariaLabel="项目标签"
                value={createTagId}
                onChange={setCreateTagId}
                options={[
                  { value: "", label: "无标签" },
                  ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                ]}
              />
              <small className="project-field-hint">选中此项目的任务会默认带上这个标签。</small>
            </label>
            <div className="project-edit-actions">
              <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>取消</button>
              <button type="submit" className="btn-primary" disabled={!createName.trim() || savingCreate}>
                {savingCreate ? "创建中…" : "创建项目"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {editingProject ? (
        <div className="modal-backdrop" onMouseDown={() => setEditingProject(null)}>
          <form
            className="project-edit-modal"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveProject();
            }}
          >
            <div className="modal-head">
              <div>
                <span>项目设置</span>
                <h3>编辑项目</h3>
              </div>
              <button type="button" onClick={() => setEditingProject(null)}>×</button>
            </div>
            <label>
              项目名称
              <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} />
            </label>
            <label>
              项目标识色
              <div className="project-color-field">
                <input type="color" value={editColor} onChange={(event) => setEditColor(event.target.value)} />
                <span>{editColor.toUpperCase()}</span>
              </div>
            </label>
            <label>
              项目标签
              <SelectMenu
                ariaLabel="项目标签"
                value={editTagId}
                onChange={setEditTagId}
                options={[
                  { value: "", label: "无标签" },
                  ...tags.map((tag) => ({ value: tag.id, label: tag.name })),
                ]}
              />
            </label>
            <label>
              截止日期
              <DatePicker value={editDueDate} onChange={setEditDueDate} allowClear ariaLabel="项目截止日期" />
            </label>
            <div className="project-edit-actions">
              <button type="button" className="btn-ghost" onClick={() => setEditingProject(null)}>取消</button>
              <button type="submit" className="btn-primary">保存修改</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

/** 选中项目后展开的任务详情区，样式对齐标签页的筛选区。 */
function ProjectDetail({
  project,
  tasks,
  tags,
  onEdit,
  onArchive,
  onClose,
}: {
  project: Project;
  tasks: ReturnType<typeof useAppStore.getState>["tasks"];
  tags: ReturnType<typeof useAppStore.getState>["tags"];
  onEdit: () => void;
  onArchive: () => void;
  onClose: () => void;
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  const [showAllTasks, setShowAllTasks] = useState(false);
  const projectTasks = selectProjectTasks(tasks, project.id);
  const done = projectTasks.filter((task) => task.status === "completed").length;
  const progress = projectTasks.length
    ? Math.round((done / projectTasks.length) * 100)
    : 0;
  const tagName = tags.find((tag) => tag.id === project.tag_id)?.name;
  // 完成时间倒序（未完成在后）；默认只展示前五条，可展开全部
  const sortedTasks = [...projectTasks].sort(
    (a, b) =>
      (Date.parse(b.completed_at ?? "") || 0) -
      (Date.parse(a.completed_at ?? "") || 0),
  );
  const visibleTasks = showAllTasks ? sortedTasks : sortedTasks.slice(0, 5);
  return (
    <section className="tags-filtered projects-detail" aria-label={`${project.name} 的任务`}>
      <header>
        <h3>
          <span className="tag-card-dot" style={{ background: project.color }} aria-hidden />
          「{project.name}」的任务
          <span className="tags-filtered-count">{projectTasks.length}</span>
        </h3>
        <div className="projects-detail-actions">
          <button type="button" className="project-card-edit" onClick={onEdit}>
            编辑
          </button>
          <button type="button" className="project-card-archive" onClick={onArchive}>
            归档
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </header>
      <div className="project-card-meta">
        <p>{projectTasks.length} 项任务 · 已完成 {done}</p>
        {project.tag_id ? (
          <span
            className="project-card-tag"
            style={{ "--tag-accent": tags.find((tag) => tag.id === project.tag_id)?.color } as CSSProperties}
          >
            <i className="tag-card-dot" aria-hidden />
            {tagName ?? "标签"}
          </span>
        ) : null}
      </div>
      <div className="progress-bar">
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="project-task-links">
        {visibleTasks.map((task) => (
          <button key={task.id} type="button" onClick={() => selectTask(task.id)}>
            <span className="project-task-link-title">
              {task.status === "completed" ? "✓" : "○"} {task.title}
            </span>
            {task.completed_at ? (
              <span className="project-task-done-at">
                {formatDayStamp(task.completed_at)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {sortedTasks.length > 5 ? (
        <button
          type="button"
          className="btn-ghost project-tasks-toggle"
          onClick={() => setShowAllTasks((v) => !v)}
        >
          {showAllTasks ? "收起任务列表" : `展开全部 ${sortedTasks.length} 项任务`}
        </button>
      ) : null}
    </section>
  );
}
