import { useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { confirmAction } from "@/components/AppConfirm";
import { filterTasksByView } from "@/lib/tasks";
import { formatDueDateBadge } from "@/lib/dates";
import { AppIcon } from "@/components/AppIcon";
import { DesktopGuideCard } from "@/components/DesktopGuideCard";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { MobileTaskLine, mobileDoneStamp } from "@/components/mobile/MobileTaskLine";
import { MobileTaskRow } from "@/components/mobile/MobileTaskRow";
import { TaskActionSheet } from "@/components/mobile/TaskActionSheet";
import { useTodayDate } from "@/lib/useTodayDate";
import { isMobileShell } from "@/lib/platform";
import { useFloatingDismiss } from "@/lib/floatingDialog";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { ExpandRow } from "@/components/ExpandRow";
import type { Tag, Task } from "@/types";

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
  const setNav = useAppStore((s) => s.setNav);
  const requestFocus = useAppStore((s) => s.requestFocus);
  const today = useTodayDate();
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createColor, setCreateColor] = useState(COLOR_SWATCHES[0]);
  const [savingCreate, setSavingCreate] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [sheetTask, setSheetTask] = useState<Task | null>(null);

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

  // 顶卡使用分布（两端共用，2026-10-31 桌面引导框升卡从移动 JSX 抽出）：
  // 使用度 = 项目数 + 无归属任务数，去零取 Top-4。
  const tagSegments = tags
    .map((tag, index) => ({
      label: tag.name,
      value: (counts[tag.id]?.projects ?? 0) + (counts[tag.id]?.tasks ?? 0),
      color: tag.color || TAG_PALETTE[index % TAG_PALETTE.length],
    }))
    .filter((segment) => segment.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  // 每个标签下的项目与任务，展开哪一行就直接取哪一行。
  const tagDetails = useMemo(() => {
    const map = new Map<
      string,
      {
        projects: ReturnType<typeof useAppStore.getState>["projects"];
        tasks: ReturnType<typeof useAppStore.getState>["tasks"];
      }
    >();
    for (const tag of tags) {
      map.set(tag.id, {
        projects: projects.filter((project) => project.tag_id === tag.id),
        tasks: filterTasksByView(tasks, "tags", tagMap, tag.id).filter(
          (task) => !task.project_id,
        ),
      });
    }
    return map;
  }, [tags, projects, tasks, tagMap]);

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

  // 桌面悬浮卡：新建/编辑标签收进右上角，点外/Esc 收起（同「新建任务」）。
  useFloatingDismiss(creating, () => setCreating(false));
  useFloatingDismiss(Boolean(editingTag), () => setEditingTag(null));

  return (
    <main className="main-workspace tags-view">
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "标签" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="标签" /> : "标签"}

          </h2>
          <p className="workspace-subtitle">把散落的事，按线归拢。</p>
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
      {/* 与「今日」同款的暖色引导框已升淡蓝数据顶卡：读数 + 标签使用分布，
          使用度 Top-4 一份数据双端共用。 */}
      {isMobileShell() ? (
        <MobileGuideCard
          value={tags.length}
          unit="个"
          label="标签"
          segments={tagSegments}
        />
      ) : (
        <DesktopGuideCard
          value={tags.length}
          unit="个"
          label="标签"
          segments={tagSegments}
          note="给项目与任务分类打标，周报页的任务分类色也按同名标签自动落位。"
        />
      )}
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
                const color = tag.color || TAG_PALETTE[index % TAG_PALETTE.length];
                const detail = tagDetails.get(tag.id);
                const detailProjects = detail?.projects ?? [];
                const detailTasks = detail?.tasks ?? [];
                /* 编辑/删除钮组：双端统一，只随展开行渲染进行底动作条
                   （与项目页 PanelFoot 同形态，收起不铺动作；
                   桌面旧「行头常驻钮」随 2026-10 卡片化退役）。 */
                const actionBtns = (
                      <>
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
                          className="item-action-btn item-action-danger quiet-danger"
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
                      </>
                );
                return (
                  <ExpandRow
                    key={tag.id}
                    open={on}
                    onToggle={() => setActiveTag(on ? null : tag.id)}
                    accent={color}
                    rowId={tag.id}
                    dot={<span className="tag-card-dot" style={{ background: color }} aria-hidden />}
                    title={tag.name}
                    trailing={countText}
                    toggleTitle={on ? "收起该标签" : "查看该标签下的项目与任务"}
                    foot={on ? <div className="expand-row-foot">{actionBtns}</div> : undefined}
                  >
                    {isMobileShell() ? (
                      <>
                        {detailProjects.length ? (
                          <>
                            <div className="mrow-section">项目</div>
                            <ul className="mrow-list">
                              {detailProjects.map((project) => {
                                const projectTasks = tasks.filter(
                                  (task) =>
                                    task.project_id === project.id && !task.deleted_at,
                                );
                                /* 色块统一走优先级语义：取项目下未完成任务的最高优先级，全部完成回落 P3。 */
                                const topPriority = projectTasks.reduce(
                                  (best, task) =>
                                    task.status !== "completed"
                                      ? Math.min(best, task.priority)
                                      : best,
                                  3,
                                );
                                return (
                                  <MobileTaskRow
                                    key={project.id}
                                    className="mrow mrow-plain"
                                    label={`${project.name}，${projectTasks.length} 项任务`}
                                    /* 项目行没有任务级操作：长按无意义；点行去项目页定位。 */
                                    pressEnabled={false}
                                    onActivate={() => {
                                      setNav("projects");
                                      requestFocus({ kind: "project", id: project.id });
                                    }}
                                    onLongPress={() => {}}
                                  >
                                    <i className={`minbox-pdot pr${topPriority}`} aria-hidden="true" />
                                    <span className="mrow-main">
                                      <span className="mrow-title">{project.name}</span>
                                    </span>
                                    <span className="mrow-tail">{projectTasks.length} 项</span>
                                  </MobileTaskRow>
                                );
                              })}
                            </ul>
                          </>
                        ) : null}
                        {detailTasks.length ? (
                          <>
                            <div className="mrow-section">任务</div>
                            <ul className="mrow-list">
                              {detailTasks.map((task) => (
                                <MobileTaskLine
                                  key={task.id}
                                  task={task}
                                  today={today}
                                  projects={projects}
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
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        {detailProjects.length ? (
                          <div className="tags-project-section">
                            <h4>项目</h4>
                            <div className="tags-project-list">
                              {detailProjects.map((project) => {
                                const projectTasks = tasks.filter(
                                  (task) => task.project_id === project.id && !task.deleted_at,
                                );
                                /* 色点与移动壳同口径：未完成任务的最高优先级，全完成回落 P3。 */
                                const topPriority = projectTasks.reduce(
                                  (best, task) =>
                                    task.status !== "completed"
                                      ? Math.min(best, task.priority)
                                      : best,
                                  3,
                                );
                                return (
                                  <div className="proj-task" key={project.id}>
                                    <i className={`proj-pdot pr${topPriority}`} aria-hidden />
                                    <button
                                      type="button"
                                      className="proj-task-title"
                                      title="到项目页定位该项目"
                                      onClick={() => {
                                        setNav("projects");
                                        requestFocus({ kind: "project", id: project.id });
                                      }}
                                    >
                                      {project.name}
                                    </button>
                                    <span className="proj-task-tail">{projectTasks.length} 项</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {/* 桌面描边框里项目/任务两节之间铺一条发丝线，与框内行分割同规格。 */}
                        {detailProjects.length && detailTasks.length ? (
                          <div className="tags-section-divider" aria-hidden="true" />
                        ) : null}
                        {detailTasks.length ? (
                          <div className="tags-task-section">
                            <h4>任务</h4>
                            <div className="tags-task-list">
                              {detailTasks.map((task) => {
                                /* 任务行走项目页同一族原子：色点 + 主墨标题 + 截止/完成胶囊 +
                                   成就金圆钮；完成态金色只落在勾圈与完成戳上，不铺整行金底。 */
                                const done = task.status === "completed";
                                const due = done ? null : formatDueDateBadge(task.due_date, today);
                                const stamp = done ? mobileDoneStamp(task.completed_at) : null;
                                return (
                                  <div className={`proj-task${done ? " is-done" : ""}`} key={task.id}>
                                    <i className={`proj-pdot pr${task.priority}`} aria-hidden />
                                    <button
                                      type="button"
                                      className="proj-task-title"
                                      onClick={() => selectTask(task.id)}
                                    >
                                      {task.title}
                                    </button>
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
                              })}
                            </div>
                          </div>
                        ) : null}
                      </>
                    )}
                    {!detailProjects.length && !detailTasks.length ? (
                      <div className="tags-filtered-empty">
                        该标签下暂无项目或独立任务。新建项目时可选择标签；未归属项目的任务也可在详情里打上「{tag.name}」。
                      </div>
                    ) : null}
                  </ExpandRow>
                );
              })}
            </div>
          ) : isMobileShell() ? (
            /* 移动壳页级空态：anni-empty 两行壳（与备忘/纪念日/回收站同族）。 */
            <div className="empty-state anni-empty">
              <strong>还没有标签</strong>
              <p>在上方输入名称，创建第一个标签。</p>
            </div>
          ) : (
            <div className="empty-state">
              还没有标签。在上方输入名称，创建第一个标签。
            </div>
          )}
        </section>

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
                <h3>新建标签</h3>
              </div>
              <button type="button" className="icon-btn" onClick={() => setCreating(false)}>×</button>
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
        <div className="modal-backdrop floating-backdrop" onMouseDown={() => setEditingTag(null)}>
          <form
            className="project-edit-modal floating-card"
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
              <button type="button" className="icon-btn" onClick={() => setEditingTag(null)}>×</button>
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

      {sheetTask ? (
        <TaskActionSheet
          task={sheetTask}
          cursor={today}
          onClose={() => setSheetTask(null)}
        />
      ) : null}
    </main>
  );
}
