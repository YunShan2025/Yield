import { useEffect, useMemo, useRef, useState } from "react";
import type { Goal, Habit, Task } from "@/types";
import {
  createGoal,
  fetchGoals,
  softDeleteGoal,
  updateGoal,
} from "@/lib/db";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import { AppIcon } from "@/components/AppIcon";
import { isMobileShell } from "@/lib/platform";
import { useFloatingDismiss } from "@/lib/floatingDialog";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { ExpandRow } from "@/components/ExpandRow";
import { confirmAction } from "@/components/AppConfirm";
import {
  calculateGoalProgress,
  goalDeadlineInfo,
  resolveGoalTarget,
} from "@/lib/growth";

const COLORS = ["#2F6FED", "#6F83D6", "#3E9B78", "#D7864D", "#C35D77", "#7367A8"];

/** 两个自然日之间相差几天（按本地日历天算，不受时区影响）。 */
function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

function fmtContribution(value: number) {
  return Math.round(value * 100) / 100;
}

/** 截止读数：行头截止 chip、子行读数共用同一句口径（无截止日 = 长期目标）。 */
function goalDeadlineText(info: { daysLeft: number; behind: boolean } | null): string {
  if (!info) return "长期目标";
  const left = info.daysLeft > 0 ? `剩 ${info.daysLeft} 天` : "已到目标日";
  return info.behind ? `进度落后 · ${left}` : left;
}

/**
 * 「目标」独立顶级页（有恒 · 长期方向侧）。两端同构的展开卡流（2026-10-30 乙案）：
 * 行即白卡、点卡就地展开「正在推进」与动作条，与项目/标签/习惯同卡族；
 * 卡片清单 + 详情工作台已退役。只讲目标本身；日常投入与热力图归「足迹」页。
 */
