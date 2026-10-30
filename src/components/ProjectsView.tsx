import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { DatePicker } from "@/components/DatePicker";
import { SelectMenu } from "@/components/SelectMenu";
import { confirmAction } from "@/components/AppConfirm";
import { AppIcon } from "@/components/AppIcon";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { MobileTaskLine, mobileDoneStamp } from "@/components/mobile/MobileTaskLine";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { useTodayDate } from "@/lib/useTodayDate";
import { useGoals } from "@/lib/useGoals";
import { isMobileShell } from "@/lib/platform";
import { useFloatingDismiss } from "@/lib/floatingDialog";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { ExpandRow } from "@/components/ExpandRow";
import type { Project, Task } from "@/types";
import { projectTasks as selectProjectTasks } from "@/lib/tasks";
import { formatDueDateBadge } from "@/lib/dates";
import { softDeleteProject, updateProject } from "@/lib/db";

/** 移动壳与项目面板默认露出的任务条数。 */
const MOBILE_TASK_PREVIEW = 5;

export function ProjectsView() {
  const projects = useAppStore((state) => state.projects);
  const archivedProjects = useAppStore((state) => state.archivedProjects);
  const tags = useAppStore((state) => state.tags);
  const tasks = useAppStore((state) => state.tasks);
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

  /** 引导卡分段条口径：在册项目按有无任务分「进行中 / 未启动」，归档独立一段。 */
  const ongoingProjects = projects.filter((project) => selectProjectTasks(tasks, project.id).length).length;
  const today = useTodayDate();

  /** 行头标签圆点（双端共用）：点色＝标签色（同标签页 tag-card-dot 一档），无标签不打点。
      名字后的标签胶囊已退役——颜色信息由点承载，名字行不再挂徽标。 */
  const projectTagDot = (project: Project) => {
    const tag = tags.find((item) => item.id === project.tag_id);
    if (!tag) return undefined;
    return <span className="tag-card-dot" style={{ background: tag.color }} aria-hidden />;
  };

  /** 项目页桌面顶卡与移动壳引导卡共用的三段实数据，色段口径一致。 */
  const heroSegments = [
    { label: "进行中", value: ongoingProjects, color: "var(--accent-strong)" },
    {
      label: "未启动",
      value: projects.length - ongoingProjects,
      color: "color-mix(in srgb, var(--accent-strong) 45%, transparent)",
    },
    {
      label: "已归档",
      value: archivedProjects.length,
      color: "color-mix(in srgb, var(--text-secondary) 38%, transparent)",
    },
  ];

  /** 行头截止胶囊（桌面专属）：活跃节挂（归档行整行淡出不挂），口径与任务同源。 */
  const projectDueChip = (project: Project) => {
    if (isMobileShell() || !project.due_date) return undefined;
    const due = formatDueDateBadge(project.due_date, today);
    if (due.tone === "none") return undefined;
    return (
      <span className={`due-chip is-${due.tone}`} title={due.title}>
        {due.label}
      </span>
    );
  };

  /**
   * 行尾比率（2026-10-29 起双端同档，移动壳「n 项任务 · 已完成 x」文案串退役）：
   * done/total 金色读数（周脉搏 is-clear 同口径）、零任务描边「未启动」；
   * 移动壳小档见 mobile.css .ratio-chip（与完成戳/日期药丸同族形）。
   */
  const projectRatioChip = (projectTasks: Task[]) => {
    if (!projectTasks.length) {
      return <span className="ratio-chip is-idle">未启动</span>;
    }
    const done = projectTasks.filter((task) => task.status === "completed").length;
    const clear = done === projectTasks.length;
    return (
      <span className={`ratio-chip${clear ? " is-clear" : ""}`}>
        {done}/{projectTasks.length}
      </span>
    );
  };

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

  /** 删除按钮挂在展开行的动作条上，必须删「自己这一行」而不是当前展开项：
      早前移动壳常驻条时代，点收起行的删除时 activeProject 为空会静默无响应。 */
  const deleteProject = async (project: Project) => {
    const ok = await confirmAction({
      title: `将项目「${project.name}」移入回收站？`,
      description: "可在回收站中恢复；项目下的任务会保留。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await softDeleteProject(project.id);
    setActiveProjectId((current) => (current === project.id ? null : current));
    await useAppStore.getState().refreshAll();
    useAppStore.getState().setToast("项目已移入回收站");
  };

  // 桌面悬浮卡：新建/编辑项目收进右上角，点外/Esc 收起（同「新建任务」）。
  useFloatingDismiss(creating, () => setCreating(false));
  useFloatingDismiss(Boolean(editingProject), () => setEditingProject(null));

  return (
    <main className="main-workspace projects-view">
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "项目" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="项目" /> : "项目"}

          </h2>
          <p className="workspace-subtitle">百工居肆以成其事。</p>
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
        {/* 与「今日/足迹」同款的暖色引导框。移动壳换数据型顶卡：三段实数据
            色条（进行中 / 未启动 / 已归档），原 hint 的信息全部升格进 legend。 */}
        {/* 三段实数据（heroSegments）双端共用：移动壳是 MobileGuideCard，桌面沿用
            .today-hero 主题壳（底色/麦穗水印不动），内容换成横向色条 + 图例。 */}
        {isMobileShell() ? (
          <MobileGuideCard
            value={projects.length}
            unit="个"
            label="项目"
            segments={heroSegments}
          />
        ) : (
          <section className="today-hero guide-hero projects-guide">
            <div className="projects-guide-top">
              <p className="today-hero-note">组织长期事项，聚合相关任务。</p>
              <span className="today-hero-meter-count">
                <strong>{projects.length}</strong>
                <span>个 · 项目</span>
              </span>
            </div>
            <div className="projects-hero-bar">
              <div className="projects-hero-track" aria-hidden="true">
                {heroSegments.map(
                  (segment) =>
                    segment.value > 0 && (
                      <i
                        key={segment.label}
                        style={{ flexGrow: segment.value, background: segment.color }}
                      />
                    ),
                )}
              </div>
              <div className="projects-hero-legend">
                {heroSegments.map((segment) => (
                  <span key={segment.label}>
                    <em style={{ background: segment.color }} aria-hidden="true" />
                    {segment.label} {segment.value}
                  </span>
                ))}
              </div>
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
                {!projects.length ? (
                  /* 空态不穿 projects-grid 的白卡：像纪念日页一样直接落在画布上，免得卡中套盒。 */
                  <div className="empty-state anni-empty">
                    <strong>这里还没有项目</strong>
                    <p>同一件事的相关任务，放进同一个项目一起推进。</p>
                    <button className="btn-primary" onClick={openCreate}>创建第一个项目</button>
                  </div>
                ) : inProgress.length ? (
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
                        dot={projectTagDot(project)}
                        title={project.name}
                        meta={projectDueChip(project)}
                        trailing={projectRatioChip(projectTasks)}
                        toggleTitle={on ? "收起该项目" : "查看该项目的任务"}
                        foot={on ? <PanelFoot onEdit={() => beginEditProject(project)} onArchive={() => void archiveProject(project.id)} onDelete={() => void deleteProject(project)} /> : undefined}
                      >
                        <ProjectTaskPanel
                          tasks={projectTasks}
                          tags={tags}
                        />
                      </ExpandRow>
                    );
                  })}
                </div>
                ) : null}
              </section>

              {notStarted.length ? (
                <section aria-label="未开始项目">
                  <div className="section-title-row">
                    <h3>未开始</h3>
                    <span className="tags-filtered-count">{notStarted.length}</span>
                  </div>
                  <div className="projects-grid">
                    {notStarted.map((project) => {
                      const on = activeProjectId === project.id;
                      return (
                        <ExpandRow
                          key={project.id}
                          open={on}
                          onToggle={() => setActiveProjectId(on ? null : project.id)}
                          accent={projectColor(project)}
                          rowId={project.id}
                          dot={projectTagDot(project)}
                          title={project.name}
                          meta={projectDueChip(project)}
                          trailing={projectRatioChip(selectProjectTasks(tasks, project.id))}
                          toggleTitle={on ? "收起该项目" : "查看该项目的任务"}
                          foot={on ? <PanelFoot onEdit={() => beginEditProject(project)} onArchive={() => void archiveProject(project.id)} onDelete={() => void deleteProject(project)} /> : undefined}
                        >
                          {/* 编辑/归档/删除在展开行动作条（双端同构：收起不铺动作）。 */}
                          <ProjectTaskPanel
                            tasks={selectProjectTasks(tasks, project.id)}
                            tags={tags}
                          />
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
            <div className="projects-grid">
              {archivedProjects.map((project) => {
                const projectTasks = selectProjectTasks(tasks, project.id);
                const on = activeProjectId === project.id;
                return (
                  <ExpandRow
                    key={project.id}
                    open={on}
                    className="is-archived"
                    onToggle={() => setActiveProjectId(on ? null : project.id)}
                    accent={projectColor(project)}
                    rowId={project.id}
                    dot={projectTagDot(project)}
                    title={project.name}
                    trailing={projectRatioChip(projectTasks)}
                    toggleTitle={on ? "收起该项目" : "查看该项目的任务"}
                    foot={on ? <PanelFoot archived onRestore={() => void restoreProject(project.id)} onDelete={() => void deleteProject(project)} /> : undefined}
                  >
                    <ProjectTaskPanel
                      tasks={projectTasks}
                      tags={tags}
                    />
                  </ExpandRow>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>

      {creating ? (
        <div className="modal-backdrop floating-backdrop" onMouseDown={() => setCreating(false)}>
          <form
            className="project-edit-modal floating-card"
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
        <div className="modal-backdrop floating-backdrop" onMouseDown={() => setEditingProject(null)}>
          <form
            className="project-edit-modal floating-card"
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

/** 展开在行内的任务面板：任务列表（操作在展开行 foot 动作条，双端只随展开渲染）。 */
function ProjectTaskPanel({
  tasks,
  tags,
}: {
  tasks: ReturnType<typeof useAppStore.getState>["tasks"];
  tags: ReturnType<typeof useAppStore.getState>["tags"];
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  const toggleComplete = useAppStore((s) => s.toggleComplete);
  const tagMap = useAppStore((s) => s.tagMap);
  const { goalById } = useGoals();
  const today = useTodayDate();
  const [showAllTasks, setShowAllTasks] = useState(false);
  const [sheetTask, setSheetTask] = useState<Task | null>(null);
  /* 排序两端同口径（orderTasks）：未完成在前（截止升序、无截止排后、同日按优先级），
     已完成按完成时刻倒序垫后——移动壳预览前 5 条优先露出未完成任务。 */
  const orderTasks = (list: Task[]) =>
    [...list].sort((a, b) => {
      if (a.status === "completed" && b.status !== "completed") return 1;
      if (a.status !== "completed" && b.status === "completed") return -1;
      if (a.status === "completed" && b.status === "completed") {
        return (Date.parse(b.completed_at ?? "") || 0) - (Date.parse(a.completed_at ?? "") || 0);
      }
      const da = a.due_date ?? "9999-12-31";
      const db = b.due_date ?? "9999-12-31";
      if (da !== db) return da < db ? -1 : 1;
      return a.priority - b.priority;
    });
  const sortedTasks = orderTasks(tasks);
  const canToggleAll = sortedTasks.length > MOBILE_TASK_PREVIEW;
  const visibleTasks = showAllTasks
    ? sortedTasks
    : sortedTasks.slice(0, MOBILE_TASK_PREVIEW);

  if (isMobileShell()) {
    /* 移动壳：面板不再嵌第二层 .expand-row-body（桌面那份嵌了两层，内边距被叠了
       两次）；任务行走统一行件的精简档——项目即归属、标签在行首胶囊、目标不标注，
       每行只剩优先级色点 + 标题，与右侧日期、完成圆钮一条线。 */
    return (
      <div className="mrow-panel">
        {sortedTasks.length ? (
          <>
            <ul className="mrow-list">
              {visibleTasks.map((task) => (
                <MobileTaskLine
                  key={task.id}
                  task={task}
                  today={today}
                  projects={[]}
                  tags={tags}
                  tagMap={tagMap}
                  dotInTitle
                  doneStamp
                  onOpen={() => selectTask(task.id)}
                  onComplete={() => void toggleComplete(task.id)}
                  onMore={() => setSheetTask(task)}
                />
              ))}
            </ul>
            {/* 折叠钮沿用记账构成同款通栏文字钮（样式与 .mledger-comp-more
                共享，见 mobile.css 记账节），落在列表截断处。 */}
            {canToggleAll ? (
              <button
                type="button"
                className="mrow-toggle"
                aria-expanded={showAllTasks}
                onClick={() => setShowAllTasks((v) => !v)}
              >
                <span>{showAllTasks ? "收起" : `展开全部 ${sortedTasks.length} 项`}</span>
                <AppIcon name="chevron" size={14} />
              </button>
            ) : null}
          </>
        ) : (
          <p className="expand-row-empty">这个项目还没有挂任务。</p>
        )}
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

  /* 桌面端任务行：图标原子（优先级点 + 完成圆钮）+ 目标徽标 + 截止胶囊，
     行内直接完成。排序走上方 orderTasks（两端同口径：未完成在前，已完成倒序
     内联垫后）——不再做「N 项已完成」折迭（计数与行头比率胶囊 x/x 重复），
     完成态由行上的完成戳 + 勾圈表达。
     标题统一主墨黑（验收口径），完成态不淡出不划线，只由行尾金色圆钮表达。 */
  const taskRow = (task: Task) => {
    const done = task.status === "completed";
    const due = done ? null : formatDueDateBadge(task.due_date, today);
    const stamp = done ? mobileDoneStamp(task.completed_at) : null;
    const goal = task.goal_id ? goalById.get(task.goal_id) : undefined;
    return (
      <div className={`proj-task${done ? " is-done" : ""}`} key={task.id}>
        <i className={`proj-pdot pr${task.priority}`} aria-hidden />
        <button type="button" className="proj-task-title" onClick={() => selectTask(task.id)}>
          {task.title}
        </button>
        {goal ? (
          <span className="goal-chip" style={{ "--goal-color": goal.color } as CSSProperties}>
            {goal.title}
          </span>
        ) : null}
        <span className="proj-task-tail">
          {due && due.tone !== "none" ? (
            <span className={`due-chip is-${due.tone}`} title={due.title}>
              {due.label}
            </span>
          ) : null}
          {stamp ? <span className="done-chip">{stamp} 完成</span> : null}
          <button
            type="button"
            className={`proj-check${done ? " is-done" : ""}`}
            aria-label={done ? `取消完成 ${task.title}` : `完成 ${task.title}`}
            aria-pressed={done}
            onClick={() => void toggleComplete(task.id)}
          />
        </span>
      </div>
    );
  };
  /* ExpandRow 已经把 children 包进它自己的 .expand-row-body——这里不能再套一层
     （两层会把描边任务框叠成双重边框），直接交任务列表本体。 */
  return (
    <>
      <div className="proj-task-list">{orderTasks(tasks).map(taskRow)}</div>
      {!tasks.length ? (
        <p className="expand-row-empty">这个项目还没有挂任务。</p>
      ) : null}
    </>
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
            className="item-action-btn item-action-archive item-action-restore"
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
