import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { DatePicker } from "@/components/DatePicker";
import { SelectMenu } from "@/components/SelectMenu";
import { confirmAction } from "@/components/AppConfirm";
import { AppIcon } from "@/components/AppIcon";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { MobileTaskLine } from "@/components/mobile/MobileTaskLine";
import { MobileTaskPillView } from "@/components/mobile/MobileTaskPills";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { useTodayDate } from "@/lib/useTodayDate";
import { useGoals } from "@/lib/useGoals";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { ExpandRow } from "@/components/ExpandRow";
import type { Goal, Project, Task } from "@/types";
import { projectTasks as selectProjectTasks } from "@/lib/tasks";
import { formatDayStamp } from "@/lib/dates";
import { softDeleteProject, updateProject } from "@/lib/db";

/** 移动壳与项目面板默认露出的任务条数。 */
const MOBILE_TASK_PREVIEW = 5;

export function ProjectsView() {
  const projects = useAppStore((state) => state.projects);
  const archivedProjects = useAppStore((state) => state.archivedProjects);
  const tags = useAppStore((state) => state.tags);
  const tasks = useAppStore((state) => state.tasks);
  const { goalById } = useGoals();
  const addProject = useAppStore((state) => state.addProject);
  const archiveProject = useAppStore((state) => state.archiveProject);
  const restoreProject = useAppStore((state) => state.restoreProject);
  const focusRequest = useAppStore((state) => state.focusRequest);
  const clearFocus = useAppStore((state) => state.clearFocus);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createTagId, setCreateTagId] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editTagId, setEditTagId] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  // 命令面板定位过来的项目需要滚到详情；手动点卡片时保持原位。
  const pendingDetailScrollRef = useRef(false);

  /** 项目颜色不自选：跟随所选标签的颜色；无标签时保留原色兜底。 */
  const projectColor = (project: Project) =>
    tags.find((tag) => tag.id === project.tag_id)?.color ?? project.color;

  const activeProject =
    projects.find((p) => p.id === activeProjectId) ??
    archivedProjects.find((p) => p.id === activeProjectId) ??
    null;

  // 命令面板选中项目后：展开该项目的任务详情（已归档项目也能定位）。
  useEffect(() => {
    if (focusRequest?.kind !== "project") return;
    pendingDetailScrollRef.current = true;
    setActiveProjectId(focusRequest.id);
    clearFocus();
  }, [focusRequest, clearFocus]);

  useEffect(() => {
    if (!activeProject || !pendingDetailScrollRef.current) return;
    pendingDetailScrollRef.current = false;
    document
      .querySelector(`[data-expand-row="${activeProject.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeProject]);

  const openCreate = () => {
    setCreateName("");
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
      // 颜色与标签同步：改标签时颜色随之更新，未选标签则保持不变。
      color:
        tags.find((tag) => tag.id === (editTagId || null))?.color ??
        editingProject.color,
      due_date: editDueDate || null,
      tag_id: editTagId || null,
    });
    await useAppStore.getState().refreshAll();
    setEditingProject(null);
    useAppStore.getState().setToast("项目已更新");
  };

  const deleteActiveProject = async () => {
    if (!activeProject) return;
    const ok = await confirmAction({
      title: `将项目「${activeProject.name}」移入回收站？`,
      description: "可在回收站中恢复；项目下的任务会保留。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await softDeleteProject(activeProject.id);
    setActiveProjectId(null);
    await useAppStore.getState().refreshAll();
    useAppStore.getState().setToast("项目已移入回收站");
  };

  return (
    <main className="main-workspace projects-view">
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "项目" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="项目" /> : "项目"}

          </h2>
          <p className="workspace-subtitle">组织长期事项，聚合相关任务</p>
        </div>
        <div className="top-controls">
          <button
            type="button"
            className="btn-primary"
            onClick={openCreate}
          >
            新建项目
          </button>
        </div>
      </div>

      <div className="projects-scroll">
        {/* 与「今日/成长」同款的暖色引导框。移动壳换数据型顶卡。 */}
        {isMobileShell() ? (
          <MobileGuideCard
            value={projects.length}
            unit="个"
            label="项目在册"
            hint={`${projects.filter((project) => selectProjectTasks(tasks, project.id).length).length} 个进行中 · 已归档 ${archivedProjects.length} 个`}
          />
        ) : (
          <section className="today-hero guide-hero">
            <div className="today-hero-copy">
              <h3>百工居肆以成其事。</h3>
            </div>
            <div className="today-hero-meter">
              <span className="today-hero-meter-count">
                <strong>{projects.length}</strong>
                <span>个</span>
              </span>
              <span className="today-hero-meter-label">项目</span>
            </div>
          </section>
        )}
        {/* 未开始：还没有任务的项目；进行中：已挂上任务的项目。 */}
        {(() => {
          const notStarted = projects.filter(
            (project) => !selectProjectTasks(tasks, project.id).length,
          );
          const inProgress = projects.filter((project) =>
            selectProjectTasks(tasks, project.id).length,
          );
          return (
            <>
              <section>
                <div className="section-title-row">
                  <h3>进行中</h3>
                  <span className="tags-filtered-count">{inProgress.length}</span>
                </div>
                <div className="projects-grid">
                  {inProgress.map((project) => {
                    const projectTasks = selectProjectTasks(tasks, project.id);
                    const on = activeProjectId === project.id;
                    const done = projectTasks.filter((task) => task.status === "completed").length;
                    return (
                      <ExpandRow
                        key={project.id}
                        open={on}
                        className={
                          projectTasks.length && done === projectTasks.length
                            ? "is-clear"
                            : undefined
                        }
                        onToggle={() => setActiveProjectId(on ? null : project.id)}
                        accent={projectColor(project)}
                        rowId={project.id}
                        dot={<span className="tag-card-dot" aria-hidden />}
                        title={project.name}
                        trailing={`${projectTasks.length} 项任务 · 已完成 ${done}`}
                        toggleTitle={on ? "收起该项目" : "查看该项目的任务"}
                      >
                        <ProjectTaskPanel
                          project={project}
                          tasks={projectTasks}
                          tags={tags}
                          goalById={goalById}
                          onEdit={() => beginEditProject(project)}
                          onArchive={() => void archiveProject(project.id)}
                          onDelete={() => void deleteActiveProject()}
                        />
                      </ExpandRow>
                    );
                  })}
                  {!projects.length ? (
                    <div className="scope-empty">创建第一个项目来组织相关任务。</div>
                  ) : null}
                </div>
              </section>

              {notStarted.length ? (
                <section aria-label="未开始项目">
                  <div className="section-title-row">
                    <h3>未开始</h3>
                    <span className="tags-filtered-count">{notStarted.length}</span>
                  </div>
                  <div className="projects-grid projects-grid-archived">
                    {notStarted.map((project) => {
                      const on = activeProjectId === project.id;
                      return (
                        <ExpandRow
                          key={project.id}
                          open={on}
                          onToggle={() => setActiveProjectId(on ? null : project.id)}
                          accent={projectColor(project)}
                          rowId={project.id}
                          dot={<span className="tag-card-dot" aria-hidden />}
                          title={project.name}
                          trailing="暂无任务"
                          toggleTitle={on ? "收起该项目" : "查看该项目的任务"}
                        >
                          <p className="expand-row-empty">这个项目还没有挂任务。</p>
                        </ExpandRow>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </>
          );
        })()}

        {archivedProjects.length ? (
          <section aria-label="已归档项目">
            <div className="section-title-row">
              <h3>已归档</h3>
              <span className="tags-filtered-count">{archivedProjects.length}</span>
            </div>
            <div className="projects-grid projects-grid-archived">
              {archivedProjects.map((project) => {
                const projectTasks = selectProjectTasks(tasks, project.id);
                const done = projectTasks.filter(
                  (task) => task.status === "completed",
                ).length;
                const on = activeProjectId === project.id;
                return (
                  <ExpandRow
                    key={project.id}
                    open={on}
                    onToggle={() => setActiveProjectId(on ? null : project.id)}
                    accent={projectColor(project)}
                    rowId={project.id}
                    dot={<span className="tag-card-dot" aria-hidden />}
                    title={project.name}
                    trailing={
                      projectTasks.length
                        ? `${projectTasks.length} 项任务 · 已完成 ${done}`
                        : "暂无任务"
                    }
                    toggleTitle={on ? "收起该项目" : "查看该项目的任务"}
                  >
                    <ProjectTaskPanel
                      project={project}
                      tasks={projectTasks}
                      tags={tags}
                      goalById={goalById}
                      archived
                      onRestore={() => void restoreProject(project.id)}
                      onDelete={() => void deleteActiveProject()}
                    />
                  </ExpandRow>
                );
              })}
            </div>
          </section>
        ) : null}
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
              <button type="button" className="btn-ghost item-action-btn" onClick={() => setCreating(false)}>取消</button>
              <button type="submit" className="btn-primary item-action-btn item-action-primary" disabled={!createName.trim() || savingCreate}>
                {savingCreate ? "新建中…" : "新建项目"}
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
                <h3>编辑项目</h3>
              </div>
              <button type="button" onClick={() => setEditingProject(null)}>×</button>
            </div>
            <label>
              项目名称
              <input autoFocus value={editName} onChange={(event) => setEditName(event.target.value)} />
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
              <button type="button" className="btn-ghost item-action-btn" onClick={() => setEditingProject(null)}>取消</button>
              <button type="submit" className="btn-primary item-action-btn item-action-primary">保存修改</button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

/** 展开在行内的任务面板：任务列表 + 右对齐的操作。 */
function ProjectTaskPanel({
  project,
  tasks,
  tags,
  goalById,
  archived,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  project: Project;
  tasks: ReturnType<typeof useAppStore.getState>["tasks"];
  tags: ReturnType<typeof useAppStore.getState>["tags"];
  goalById?: Map<string, Goal>;
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const tagMap = useAppStore((s) => s.tagMap);
  const today = useTodayDate();
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  const tag = tags.find((item) => item.id === project.tag_id);
  // 完成时间倒序（未完成在后）；默认只展示前五条，可展开全部
  const sortedTasks = [...tasks].sort(
    (a, b) =>
      (Date.parse(b.completed_at ?? "") || 0) -
      (Date.parse(a.completed_at ?? "") || 0),
  );
  const canToggleAll = sortedTasks.length > MOBILE_TASK_PREVIEW;
  const visibleTasks = showAllTasks
    ? sortedTasks
    : sortedTasks.slice(0, MOBILE_TASK_PREVIEW);

  if (isMobileShell()) {
    /* 移动壳：面板不再嵌第二层 .expand-row-body（桌面那份嵌了两层，内边距被叠了
       两次）；任务行走统一行件，项目本身就是归属所以不再挂项目胶囊。 */
    return (
      <div className="mrow-panel">
        {tag || canToggleAll ? (
          <div className="mrow-panel-head">
            {tag ? (
              <MobileTaskPillView
                pill={{ key: `tag-${tag.id}`, name: tag.name, color: tag.color }}
              />
            ) : (
              <span />
            )}
            {canToggleAll ? (
              <button
                type="button"
                className="mrow-toggle"
                onClick={() => setShowAllTasks((v) => !v)}
              >
                {showAllTasks ? "收起" : `展开全部 ${sortedTasks.length} 项`}
              </button>
            ) : null}
          </div>
        ) : null}
        {sortedTasks.length ? (
          <ul className="mrow-list">
            {visibleTasks.map((task) => (
              <MobileTaskLine
                key={task.id}
                task={task}
                today={today}
                projects={[]}
                tags={tags}
                tagMap={tagMap}
                goalById={goalById}
                showProjectPill={false}
                doneStamp
                onOpen={() => selectTask(task.id)}
                onComplete={() => void toggleComplete(task.id)}
                onMore={() => setSheetTask(task)}
              />
            ))}
          </ul>
        ) : (
          <p className="expand-row-empty">这个项目还没有挂任务。</p>
        )}
        <PanelFoot
          archived={archived}
          onEdit={onEdit}
          onArchive={onArchive}
          onRestore={onRestore}
          onDelete={onDelete}
        />
        {sheetTask ? (
          <TaskActionSheet
            task={sheetTask}
            cursor={today}
            onClose={() => setSheetTask(null)}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="expand-row-body">
      {tag ? (
        <span className="project-card-tag">
          <i className="tag-card-dot" aria-hidden />
          {tag.name}
        </span>
      ) : null}
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
      {canToggleAll ? (
        <button
          type="button"
          className="btn-ghost project-tasks-toggle"
          onClick={() => setShowAllTasks((v) => !v)}
        >
          {showAllTasks ? "收起任务列表" : `展开全部 ${sortedTasks.length} 项任务`}
        </button>
      ) : null}
      <PanelFoot
        archived={archived}
        onEdit={onEdit}
        onArchive={onArchive}
        onRestore={onRestore}
        onDelete={onDelete}
      />
    </div>
  );
}

/** 面板底部动作条：编辑 / 归档（已归档则给恢复）/ 删除。两端共用。 */
function PanelFoot({
  archived,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  archived?: boolean;
  onEdit?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="expand-row-foot">
      {onEdit ? (
        <button type="button" className="item-action-btn item-action-edit" onClick={onEdit}>
          <AppIcon name="edit" size={14} />
          <span>编辑</span>
        </button>
      ) : null}
      {archived ? (
        onRestore ? (
          <button
            type="button"
            className="item-action-btn item-action-archive"
            onClick={onRestore}
          >
            <AppIcon name="review" size={14} />
            <span>恢复</span>
          </button>
        ) : null
      ) : onArchive ? (
        <button
          type="button"
          className="item-action-btn item-action-archive"
          onClick={onArchive}
        >
          <AppIcon name="archive" size={14} />
          <span>归档</span>
        </button>
      ) : null}
      <button
        type="button"
        className="item-action-btn item-action-danger quiet-danger"
        onClick={onDelete}
      >
        <AppIcon name="trash" size={14} />
        <span>删除</span>
      </button>
    </div>
  );
}
