import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Achievement, Goal, GoalEntry, GoalMilestone, GoalType, Task } from "@/types";
import {
  createAchievement,
  createGoal,
  createGoalMilestone,
  deleteGoalMilestone,
  fetchAchievements,
  fetchGoalEntries,
  fetchGoalMilestones,
  fetchGoals,
  setGoalCurrentProgress,
  softDeleteGoal,
  setGoalMilestoneCompleted,
  toggleAchievementPinned,
  updateGoal,
} from "@/lib/db";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import { SelectMenu } from "@/components/SelectMenu";
import { AppIcon } from "@/components/AppIcon";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { confirmAction } from "@/components/AppConfirm";import {
  activityLevelFromValue,
  calculateGoalProgress,
  currentDateStreak,
  goalDeadlineInfo,
  localDateKey,
  longestDateStreak,
  resolveGoalTarget,
} from "@/lib/growth";

type GrowthTab = "overview" | "goals" | "achievements";

const COLORS = ["#2F6FED", "#6F83D6", "#3E9B78", "#D7864D", "#C35D77", "#7367A8"];
const GOAL_STATUS_LABEL: Record<Goal["status"], string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  abandoned: "已放弃",
};

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fmtContribution(value: number) {
  return Math.round(value * 100) / 100;
}

/** 两个自然日之间相差几天（按本地日历天算，不受时区影响）。 */
function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T12:00:00`).getTime();
  const end = new Date(`${to}T12:00:00`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

/** 目标详情标题下的一行摘要：动机输入框已下线，这里改用目标自身的进度语义。 */
function goalHeroSummary(goal: Goal) {
  if (goal.goal_type === "measure") {
    return `从 ${fmtContribution(goal.start_value)}${goal.unit} 到 ${fmtContribution(goal.target_value)}${goal.unit}，以最近一次记录为准`;
  }
  const target = resolveGoalTarget(goal);
  if (goal.goal_type === "staged") {
    return `阶段进度 ${fmtContribution(goal.current_value)}/${fmtContribution(target.value)} 个阶段`;
  }
  return `累计 ${fmtContribution(goal.current_value)}${goal.unit} / ${fmtContribution(target.value)}${goal.unit}`;
}

function dayRange() {
  // 最近半年：26 整周（周日起步）× 7 天 = 182 格，列优先排布（每列一周），
  // 桌面与手机同一数量。
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(today.getDate() - 175 - today.getDay());
  return Array.from({ length: 182 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function GrowthView() {
  const [tab, setTab] = useState<GrowthTab>("overview");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [entries, setEntries] = useState<GoalEntry[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [filterGoalId, setFilterGoalId] = useState("");
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalTitle, setGoalTitle] = useState("");
  // 表单不再让用户选目标类型/单位：新建一律「累计数量 · 次」；编辑时记住目标
  // 自身的类型与单位，只用来决定显示哪些字段、字段叫什么名字。
  const [goalKind, setGoalKind] = useState<GoalType>("milestone");
  const [goalUnit, setGoalUnit] = useState("次");
  const [targetValue, setTargetValue] = useState("21");
  const [startValue, setStartValue] = useState("0");
  const [color, setColor] = useState(COLORS[0]);
  const [achievementTitle, setAchievementTitle] = useState("");
  const [milestones, setMilestones] = useState<GoalMilestone[]>([]);

  const today = todayDateString();
  const [stageTitle, setStageTitle] = useState("");
  const allTasks = useAppStore((state) => state.tasks);
  const habits = useAppStore((state) => state.habits);
  const archivedHabits = useAppStore((state) => state.archivedHabits);
  const habitChecks = useAppStore((state) => state.habitChecks);
  const focusRequest = useAppStore((state) => state.focusRequest);
  const saveTask = useAppStore((state) => state.saveTask);
  const setHabitMeasurement = useAppStore((state) => state.setHabitMeasurement);  const clearFocus = useAppStore((state) => state.clearFocus);

  // 选中目标时载入它的阶段清单（阶段型目标的进度刻度）。
  useEffect(() => {
    if (!selectedGoalId) {
      setMilestones([]);
      return;
    }
    let cancelled = false;
    void fetchGoalMilestones(selectedGoalId).then((rows) => {
      if (!cancelled) setMilestones(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedGoalId, goals]);

  const refresh = async () => {
    const [nextGoals, nextEntries, nextAchievements] = await Promise.all([
      fetchGoals(true),
      fetchGoalEntries(),
      fetchAchievements(),
    ]);
    setGoals(nextGoals);
    setEntries(nextEntries);
    setAchievements(nextAchievements);
  };

  // 目标、记录、成就都是页内本地状态（不在全局 store），同步拉回对端写入后
  // 必须在这里重载，否则成长页要重开一次才看得到对端的新目标与新记录。
  useEffect(() => {
    const reload = () => void refresh();
    void refresh();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 命令面板选中目标后：定位到「目标」页签并打开该目标详情（含已归档）。
  useEffect(() => {
    if (focusRequest?.kind !== "goal") return;
    setTab("goals");
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
  const visibleEntries = filterGoalId
    ? entries.filter((entry) => entry.goal_id === filterGoalId)
    : entries;
  const entriesByDate = useMemo(() => {
    const result = new Map<string, GoalEntry[]>();
    for (const entry of visibleEntries) {
      const list = result.get(entry.entry_date) ?? [];
      list.push(entry);
      result.set(entry.entry_date, list);
    }
    return result;
  }, [visibleEntries]);
  const days = useMemo(dayRange, []);
  // 完成的任务也点亮热力图：按任务自身的日期（截止日）落位，而非完成时刻——
  // 补记/延后完成的任务应算在它所属的那一天。无日期的任务回退到完成时刻。
  const completedTasksByDate = useMemo(() => {
    const result = new Map<string, Task[]>();
    for (const task of allTasks) {
      if (task.parent_id || task.deleted_at) continue;
      if (task.status !== "completed") continue;
      // 按目标筛选时只计这个目标关联的任务：否则热力图上亮着的仍是全量投入，
      // 筛选名不副实。
      if (filterGoalId && task.goal_id !== filterGoalId) continue;
      const key =
        task.due_date ??
        (task.completed_at ? localDateKey(new Date(task.completed_at)) : null);
      if (!key) continue;
      const list = result.get(key) ?? [];
      list.push(task);
      result.set(key, list);
    }
    return result;
  }, [allTasks, filterGoalId]);
  // 习惯打卡本身也点亮热力图（此前只有关联目标的打卡才计入）。
  // 按目标筛选时，只计服务于该目标的习惯。
  const habitGoalById = useMemo(
    () => new Map([...habits, ...archivedHabits].map((habit) => [habit.id, habit.goal_id])),
    [habits, archivedHabits],
  );
  const habitChecksByDate = useMemo(() => {
    const result = new Map<string, number>();
    for (const check of habitChecks) {
      if (filterGoalId && habitGoalById.get(check.habit_id) !== filterGoalId) continue;
      result.set(check.check_date, (result.get(check.check_date) ?? 0) + 1);
    }
    return result;
  }, [habitChecks, filterGoalId, habitGoalById]);
  const habitTitleById = useMemo(
    () => new Map([...habits, ...archivedHabits].map((habit) => [habit.id, habit.title])),
    [habits, archivedHabits],
  );
  const habitTitlesForDate = (dateKey: string) => {
    const titles: string[] = [];
    for (const check of habitChecks) {
      if (check.check_date !== dateKey) continue;
      const title = habitTitleById.get(check.habit_id);
      if (title && !titles.includes(title)) titles.push(title);
    }
    return titles;
  };
  const manualValueByDate = useMemo(() => {
    const result = new Map<string, number>();
    for (const entry of visibleEntries) {
      if (entry.source_type !== "manual") continue;
      const changeType = goals.find((goal) => goal.id === entry.goal_id)?.goal_type === "measure";
      // 手动记录里会有「校准冲减」（编辑当前值改小时补的负数账），它不是一次投入。
      if (!changeType && Number(entry.value) <= 0) continue;
      const value = changeType ? 1 : Number(entry.value);
      result.set(entry.entry_date, (result.get(entry.entry_date) ?? 0) + value);
    }
    return result;
  }, [visibleEntries, goals]);
  const activeDateKeys = [...new Set([
    ...habitChecksByDate.keys(),
    ...completedTasksByDate.keys(),
    ...entriesByDate.keys(),
  ])].sort();
  const currentStreak = useMemo(
    () => currentDateStreak(activeDateKeys, todayDateString()),
    [activeDateKeys],
  );
  const longestStreak = useMemo(() => longestDateStreak(activeDateKeys), [activeDateKeys]);
  // 投入 = 行动次数（任务完成、习惯打卡）+ 手动记录值；change 型测量记 1 次。
  const totalValue = useMemo(
    () =>
      [...habitChecksByDate.values()].reduce((sum, value) => sum + value, 0) +
      [...completedTasksByDate.values()].reduce((sum, list) => sum + list.length, 0) +
      [...manualValueByDate.values()].reduce((sum, value) => sum + value, 0),
    [habitChecksByDate, completedTasksByDate, manualValueByDate],
  );
  const submitGoal = async () => {
    const title = goalTitle.trim();
    if (!title) return;

    try {
      if (editingGoalId) {
        // 只提交表单真正拥有的字段：类型、单位、目标日期、动机保持原值。
        const values: Partial<Goal> = { title, color };
        if (goalKind === "milestone") {
          values.target_value = Math.max(1, Number(targetValue) || 1);
          await updateGoal(editingGoalId, values);
          // 「当前值」是派生量（基线 + 记录之和）：直接写 current_value 会被
          // 下一次复算按口径覆盖，所以把差额补成一条手动校准记录，改大改小都留得住。
          await setGoalCurrentProgress(editingGoalId, Number(startValue) || 0);
        } else {
          if (goalKind === "measure") {
            values.start_value = Number(startValue) || 0;
            values.target_value = Math.max(1, Number(targetValue) || 1);
          }
          await updateGoal(editingGoalId, values);
        }
      } else {
        await createGoal({
          title,
          goal_type: "milestone",
          unit: "次",
          start_value: Number(startValue) || 0,
          current_value: Number(startValue) || 0,
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
    setGoalKind("milestone");
    setGoalUnit("次");
    setStartValue("0");
    setTargetValue("21");
    setColor(COLORS[0]);
    setShowCreate(true);
  };

  const openGoalEditor = (goal: Goal) => {
    setEditingGoalId(goal.id);
    setGoalTitle(goal.title);
    setGoalKind(goal.goal_type);
    setGoalUnit(goal.unit);
    // 累计型目标这一格是「当前值」，其余类型仍是起始值（数值变化的起点）。
    setStartValue(String(goal.goal_type === "milestone" ? goal.current_value : goal.start_value));
    setTargetValue(String(goal.target_value));
    setColor(goal.color);
    setShowCreate(true);
  };


  // 表单不再问「这是什么类型的目标」，但每种类型的进度算法不同，
  // 所以按目标自身的类型决定该出现哪些输入框、以及引导框怎么说。
  const formShowsValues = goalKind === "milestone" || goalKind === "measure";

  const goalGuide =
    goalKind === "measure"
      ? "数值型目标以最近一次记录作为当前值，起点值只在还没有记录时生效。"
      : goalKind === "staged"
        ? "阶段型目标：把大目标拆成几个可勾选的阶段，勾一个进一个。"
        : "任务完成与习惯打卡可按你声明的计量自动累计；重复动作交给「习惯」，目标只放要达成的结果。";
  // 目标列表分区，与项目页 / 习惯页同一套做法：主区放还在进行的，
  // 收起来的（已完成、已放弃）各自成区——"撤回"得到的目标找得回来。
  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active" || goal.status === "paused"),
    [goals],
  );
  const finishedGoals = useMemo(
    () => goals.filter((goal) => goal.status === "completed"),
    [goals],
  );
  const abandonedGoals = useMemo(
    () => goals.filter((goal) => goal.status === "abandoned"),
    [goals],
  );

  /** 放弃 / 归档都能一键撤回：回到进行中。 */
  const resumeGoal = async (goal: Goal) => {
    await updateGoal(goal.id, { status: "active" });
    await refresh();
  };

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

  // 阶段：把大目标拆成可勾选的阶段，勾一个进一个。
  const addStage = async () => {
    const title = stageTitle.trim();
    if (!title || !selectedGoal) return;
    await createGoalMilestone(selectedGoal.id, title, 0, null);
    if (selectedGoal.goal_type !== "staged") {
      // 第一个阶段加入后，目标切换成阶段型：进度 = 已完成阶段 / 总阶段。
      await updateGoal(selectedGoal.id, {
        goal_type: "staged",
        unit: "个阶段",
        start_value: 0,
      });
    }
    setStageTitle("");
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
          <h2 aria-label={isMobileShell() ? "成长" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="成长" /> : "成长"}

          </h2>
          <p className="workspace-subtitle">每一步都算数。</p>
        </div>
        <div className="top-controls">
          <button className="btn-primary" type="button" onClick={openCreateGoal}>
            新建目标
          </button>
        </div>
      </div>
      {/* 与「今日」同款的引导框:eyebrow + 标语 + 一句注释。 */}
      {/* 与「今日」同款的引导框（eyebrow + 标语 + 一句注释）。移动壳换数据型顶卡。 */}
      {isMobileShell() ? (
        <MobileGuideCard
          value={currentStreak}
          unit="天"
          label="连续成长"
          hint={`活跃 ${activeDateKeys.length} 天 · 最长 ${longestStreak} 天`}
        />
      ) : (
        <section className="today-hero guide-hero">
          <div className="today-hero-copy">
            <h3>看见每一天累积的成长。</h3>
            <p className="today-hero-note">日复一日，功在不舍。</p>
          </div>
        </section>
      )}

      <nav className="growth-tabs">
        {(["overview", "goals", "achievements"] as GrowthTab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item === "overview" ? "成长总览" : item === "goals" ? "目标" : "成就"}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <>
          <section className="growth-metrics">
            <article><span>活跃天数</span><strong>{activeDateKeys.length}</strong></article>
            <article><span>当前连续</span><strong>{currentStreak}<small> 天</small></strong></article>
            <article><span>最长连续</span><strong>{longestStreak}<small> 天</small></strong></article>
            <article><span>累计投入</span><strong>{Math.round(totalValue * 10) / 10}</strong></article>
          </section>
          <section className="growth-panel heatmap-panel">
            <div className="growth-panel-head">
              <div><h3>最近半年的投入</h3></div>
              <SelectMenu
                ariaLabel="筛选目标"
                value={filterGoalId}
                onChange={setFilterGoalId}
                options={[{ value: "", label: "全部目标" }, ...goals.map((goal) => ({ value: String(goal.id), label: goal.title }))]}
              />
            </div>
            <div className="growth-heatmap" aria-label="成长热点图">
              {days.map((date) => {
                const key = toDateKey(date);
                const doneCount = (completedTasksByDate.get(key) ?? []).length;
                const habitCount = habitChecksByDate.get(key) ?? 0;
                const entryValue = manualValueByDate.get(key) ?? 0;
                const value = entryValue + doneCount + habitCount;
                const level = activityLevelFromValue(value);
                return <button key={key} className={`heat-cell level-${level}`} title={`${key} · ${value || "无"}投入`} onClick={() => setSelectedDate(key)} />;
              })}
            </div>
            <div className="heatmap-legend"><span>少</span>{[0,1,2,3,4].map((level) => <i key={level} className={`heat-cell level-${level}`} />)}<span>多</span></div>
          </section>
          <section className="growth-columns">
            <div className="growth-panel"><div className="growth-panel-head"><h3>进行中的目标</h3><button onClick={() => setTab("goals")}>查看全部</button></div>{goals.filter((goal) => goal.status === "active").slice(0,4).map((goal) => <GoalCard key={goal.id} goal={goal} onOpen={() => { setSelectedGoalId(goal.id); setTab("goals"); }} />)}</div>
            <div className="growth-panel"><div className="growth-panel-head"><h3>最近成就</h3><button onClick={() => setTab("achievements")}>成就墙</button></div>{achievements.slice(0,4).map((achievement) => <AchievementCard key={achievement.id} achievement={achievement} />)}</div>
          </section>
        </>
      ) : null}

      {tab === "goals" ? (
        selectedGoal ? (
          <section className="goal-detail">
            <button className="text-btn" onClick={() => setSelectedGoalId(null)}>← 返回目标列表</button>
            <div className="goal-detail-hero" style={{ "--goal-color": selectedGoal.color } as CSSProperties}>
              <div><span>{GOAL_STATUS_LABEL[selectedGoal.status]}</span><h2>{selectedGoal.title}</h2><p>{selectedGoal.motivation || goalHeroSummary(selectedGoal)}</p></div>
              <strong>{Math.round(calculateGoalProgress(selectedGoal))}%</strong>
            </div>
            <div className="goal-progress-track"><i style={{ width: `${calculateGoalProgress(selectedGoal)}%`, background: selectedGoal.color }} /></div>
            {/* 阶段清单：目标即里程碑，勾一个进一个。 */}
            <section className="goal-stages">
              <div className="goal-section-head">
                <span>阶段</span>
                <b>
                  {milestones.filter((item) => item.completed_at).length}/{milestones.length}
                </b>
              </div>
              {milestones.length ? (
                <ul className="goal-stage-list">
                  {milestones.map((milestone) => (
                    <li
                      key={milestone.id}
                      className={milestone.completed_at ? "is-done" : ""}
                    >
                      <button
                        type="button"
                        className="goal-stage-check"
                        title={milestone.completed_at ? "取消达成" : "标记达成"}
                        onClick={() =>
                          void setGoalMilestoneCompleted(
                            milestone.id,
                            !milestone.completed_at,
                          ).then(() => refresh())
                        }
                      >
                        <AppIcon name="check" size={13} />
                      </button>
                      <span>{milestone.title}</span>
                      <button
                        type="button"
                        className="goal-stage-remove"
                        title="删除阶段"
                        onClick={() =>
                          void deleteGoalMilestone(milestone.id).then(() => refresh())
                        }
                      >
                        <AppIcon name="trash" size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="goal-empty">
                  还没有阶段。把大目标拆成 3–5 个可勾选的阶段，勾一个进一个。
                </p>
              )}
              <div className="goal-stage-add">
                <input
                  value={stageTitle}
                  placeholder="添加阶段，例如「读完前 5 本」"
                  onChange={(event) => setStageTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addStage();
                    }
                  }}
                />
                <button
                  type="button"
                  className="item-action-btn"
                  disabled={!stageTitle.trim()}
                  onClick={() => void addStage()}
                >
                  添加阶段
                </button>
              </div>
            </section>

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
                      <span className="goal-push-kind">任务</span>
                      <span className="goal-push-title">{task.title}</span>
                      <em>
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
                        className="goal-push-measure"
                        title="切换这项是否给目标计数"
                        onClick={() =>
                          void saveTask(task.id, {
                            goal_contribution: task.goal_contribution > 0 ? 0 : 1,
                          }).then(() => refresh())
                        }
                      >
                        {task.goal_contribution > 0 ? "计入" : "只关联"}
                      </button>
                    </li>
                  ))}
                  {pushingHabits.map((habit) => (
                    <li key={habit.id}>
                      <span className="goal-push-kind">习惯</span>
                      <span className="goal-push-title">{habit.title}</span>
                      <em>{habit.archived ? "已归档" : "每周进行"}</em>
                      <button
                        type="button"
                        className="goal-push-measure"
                        title="切换这次打卡是否给目标计数"
                        onClick={() =>
                          void setHabitMeasurement(
                            habit.id,
                            habit.goal_contribution > 0 ? 0 : 1,
                          ).then(() => refresh())
                        }
                      >
                        {habit.goal_contribution > 0 ? "计入" : "只关联"}
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

            <div className="goal-detail-actions">
              <div className="goal-manage-group">
                {["active", "paused"].includes(selectedGoal.status) ? <button className="item-action-btn" onClick={() => void updateGoal(selectedGoal.id, { status: selectedGoal.status === "paused" ? "active" : "paused" }).then(() => refresh())}>{selectedGoal.status === "paused" ? "继续目标" : "暂停"}</button> : null}
                {/* 已放弃可以改主意撤回；已达成是终点，不给"重新打开"。 */}
                {selectedGoal.status === "abandoned" ? <button className="item-action-btn" onClick={() => void resumeGoal(selectedGoal)}>恢复目标</button> : null}
                <button className="item-action-btn" onClick={() => openGoalEditor(selectedGoal)}>编辑</button>
                {["active", "paused"].includes(selectedGoal.status) ? (
                  <SelectMenu
                    className="item-action-btn"
                    variant="action"
                    ariaLabel="更多状态操作"
                    value=""
                    onChange={(value) => {
                      if (!["completed", "abandoned"].includes(value)) return;
                      void updateGoal(selectedGoal.id, { status: value as Goal["status"] }).then(() => refresh());
                    }}
                    options={[
                      { value: "", label: "更多操作" },
                      { value: "completed", label: "标记完成" },
                      { value: "abandoned", label: "放弃目标" },
                    ]}
                  />
                ) : null}
                <button className="item-action-btn" onClick={() => void deleteGoalWithConfirm(selectedGoal)}>删除目标</button>
              </div>
            </div>
          </section>
        ) : (
          <>
          <section aria-label="进行中的目标">
            <div className="section-title-row">
              <h3>进行中</h3>
              <span className="tags-filtered-count">{activeGoals.length}</span>
            </div>
            <div className="goal-grid">
              {activeGoals.map((goal) => (
                <GoalCard key={goal.id} goal={goal} onOpen={() => setSelectedGoalId(goal.id)} />
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
                  <GoalCard key={goal.id} goal={goal} onOpen={() => setSelectedGoalId(goal.id)} />
                ))}
              </div>
            </section>
          ) : null}
          {abandonedGoals.length ? (
            <section aria-label="已放弃的目标">
              <div className="section-title-row">
                <h3>已放弃</h3>
                <span className="tags-filtered-count">{abandonedGoals.length}</span>
              </div>
              <div className="goal-grid">
                {abandonedGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} onOpen={() => setSelectedGoalId(goal.id)} />
                ))}
              </div>
            </section>
          ) : null}
          </>
        )
      ) : null}

      {tab === "achievements" ? (
        <section>
          <div className="achievement-compose growth-panel"><input value={achievementTitle} placeholder="记录一个值得纪念的成就" onChange={(event) => setAchievementTitle(event.target.value)} /><SelectMenu ariaLabel="关联目标" value={selectedGoalId ?? ""} onChange={(value) => setSelectedGoalId(value || null)} options={[{ value: "", label: "不关联目标" }, ...goals.map((goal) => ({ value: String(goal.id), label: goal.title }))]} /><button className="btn-primary" onClick={() => { const title = achievementTitle.trim(); if (!title) return; void createAchievement({ title, description: "", achieved_at: todayDateString(), goal_id: selectedGoalId, source_type: "manual" }).then(() => { setAchievementTitle(""); return refresh(); }); }}>保存成就</button></div>
          <div className="achievement-grid">{achievements.map((achievement) => <AchievementCard key={achievement.id} achievement={achievement} onPin={() => void toggleAchievementPinned(achievement.id).then(() => refresh())} />)}</div>
          {!achievements.length ? <div className="empty-state">还没有成就记录。把今天值得纪念的一步留在这里。</div> : null}
        </section>
      ) : null}

      {showCreate ? (
        <div className="modal-backdrop" onMouseDown={() => setShowCreate(false)}>
          <div className="goal-create-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>{editingGoalId ? "编辑目标" : "新建目标"}</h3>
                <p className="goal-create-sub">任务和习惯会自动累计到这里，填三项就能开始。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setShowCreate(false)}>×</button>
            </div>
            <label>目标名称<input autoFocus value={goalTitle} placeholder="想达成什么结果？例如「读完 21 本书」" onChange={(event) => setGoalTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitGoal(); }} /></label>
            <div className="goal-form-grid">
              {formShowsValues ? (
                <>
                  <label>
                    {goalKind === "measure" ? "起始值" : "当前值"}（{goalUnit}）
                    <input type="number" value={startValue} onChange={(event) => setStartValue(event.target.value)} />
                  </label>
                  <label>
                    目标值（{goalUnit}）
                    <input type="number" value={targetValue} onChange={(event) => setTargetValue(event.target.value)} />
                  </label>
                </>
              ) : null}

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

      {selectedDate ? (
        <div className="modal-backdrop" onMouseDown={() => setSelectedDate(null)}>
          <div className="day-activity-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head"><h3>成长回看</h3><button onClick={() => setSelectedDate(null)}>×</button></div>
            <p className="day-activity-date">{selectedDate}</p>
            {(completedTasksByDate.get(selectedDate) ?? []).map((task) => (
              <div className="day-activity-row" key={task.id}>
                <i className="done" />
                <div><strong>{task.title}</strong><span>完成任务{task.due_time ? ` · ${task.due_time}` : ""}</span></div>
              </div>
            ))}
            {(habitChecksByDate.get(selectedDate) ?? 0) > 0 ? (
              <div className="day-activity-row" key={`habit-${selectedDate}`}>
                <i className="done habit-day-dot" />
                <div>
                  <strong>{habitChecksByDate.get(selectedDate)} 次习惯打卡</strong>
                  <span>{habitTitlesForDate(selectedDate).join("、") || "习惯打卡"}</span>
                </div>
              </div>
            ) : null}
            {(entriesByDate.get(selectedDate) ?? []).filter((entry) => entry.source_type === "manual").map((entry) => {
              const goal = goals.find((item) => item.id === entry.goal_id);
              const valueLabel = goal?.goal_type === "measure" ? `当前 ${entry.value}` : `+${entry.value}`;
              return (
                <div className="day-activity-row" key={entry.id}>
                  <i style={{ background: goal?.color }} />
                  <div><strong>{entry.note || "记录了一次成长"}</strong><span>{goal?.title} · {valueLabel}{goal?.unit}</span></div>
                </div>
              );
            })}
            {!(entriesByDate.get(selectedDate) ?? []).some((entry) => entry.source_type === "manual") && !(completedTasksByDate.get(selectedDate) ?? []).length && !(habitChecksByDate.get(selectedDate) ?? 0) ? (
              <div className="empty-state">这一天没有记录。空白不是失败，只是尚未留下足迹。</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GoalCard({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  // 分母与进度走 growth 的唯一真源：目标卡、今日目标条、成长页显示同一组数字。
  const target = resolveGoalTarget(goal);
  const progress = calculateGoalProgress(goal);
  const deadline = goalDeadlineInfo(goal, todayDateString());
  const finished = goal.status === "completed" || goal.status === "abandoned";
  return (
    <button className={`goal-card${finished ? " is-finished" : ""}`} onClick={onOpen}>
      <div className="goal-card-head"><i style={{ background: goal.color }} /><span>{GOAL_STATUS_LABEL[goal.status]}</span></div>
      <h3>{goal.title}</h3>
      <p>
        {fmtContribution(goal.current_value)}{target.unit} / {fmtContribution(target.value)}{target.unit}
      </p>
      <div className="goal-progress-track"><i style={{ width: `${progress}%`, background: goal.color }} /></div>
      <footer>
        <span>{Math.round(progress)}%</span>
        <span>
          {deadline
            ? `${deadline.behind ? "进度落后 · " : ""}${deadline.daysLeft > 0 ? `剩 ${deadline.daysLeft} 天` : "已到目标日"}`
            : goal.goal_type === "staged"
              ? "阶段目标"
              : "长期目标"}
        </span>
      </footer>
    </button>
  );
}

function AchievementCard({ achievement, onPin }: { achievement: Achievement; onPin?: () => void }) {
  return <article className={`achievement-card${achievement.pinned ? " pinned" : ""}`}><div className="achievement-medal">✦</div><div><time>{achievement.achieved_at}</time><h3>{achievement.title}</h3><p>{achievement.description || "这一刻值得被记住。"}</p></div>{onPin ? <button className={achievement.pinned ? "active" : ""} onClick={onPin}>{achievement.pinned ? "已置顶" : "置顶"}</button> : null}</article>;
}
