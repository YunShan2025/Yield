import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Goal } from "@/types";
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
import { confirmAction } from "@/components/AppConfirm";
import {
  calculateGoalProgress,
  goalDeadlineInfo,
  resolveGoalTarget,
} from "@/lib/growth";

const COLORS = ["#2F6FED", "#6F83D6", "#3E9B78", "#D7864D", "#C35D77", "#7367A8"];
const GOAL_STATUS_LABEL: Record<Goal["status"], string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
};

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

/** 目标详情标题下的一行摘要：动机输入框已下线，这里改用目标自身的进度语义。 */
function goalHeroSummary(goal: Goal) {
  const target = resolveGoalTarget(goal);
  return `累计 ${fmtContribution(goal.current_value)}${goal.unit} / ${fmtContribution(target.value)}${goal.unit}`;
}

/** 截止读数：目标卡、桌面顶卡、移动壳顶卡共用同一句口径（无截止日 = 长期目标）。 */
function goalDeadlineText(info: { daysLeft: number; behind: boolean } | null): string {
  if (!info) return "长期目标";
  const left = info.daysLeft > 0 ? `剩 ${info.daysLeft} 天` : "已到目标日";
  return info.behind ? `进度落后 · ${left}` : left;
}

/**
 * 「目标」独立顶级页（有恒 · 长期方向侧）。承袭原成长页的 goals 页签：
 * 卡片清单 + 详情同屏工作台，改一个目标的进度时仍看得见别的目标在什么位置。
 * 只讲目标本身；日常投入与热力图归「足迹」页。
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

  // 命令面板选中目标后：打开该目标详情（含已归档）。
  useEffect(() => {
    if (focusRequest?.kind !== "goal") return;
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
  /* 移动壳详情顶卡：进度条收进卡内、截止与卡/桌面顶卡同口径，进度这里只算一次。 */
  const mobileHeroProgress = selectedGoal ? calculateGoalProgress(selectedGoal) : 0;
  const mobileHeroDeadline = selectedGoal ? goalDeadlineInfo(selectedGoal, today) : null;

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
  const pushingTasks = selectedGoal
    ? allTasks.filter(
        (task) =>
          task.goal_id === selectedGoal.id && !task.parent_id && !task.deleted_at,
      )
    : [];
  const pushingHabits = selectedGoal
    ? habits.filter((habit) => habit.goal_id === selectedGoal.id && !habit.deleted_at)
    : [];

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

      {/* 目标工作台：清单与详情同屏，改一个目标的进度时还看得见别的目标在什么位置，
          不必再「点进去 → 返回列表」来回跳。移动壳仍是钻入（CSS 用 has-detail 切两栏）。
          DOM 是详情在前、清单在后，桌面用 grid-column 把清单摆回左边。 */}
      <section className={`goal-workbench${selectedGoal ? " has-detail" : ""}`}>
        <div className="goal-workbench-detail">
          {selectedGoal ? (
            <section className="goal-detail">
              <button className="text-btn" onClick={() => setSelectedGoalId(null)}>← 返回目标列表</button>
              {/* 详情顶卡两端信息集统一（状态 / 截止 / 标题 / 摘要 / 进度条带 %，截止读数
                  与目标卡同源一个真源），版式各随各壳：移动壳淡蓝顶卡横排读数，桌面工作台
                  竖排大字。进度条两端都收在卡内。 */}
              {isMobileShell() ? (
                <div className="goal-detail-hero" style={{ "--goal-color": selectedGoal.color } as CSSProperties}>
                  <div>
                    <span>{GOAL_STATUS_LABEL[selectedGoal.status]}</span>
                    <em className={`goal-hero-deadline${mobileHeroDeadline?.behind ? " is-behind" : ""}`}>· {goalDeadlineText(mobileHeroDeadline)}</em>
                    <h2>{selectedGoal.title}</h2>
                    <p>{selectedGoal.motivation || goalHeroSummary(selectedGoal)}</p>
                  </div>
                  <strong>{Math.round(mobileHeroProgress)}%</strong>
                  <div className="goal-progress-track"><i style={{ width: `${mobileHeroProgress}%`, background: selectedGoal.color }} /></div>
                </div>
              ) : (
                <GoalDetailHero goal={selectedGoal} />
              )}
              {/* 正在推进：关联的任务与习惯。 */}
              <section className="goal-pushing">
                <div className="goal-section-head">
                  <span>正在推进</span>
                  <b>{pushingTasks.length + pushingHabits.length}</b>
                </div>
                {pushingTasks.length || pushingHabits.length ? (
                  <ul className="goal-push-list">
                    {pushingTasks.map((task) => (
                      <li key={task.id}>
                        <span className="goal-push-kind">
                          <i style={{ background: selectedGoal.color }} />
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
                          onClick={() =>
                            void saveTask(task.id, {
                              goal_contribution: task.goal_contribution > 0 ? 0 : 1,
                            }).then(() => refresh())
                          }
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
                          onClick={() =>
                            void setHabitMeasurement(
                              habit.id,
                              habit.goal_contribution > 0 ? 0 : 1,
                            ).then(() => refresh())
                          }
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
              </section>

              {/* 动作分级：状态管理靠左成组（编辑 → 暂停），完成=应用内蓝主钮
                  （item-action-primary）与删除一起靠右、隔开；删除仍钉行尾警示
                  ——桌面 danger ghost。移动壳分两排（见 mobile.css，manage-group
                  display:contents 让按钮各自落行，DOM 顺序不变）：上排日常状态，
                  底排「完成=蓝主钮 + 删除=红衬」。已达成只剩编辑与删除。 */}
              <div className="goal-detail-actions">
                <div className="goal-manage-group">
                  <button className="item-action-btn" onClick={() => openGoalEditor(selectedGoal)}>编辑</button>
                  {["active", "paused"].includes(selectedGoal.status) ? <button className="item-action-btn" onClick={() => void updateGoal(selectedGoal.id, { status: selectedGoal.status === "paused" ? "active" : "paused" }).then(() => refresh())}>{selectedGoal.status === "paused" ? "继续目标" : "暂停"}</button> : null}
                </div>
                {["active", "paused"].includes(selectedGoal.status) ? <button className="item-action-btn item-action-primary goal-act-done" onClick={() => void updateGoal(selectedGoal.id, { status: "completed" }).then(() => refresh())}>完成</button> : null}
                <button className="item-action-btn goal-action-remove" onClick={() => void deleteGoalWithConfirm(selectedGoal)}>
                  {isMobileShell() ? "删除" : "删除目标"}
                </button>
              </div>
            </section>
          ) : (
            <div className="goal-workbench-empty">
              <strong>左边选一个目标</strong>
              <p>推进它的任务与习惯、计入与否，都在这一栏里改。</p>
              <button className="item-action-btn" type="button" onClick={openCreateGoal}>新建目标</button>
            </div>
          )}
        </div>
        <div className="goal-workbench-list">
          <section aria-label="进行中的目标">
            <div className="section-title-row">
              <h3>进行中</h3>
              <span className="tags-filtered-count">{activeGoals.length}</span>
            </div>
            <div className="goal-grid">
              {activeGoals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} selected={selectedGoalId === goal.id} onOpen={() => setSelectedGoalId(goal.id)} />
              ))}
              {!activeGoals.length ? (
                <div className="empty-state">
                  创建第一个长期目标，让每天的任务有更清晰的方向。
                </div>
              ) : null}
            </div>
          </section>
          {finishedGoals.length ? (
            <section aria-label="已完成的目标">
              <div className="section-title-row">
                <h3>已完成</h3>
                <span className="tags-filtered-count">{finishedGoals.length}</span>
              </div>
              <div className="goal-grid">
                {finishedGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} selected={selectedGoalId === goal.id} onOpen={() => setSelectedGoalId(goal.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </section>

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

function GoalCard({
  goal,
  onOpen,
  selected = false,
}: {
  goal: Goal;
  onOpen: () => void;
  /** 工作台的清单里标出「右边详情正在看哪个目标」；其它地方不传，行为不变。 */
  selected?: boolean;
}) {
  // 分母与进度走 growth 的唯一真源：目标卡、今日目标条、目标页显示同一组数字。
  const target = resolveGoalTarget(goal);
  const progress = calculateGoalProgress(goal);
  const deadline = goalDeadlineInfo(goal, todayDateString());
  const finished = goal.status === "completed";
  return (
    <button
      className={`goal-card${finished ? " is-finished" : ""}${selected ? " is-sel" : ""}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      {/* 卡片待在哪个分区就说哪个状态：只有「已暂停」需要额外一个字——
          它混在进行中列表里，不标就看不出来。 */}
      {goal.status === "paused" ? (
        <div className="goal-card-head">
          <span className="goal-card-chip" style={{ "--goal-color": goal.color } as CSSProperties}>
            <i style={{ background: goal.color }} />
            {GOAL_STATUS_LABEL[goal.status]}
          </span>
        </div>
      ) : null}
      <h3>{goal.title}</h3>
      <p>
        <b>{fmtContribution(goal.current_value)}{target.unit}</b> / {fmtContribution(target.value)}{target.unit}
      </p>
      <div className="goal-card-progress">
        <div className="goal-progress-track"><i style={{ width: `${progress}%`, background: goal.color }} /></div>
        <b>{Math.round(progress)}%</b>
      </div>
      <footer>
        <span className={deadline?.behind ? "is-behind" : undefined}>{goalDeadlineText(deadline)}</span>
      </footer>
    </button>
  );
}

/* 桌面工作台的详情顶卡：状态点 + 截止 → 标题 + 当前/目标大字 → 进度条带 %。
   移动壳走旧结构（同文件上面的 isMobileShell 分支），这里只在桌面渲染。
   大字用 --font-display 与读数条同族——衬线 --font-num-display 一屏最多一处，留给顶卡。 */
function GoalDetailHero({ goal }: { goal: Goal }) {
  const target = resolveGoalTarget(goal);
  const progress = calculateGoalProgress(goal);
  const deadline = goalDeadlineInfo(goal, todayDateString());
  return (
    <div className="goal-detail-hero is-workbench" style={{ "--goal-color": goal.color } as CSSProperties}>
      <div className="goal-hero-top">
        <span className="goal-hero-status">
          <i style={{ background: goal.color }} />
          {GOAL_STATUS_LABEL[goal.status]}
        </span>
        <span className={`goal-hero-deadline${deadline?.behind ? " is-behind" : ""}`}>{goalDeadlineText(deadline)}</span>
      </div>
      <div className="goal-hero-main">
        <h2>{goal.title}</h2>
        <div className="goal-hero-count">
          <strong>{fmtContribution(goal.current_value)}</strong>
          <span>
            / {fmtContribution(target.value)} {target.unit}
          </span>
        </div>
      </div>
      {goal.motivation ? <p className="goal-hero-motivation">{goal.motivation}</p> : null}
      <div className="goal-hero-progress">
        <div className="goal-progress-track">
          <i style={{ width: `${progress}%`, background: goal.color }} />
        </div>
        <b>{Math.round(progress)}%</b>
      </div>
    </div>
  );
}