export function GoalsView() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalTitle, setGoalTitle] = useState("");
  // 表单不再有类型与数值口径（migration v29）：新建固定「次」，编辑记住目标
  // 自身的单位，只用来给「目标值」字段挂个名字。
  const [goalUnit, setGoalUnit] = useState("次");
  const [targetValue, setTargetValue] = useState("21");
  const [color, setColor] = useState(COLORS[0]);
  // 命令面板「定位」置标记，展开行渲染到位后把它滚进视口一次。
  const pendingFocusScrollRef = useRef(false);

  const today = todayDateString();
  const allTasks = useAppStore((state) => state.tasks);
  const habits = useAppStore((state) => state.habits);
  const focusRequest = useAppStore((state) => state.focusRequest);
  const saveTask = useAppStore((state) => state.saveTask);
  const setHabitMeasurement = useAppStore((state) => state.setHabitMeasurement);
  const clearFocus = useAppStore((state) => state.clearFocus);

  const refresh = async () => {
    setGoals(await fetchGoals(true));
  };

  // 目标是页内本地状态（不在全局 store），同步拉回对端写入后必须在这里重载，
  // 否则目标页要重开一次才看得到对端的新目标。
  useEffect(() => {
    const reload = () => void refresh();
    void refresh();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 命令面板选中目标后：展开该行并滚进视口（两端同构，含已归档）。
  useEffect(() => {
    if (focusRequest?.kind !== "goal") return;
    pendingFocusScrollRef.current = true;
    setSelectedGoalId(focusRequest.id);
    clearFocus();
    // 归档目标默认不在列表里；补拉一次并合并，保证详情页能正常渲染。
    void fetchGoals(true).then((allGoals) =>
      setGoals((current) => {
        const byId = new Map(allGoals.map((goal) => [goal.id, goal]));
        const merged = current.map((goal) => byId.get(goal.id) ?? goal);
        for (const goal of allGoals) {
          if (!merged.some((item) => item.id === goal.id)) merged.push(goal);
        }
        return merged;
      }),
    );
  }, [focusRequest, clearFocus]);

  const selectedGoal = goals.find((goal) => goal.id === selectedGoalId) ?? null;

  // 定位展开的行渲染到位后滚进视口一次（与项目页同一套路）。
  useEffect(() => {
    if (!selectedGoal || !pendingFocusScrollRef.current) return;
    pendingFocusScrollRef.current = false;
    document
      .querySelector(`[data-expand-row="${selectedGoal.id}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedGoal]);

  const submitGoal = async () => {
    const title = goalTitle.trim();
    if (!title) return;

    try {
      if (editingGoalId) {
        // 只提交表单真正拥有的字段：单位、目标日期、动机保持原值。进度不归
        // 表单管——它只来自推进清单里任务与打卡的计量事件。
        await updateGoal(editingGoalId, {
          title,
          color,
          target_value: Math.max(1, Number(targetValue) || 1),
        });
      } else {
        await createGoal({
          title,
          unit: "次",
          target_value: Math.max(1, Number(targetValue) || 1),
          color,
        });
      }
    } catch (error) {
      // 报错一定要让用户看见：异常被 void 吞掉时弹窗原地不动，看着就像保存坏了。
      useAppStore.getState().setToast(
        `保存失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
      return;
    }
    setGoalTitle("");
    setShowCreate(false);
    setEditingGoalId(null);
    await refresh();
  };

  const openCreateGoal = () => {
    setEditingGoalId(null);
    setGoalTitle("");
    setGoalUnit("次");
    setTargetValue("21");
    setColor(COLORS[0]);
    setShowCreate(true);
  };

  const openGoalEditor = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setGoalTitle(goal.title);
    setGoalUnit(goal.unit);
    setTargetValue(String(goal.target_value));
    setColor(goal.color);
    setShowCreate(true);
  };

  // 桌面悬浮卡：新建/编辑目标收进右上角，点外/Esc 收起（同「新建任务」）。
  useFloatingDismiss(showCreate, () => setShowCreate(false));

  const goalGuide =
    "任务完成与习惯打卡按你声明的计量自动累计；想推进目标，就去「正在推进」里挂上任务或习惯。";
  // 目标列表分区，与项目页 / 习惯页同一套做法：主区放还在进行的，
  // 已完成的自成一区。
  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active" || goal.status === "paused"),
    [goals],
  );
  const finishedGoals = useMemo(
    () => goals.filter((goal) => goal.status === "completed"),
    [goals],
  );

  /* 移动壳引导卡三段（2026-10-30 甲案）：与项目页 heroSegments 同构同色阶。
     读数与「进行中」分区计数同源（active+paused），已完成单列一段；
     落后读数与目标卡截止胶囊同一个真源（goalDeadlineInfo），只数在跑的。 */
  const guideSegments = [
    {
      label: "进行中",
      value: goals.filter((goal) => goal.status === "active").length,
      color: "var(--accent-strong)",
    },
    {
      label: "已暂停",
      value: goals.filter((goal) => goal.status === "paused").length,
      color: "color-mix(in srgb, var(--accent-strong) 45%, transparent)",
    },
    {
      label: "已完成",
      value: finishedGoals.length,
      color: "color-mix(in srgb, var(--text-secondary) 38%, transparent)",
    },
  ];
  const behindCount = goals.filter(
    (goal) => goal.status === "active" && goalDeadlineInfo(goal, today)?.behind,
  ).length;

  /** 删除目标 = 移入回收站，可恢复。 */
  const deleteGoalWithConfirm = async (goal: Goal) => {
    const ok = await confirmAction({
      title: `删除目标「${goal.title}」？`,
      description: "会移入回收站，随时可以恢复。",
      confirmText: "移入回收站",
      danger: true,
    });
    if (!ok) return;
    await softDeleteGoal(goal.id);
    setSelectedGoalId(null);
    await refresh();
  };

  // 正在推进这个目标的任务与习惯（服务关系：它们让目标往前走，但不一定计数）。
  // 展开卡按行取，两端同一个 helper。
  const tasksPushingFor = (goalId: string) =>
    allTasks.filter((task) => task.goal_id === goalId && !task.parent_id && !task.deleted_at);
  const habitsPushingFor = (goalId: string) =>
    habits.filter((habit) => habit.goal_id === goalId && !habit.deleted_at);

  /** 计量切换与状态流转：展开卡上的行内动作，两端共用。 */
  const toggleTaskMeasure = (task: Task) =>
    void saveTask(task.id, { goal_contribution: task.goal_contribution > 0 ? 0 : 1 }).then(
      () => refresh(),
    );
  const toggleHabitMeasure = (habit: Habit) =>
    void setHabitMeasurement(habit.id, habit.goal_contribution > 0 ? 0 : 1).then(() => refresh());
  const setGoalStatus = (goal: Goal, status: Goal["status"]) =>
    void updateGoal(goal.id, { status }).then(() => refresh());

  return (
    <div className="growth-page">
      {/* 与「今日/待办箱」同构的标题区:h2 标题 + 副标题,右侧直达「新建目标」。 */}
      <div className="workspace-top growth-top">
        <div>
          <h2 aria-label={isMobileShell() ? "目标" : undefined}>
            {isMobileShell() ? <MobileTitleChars text="目标" /> : "目标"}
          </h2>
          <p className="workspace-subtitle">把想达成的，变成正在进行的。</p>
        </div>
        <div className="top-controls">
          <button className="btn-primary" type="button" onClick={openCreateGoal}>
            新建目标
          </button>
        </div>
      </div>

      {/* 顶卡双端同族各穿各壳（乙案，2026-10-30）：移动壳是数据型引导卡
          （空页让位给页内 empty-state）；桌面借项目/习惯页的 guide-hero 壳——
          说明 + 衬线读数 → 三段条 + 图例，guideSegments 一份数据双端共用。 */}
      {isMobileShell() ? (
        goals.length ? (
          <MobileGuideCard
            value={activeGoals.length}
            unit="个"
            label="进行中的目标"
            hint={behindCount ? `进度落后 ${behindCount} 个` : undefined}
            segments={guideSegments}
          />
        ) : null
      ) : (
        <section className="today-hero guide-hero goals-guide">
          <div className="projects-guide-top">
            <p className="today-hero-note">{goalGuide}</p>
            <span className="today-hero-meter-count">
              <strong>{goals.length}</strong>
              <span>个 · 目标</span>
            </span>
          </div>
          <div className="projects-hero-bar">
            <div className="projects-hero-track" aria-hidden="true">
              {guideSegments.map(
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
              {guideSegments.map((segment) => (
                <span key={segment.label}>
                  <em style={{ background: segment.color }} aria-hidden="true" />
                  {segment.label} {segment.value}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* 目标清单（两端同构，乙案 2026-10-30）：行即白卡 + 点卡就地展开，手风琴
          单展开；桌面皮肤同项目/标签/习惯卡族（components.css），移动壳档见 mobile.css。 */}
      <div className="goals-list">
        <section aria-label="进行中的目标">
          <div className="section-title-row">
            <h3>进行中</h3>
            <span className="tags-filtered-count">{activeGoals.length}</span>
          </div>
          {activeGoals.length ? (
            <div className="goals-rows">
              {activeGoals.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  today={today}
                  open={selectedGoalId === goal.id}
                  onToggle={() =>
                    setSelectedGoalId(selectedGoalId === goal.id ? null : goal.id)
                  }
                  pushingTasks={tasksPushingFor(goal.id)}
                  pushingHabits={habitsPushingFor(goal.id)}
                  onEdit={() => openGoalEditor(goal)}
                  onToggleStatus={() =>
                    setGoalStatus(goal, goal.status === "paused" ? "active" : "paused")
                  }
                  onComplete={() => setGoalStatus(goal, "completed")}
                  onDelete={() => void deleteGoalWithConfirm(goal)}
                  onTaskMeasure={toggleTaskMeasure}
                  onHabitMeasure={toggleHabitMeasure}
                />
              ))}
            </div>
          ) : (
            /* 空态不套白卡：与项目/纪念日页同款，直接落在画布上。 */
            <div className="empty-state anni-empty">
              <strong>这里还没有目标</strong>
              <p>把想达成的结果立起来，日常的任务与打卡会自动汇成进度。</p>
              <button className="btn-primary" type="button" onClick={openCreateGoal}>
                创建第一个目标
              </button>
            </div>
          )}
        </section>
        {finishedGoals.length ? (
          <section aria-label="已完成的目标">
            <div className="section-title-row">
              <h3>已完成</h3>
              <span className="tags-filtered-count">{finishedGoals.length}</span>
            </div>
            <div className="goals-rows">
              {finishedGoals.map((goal) => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  today={today}
                  finished
                  open={selectedGoalId === goal.id}
                  onToggle={() =>
                    setSelectedGoalId(selectedGoalId === goal.id ? null : goal.id)
                  }
                  pushingTasks={tasksPushingFor(goal.id)}
                  pushingHabits={habitsPushingFor(goal.id)}
                  onEdit={() => openGoalEditor(goal)}
                  onToggleStatus={() =>
                    setGoalStatus(goal, goal.status === "paused" ? "active" : "paused")
                  }
                  onComplete={() => setGoalStatus(goal, "completed")}
                  onDelete={() => void deleteGoalWithConfirm(goal)}
                  onTaskMeasure={toggleTaskMeasure}
                  onHabitMeasure={toggleHabitMeasure}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {showCreate ? (
        <div className="modal-backdrop floating-backdrop" onMouseDown={() => setShowCreate(false)}>
          <div className="goal-create-modal floating-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>{editingGoalId ? "编辑目标" : "新建目标"}</h3>
                <p className="goal-create-sub">任务和习惯会自动累计到这里，填三项就能开始。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <label>目标名称<input autoFocus value={goalTitle} placeholder="想达成什么结果？例如「读完 21 本书」" onChange={(event) => setGoalTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitGoal(); }} /></label>
            <div className="goal-form-grid">
              <label>
                目标值（{goalUnit}）
                <input type="number" min="1" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
              </label>

              <div className="goal-form-color">
                <span>标记颜色</span>
                <div className="goal-color-picker">
                  {COLORS.map((item) => (
                    <button key={item} type="button" aria-label={`标记颜色 ${item}`} className={color === item ? "active" : ""} style={{ background: item }} onClick={() => setColor(item)} />
                  ))}
                </div>
              </div>
            </div>
            <p className="goal-guide"><AppIcon name="sparkle" size={14} /><span>{goalGuide}</span></p>
            <div className="goal-create-actions">
              <button type="button" className="btn-ghost item-action-btn" onClick={() => setShowCreate(false)}>取消</button>
              <button type="button" className="btn-primary item-action-btn item-action-primary" disabled={!goalTitle.trim()} onClick={() => void submitGoal()}>{editingGoalId ? "保存修改" : "新建目标"}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* 目标展开卡（2026-10-30 乙案，两端共用）：行即白卡 + 点卡就地展开，与项目/标签/
   习惯同卡族。折叠＝标题行（色点 / 名称 / 状态 chip / 读数）＋子行——桌面只留
   一条细进度条、移动壳保留进度条 + 累计与截止读数；展开＝正在推进清单
   （计量就地切换）＋动作条。进度与今日页目标条同一真源。 */
function GoalRow({
  goal,
  today,
  open,
  onToggle,
  pushingTasks,
  pushingHabits,
  onEdit,
  onToggleStatus,
  onComplete,
  onDelete,
  onTaskMeasure,
  onHabitMeasure,
  finished = false,
}: {
  goal: Goal;
  today: string;
  open: boolean;
  onToggle: () => void;
  pushingTasks: Task[];
  pushingHabits: Habit[];
  onEdit: () => void;
  onToggleStatus: () => void;
  onComplete: () => void;
  onDelete: () => void;
  onTaskMeasure: (task: Task) => void;
  onHabitMeasure: (habit: Habit) => void;
  /** 已完成分区传入：桌面整行淡出（hover/展开回全显），同归档行观感。 */
  finished?: boolean;
}) {
  const mobile = isMobileShell();
  const target = resolveGoalTarget(goal);
  const progress = calculateGoalProgress(goal);
  const deadline = goalDeadlineInfo(goal, today);
  const running = goal.status === "active" || goal.status === "paused";
  const pushingCount = pushingTasks.length + pushingHabits.length;
  /* 桌面行尾比率（同项目页 ratio-chip）：n/m 灰底，全达成暖金、零进度描边。 */
  const ratioTone =
    finished || goal.current_value >= target.value
      ? " is-clear"
      : goal.current_value <= 0
        ? " is-idle"
        : "";
  const bar = (
    <div className="goal-progress-track">
      <i style={{ width: `${progress}%`, background: goal.color }} />
    </div>
  );
  const meta = (
    <>
      {goal.status === "paused" ? <span className="goal-paused-chip">已暂停</span> : null}
      {/* 桌面截止胶囊：色阶同任务页 due-chip（落后=overdue 红、正常=soon 蓝）。 */}
      {!mobile ? (
        <span
          className={`due-chip ${!deadline ? "is-none" : deadline.behind ? "is-overdue" : "is-soon"}`}
        >
          {goalDeadlineText(deadline)}
        </span>
      ) : null}
    </>
  );
  return (
    <ExpandRow
      open={open}
      onToggle={onToggle}
      accent={goal.color}
      rowId={goal.id}
      dot={<span className="tag-card-dot" style={{ background: goal.color }} aria-hidden />}
      title={goal.title}
      className={finished ? "is-finished" : undefined}
      meta={meta}
      trailing={
        mobile ? (
          <span className="goal-row-pct">{Math.round(progress)}%</span>
        ) : (
          <span className={`ratio-chip${ratioTone}`}>
            {fmtContribution(goal.current_value)}/{fmtContribution(target.value)}
          </span>
        )
      }
      toggleTitle={open ? "收起该目标" : "查看正在推进该目标的任务与习惯"}
      subline={
        /* 子行＝卡片第二层常驻内容，空白处点按=展开（同习惯卡规约，内部无交互件）。
           桌面（乙案）只留一条细进度条，读数全在行头；移动壳保留进度条+读数行。 */
        <div className={`mgoal-sub${mobile ? "" : " is-plain"}`} role="presentation" onClick={onToggle}>
          {bar}
          {mobile ? (
            <div className="mgoal-nums">
              <b>{fmtContribution(goal.current_value)}{target.unit}</b>
              <span>/ {fmtContribution(target.value)}{target.unit}</span>
              <em className={deadline?.behind ? "is-behind" : undefined}>{goalDeadlineText(deadline)}</em>
            </div>
          ) : null}
        </div>
      }
      foot={
        open ? (
          /* 动作条两端各穿各壳：移动壳两格一排的网格（上排编辑·暂停，底排完成·删除）；
             桌面同 PanelFoot 右对齐一行。颜色语义两端一致：完成=蓝主钮、删除=红衬示警。 */
          <div className="expand-row-foot goal-foot">
            <button type="button" className="item-action-btn item-action-edit" onClick={onEdit}>
              <AppIcon name="edit" size={14} />
              <span>编辑</span>
            </button>
            {running ? (
              <button type="button" className="item-action-btn" onClick={onToggleStatus}>
                <AppIcon name={goal.status === "paused" ? "play" : "pause"} size={14} />
                <span>{goal.status === "paused" ? "继续目标" : "暂停"}</span>
              </button>
            ) : null}
            {running ? (
              <button
                type="button"
                className="item-action-btn goal-act-done"
                onClick={onComplete}
              >
                <AppIcon name="check" size={14} />
                <span>完成</span>
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
        ) : undefined
      }
    >
      <div className="goal-section-head">
        <span>正在推进</span>
        <b>{pushingCount}</b>
      </div>
      {pushingCount ? (
        <ul className="goal-push-list">
          {pushingTasks.map((task) => (
            <li key={task.id}>
              <span className="goal-push-kind">
                <i style={{ background: goal.color }} />
                任务
              </span>
              <span className="goal-push-title">{task.title}</span>
              <em
                className={
                  task.status === "completed"
                    ? "is-done"
                    : task.due_date && task.due_date < today
                      ? "is-overdue"
                      : undefined
                }
              >
                {task.status === "completed"
                  ? "已完成"
                  : task.due_date
                    ? task.due_date < today
                      ? `逾期 ${daysBetween(task.due_date, today)} 天`
                      : task.due_date
                    : "无截止日"}
              </em>
              <button
                type="button"
                className={`goal-push-measure${task.goal_contribution > 0 ? " is-on" : ""}`}
                title="切换这项是否给目标计数"
                onClick={() => onTaskMeasure(task)}
              >
                {task.goal_contribution > 0 ? (
                  <>
                    <AppIcon name="check" size={11} />
                    计入
                  </>
                ) : (
                  "只关联"
                )}
              </button>
            </li>
          ))}
          {pushingHabits.map((habit) => (
            <li key={habit.id}>
              <span className="goal-push-kind">
                <i />
                习惯
              </span>
              <span className="goal-push-title">{habit.title}</span>
              <em>{habit.archived ? "已归档" : "每周进行"}</em>
              <button
                type="button"
                className={`goal-push-measure${habit.goal_contribution > 0 ? " is-on" : ""}`}
                title="切换这次打卡是否给目标计数"
                onClick={() => onHabitMeasure(habit)}
              >
                {habit.goal_contribution > 0 ? (
                  <>
                    <AppIcon name="check" size={11} />
                    计入
                  </>
                ) : (
                  "只关联"
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="goal-empty">
          还没有任务或习惯在推进这个目标。把日常动作关联上来，进度会自己长。
        </p>
      )}
    </ExpandRow>
  );
}
