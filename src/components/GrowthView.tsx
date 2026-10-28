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
import { useFloatingDismiss } from "@/lib/floatingDialog";
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

type GrowthTab = "overview" | "goals";

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
  // 成就不再单独占一个页签：墙与录入收进一处浮层卡（移动壳是底部弹层），
  // 入口在总览「最近成就」栏头，看完顺手记一条，不用先在页签之间来回跳。
  const [achievementsOpen, setAchievementsOpen] = useState(false);
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
  // 成就表单的关联目标必须独立于 selectedGoalId：后者是目标详情页的选中态，
  // 共用会让表单默认落在「刚看过的那个目标」上，默认值和保存关联都会不对。
  const [achievementGoalId, setAchievementGoalId] = useState("");
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
  // 桌面顶卡讲「现在」：今天有没有动。口径与热力图同一处（完成任务 + 习惯打卡 + 手动记录）。
  const todayInvestment =
    (completedTasksByDate.get(today) ?? []).length +
    (habitChecksByDate.get(today) ?? 0) +
    (manualValueByDate.get(today) ?? 0);
  // 热力图月份刻度：一格一列（一列一周），标在含 1 号的那一列，首列也标一次；
  // 相邻两个刻度至少隔 3 列，窄窗下才不会挤成一团。桌面才显示（CSS 门控）。
  const monthMarks = useMemo(() => {
    const marks: { col: number; label: string }[] = [];
    for (let col = 0; col * 7 < days.length; col += 1) {
      const monthStart = days.slice(col * 7, col * 7 + 7).find((date) => date.getDate() === 1);
      if (col !== 0 && !monthStart) continue;
      const prev = marks[marks.length - 1];
      if (prev && col - prev.col < 3) continue;
      marks.push({ col, label: `${(monthStart ?? days[col * 7]).getMonth() + 1}月` });
    }
    return marks;
  }, [days]);
  // 一天投了多少：任务完成 + 习惯打卡 + 手动记录（与顶卡、热力图同一口径）。
  const valueByDate = useMemo(() => {
    const result = new Map<string, number>();
    const keys = new Set([
      ...completedTasksByDate.keys(),
      ...habitChecksByDate.keys(),
      ...manualValueByDate.keys(),
    ]);
    for (const key of keys) {
      result.set(
        key,
        (completedTasksByDate.get(key) ?? []).length +
          (habitChecksByDate.get(key) ?? 0) +
          (manualValueByDate.get(key) ?? 0),
      );
    }
    return result;
  }, [completedTasksByDate, habitChecksByDate, manualValueByDate]);
  // 周柱：跟热力图共用 26 列与同一窗口，一柱一周。按峰值定标（不是均值），
  // 柱高比就是投入比；峰值给 1 兜底，一条记录都没有时也不会除出 NaN。
  const weeklyTotals = useMemo(() => {
    const weeks: { key: string; value: number; activeDays: number }[] = [];
    for (let col = 0; col * 7 < days.length; col += 1) {
      let value = 0;
      let activeDays = 0;
      for (const date of days.slice(col * 7, col * 7 + 7)) {
        const dayValue = valueByDate.get(toDateKey(date)) ?? 0;
        value += dayValue;
        if (dayValue) activeDays += 1;
      }
      weeks.push({ key: toDateKey(days[col * 7]), value, activeDays });
    }
    return weeks;
  }, [days, valueByDate]);
  const weeklyPeak = Math.max(1, ...weeklyTotals.map((week) => week.value));
  const currentWeekKey = weeklyTotals[weeklyTotals.length - 1]?.key ?? "";
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

  // 成就只有「标题 + 关联目标」两项，回车即存；描述与来源留给同步端与自动来源。
  const saveAchievement = () => {
    const title = achievementTitle.trim();
    if (!title) return;
    void createAchievement({
      title,
      description: "",
      achieved_at: todayDateString(),
      goal_id: achievementGoalId || null,
      source_type: "manual",
    }).then(() => {
      setAchievementTitle("");
      setAchievementGoalId("");
      return refresh();
    });
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

  // 桌面悬浮卡：新建/编辑目标收进右上角，点外/Esc 收起（同「新建任务」）。
  useFloatingDismiss(showCreate, () => setShowCreate(false));
  useFloatingDismiss(achievementsOpen, () => setAchievementsOpen(false));

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
      {/* 顶卡两端都在说「现在」：移动壳是数据型引导卡（连续成长）；桌面顶卡报今天投入，
          连续与累计归下面的读数条（四格与移动壳同口径），一个数只在一处当大字。 */}
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
            {/* 顶卡说「今天」：一句今天的话，数字交给右侧 .today-hero-meter（与项目/标签/复盘同族）。 */}
            <p className="today-hero-note">
              {todayInvestment ? "今天动的每一项，都算进了下面这张图。" : "今天还没有投入——记一笔或打卡一件小事都算。"}
            </p>
          </div>
          <div className="today-hero-meter">
            <span className="today-hero-meter-count">
              <strong>{todayInvestment}</strong>
              <span>项</span>
            </span>
            <span className="today-hero-meter-label">今天已投入</span>
          </div>
        </section>
      )}

      <nav className="growth-tabs">
        {(["overview", "goals"] as GrowthTab[]).map((item) => (
          <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>
            {item === "overview" ? "成长总览" : "目标"}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <>
          <section className="growth-metrics">
            <article><span>活跃天数</span><strong>{activeDateKeys.length}</strong></article>
            <article><span>当前连续</span><strong>{currentStreak}<small> 天</small></strong></article>
            <article><span>最长连续</span><strong>{longestStreak}<small> 天</small></strong></article>
            <article><span>累计投入</span><strong>{Math.round(totalValue * 10) / 10}<small> 次</small></strong></article>
          </section>
          <section className="growth-panel heatmap-panel">
            <div className="growth-panel-head">
              <div>
                <h3>最近半年的投入</h3>
                <p className="growth-trend-hint">一柱是一周投了多少，一格是这天动没动。</p>
              </div>
              <SelectMenu
                ariaLabel="筛选目标"
                value={filterGoalId}
                onChange={setFilterGoalId}
                options={[{ value: "", label: "全部目标" }, ...goals.map((goal) => ({ value: String(goal.id), label: goal.title }))]}
              />
            </div>
            {/* 周柱与下面的月份刻度、日格子共用同一套 26 列：上下对齐就读成一张图——
                上面看量（哪几周重），下面看迹（哪几天动）。零投入的周用内凹灰，
                和空档格子同一语气。 */}
            <div className="growth-trend" role="img" aria-label="每周投入走势">
              {weeklyTotals.map((week) => (
                <i
                  key={week.key}
                  className={`growth-trend-bar${week.value ? "" : " is-zero"}${week.key === currentWeekKey ? " is-current" : ""}`}
                  style={{ height: `${Math.max(4, (week.value / weeklyPeak) * 100)}%` }}
                  title={`${week.key.slice(5).replace("-", "/")} 起一周 · ${week.value || "无"}投入${week.activeDays ? ` · ${week.activeDays} 天` : ""}`}
                />
              ))}
            </div>
            {/* 月份刻度与格子同一套 26 列栅格，桌面用来回答「这片是哪几个月」。 */}
            <div className="heat-months" aria-hidden>
              {monthMarks.map((mark) => (
                <span key={mark.col} style={{ gridColumnStart: mark.col + 1 }}>{mark.label}</span>
              ))}
            </div>
            <div className="growth-heatmap" aria-label="成长热点图">
              {days.map((date) => {
                const key = toDateKey(date);
                const value = valueByDate.get(key) ?? 0;
                const level = activityLevelFromValue(value);
                return <button key={key} className={`heat-cell level-${level}${key === today ? " is-today" : ""}`} title={`${key} · ${value || "无"}投入`} onClick={() => setSelectedDate(key)} />;
              })}
            </div>
            <div className="heatmap-legend"><span>少</span>{[0,1,2,3,4].map((level) => <i key={level} className={`heat-cell level-${level}`} />)}<span>多</span></div>
          </section>
          <section className="growth-columns">
            <div className="growth-panel"><div className="growth-panel-head"><h3>进行中的目标</h3><button onClick={() => setTab("goals")}>查看全部</button></div>{goals.filter((goal) => goal.status === "active").slice(0,4).map((goal) => <GoalCard key={goal.id} goal={goal} onOpen={() => { setSelectedGoalId(goal.id); setTab("goals"); }} />)}</div>
            <div className="growth-panel"><div className="growth-panel-head"><h3>最近成就</h3><button onClick={() => setAchievementsOpen(true)}>成就墙</button></div>{achievements.slice(0,4).map((achievement) => <AchievementCard key={achievement.id} achievement={achievement} />)}{achievements.length ? null : <p className="growth-panel-hint">还没有记下的成就。值得记下的一天，去「成就墙」留一笔。</p>}</div>
          </section>
        </>
      ) : null}

      {tab === "goals" ? (
        /* 目标工作台：清单与详情同屏，改一个目标的阶段时还看得见别的目标在什么位置，
           不必再「点进去 → 返回列表」来回跳。移动壳仍是钻入（CSS 用 has-detail 切两栏）。
           DOM 是详情在前、清单在后，桌面用 grid-column 把清单摆回左边。 */
        <section className={`goal-workbench${selectedGoal ? " has-detail" : ""}`}>
        <div className="goal-workbench-detail">
          {selectedGoal ? (
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
            <div className="goal-workbench-empty">
              <strong>左边选一个目标</strong>
              <p>阶段、推进它的任务与习惯、计入与否，都在这一栏里改。</p>
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
          {abandonedGoals.length ? (
            <section aria-label="已放弃的目标">
              <div className="section-title-row">
                <h3>已放弃</h3>
                <span className="tags-filtered-count">{abandonedGoals.length}</span>
              </div>
              <div className="goal-grid">
                {abandonedGoals.map((goal) => (
                  <GoalCard key={goal.id} goal={goal} selected={selectedGoalId === goal.id} onOpen={() => setSelectedGoalId(goal.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
        </section>
      ) : null}

      {achievementsOpen ? (
        /* 成就墙 + 录入收进一处浮层卡（移动壳是底部弹层）：看完顺手记一条，不用再跳到
           另一个页签。挂 .goal-create-modal 是同族几何——宽度、内滚、移动壳弹层都现成。 */
        <div className="modal-backdrop floating-backdrop" onMouseDown={() => setAchievementsOpen(false)}>
          <div className="goal-create-modal achievement-wall-modal floating-card" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h3>成就墙</h3>
                <p className="goal-create-sub">攒到值得记下的一天，就在这里留一笔。</p>
              </div>
              <button type="button" aria-label="关闭" onClick={() => setAchievementsOpen(false)}>×</button>
            </div>
            <div className="achievement-compose-row">
              <input
                value={achievementTitle}
                placeholder="记录一个值得纪念的成就"
                onChange={(event) => setAchievementTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveAchievement();
                  }
                }}
              />
              <SelectMenu ariaLabel="关联目标" value={achievementGoalId} onChange={setAchievementGoalId} className={achievementGoalId ? undefined : "is-placeholder"} options={[{ value: "", label: "不关联目标" }, ...goals.map((goal) => ({ value: String(goal.id), label: goal.title }))]} />
              <button className="btn-primary" type="button" onClick={saveAchievement}>保存成就</button>
            </div>
            {achievements.length ? (
              <div className="achievement-wall-list">{achievements.map((achievement) => <AchievementCard key={achievement.id} achievement={achievement} onPin={() => void toggleAchievementPinned(achievement.id).then(() => refresh())} />)}</div>
            ) : (
              <p className="goal-empty">还没有成就记录。把今天值得纪念的一步留在这里。</p>
            )}
          </div>
        </div>
      ) : null}

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

function GoalCard({
  goal,
  onOpen,
  selected = false,
}: {
  goal: Goal;
  onOpen: () => void;
  /** 工作台的清单里标出「右边详情正在看哪个目标」；总览等其它地方不传，行为不变。 */
  selected?: boolean;
}) {
  // 分母与进度走 growth 的唯一真源：目标卡、今日目标条、成长页显示同一组数字。
  const target = resolveGoalTarget(goal);
  const progress = calculateGoalProgress(goal);
  const deadline = goalDeadlineInfo(goal, todayDateString());
  const finished = goal.status === "completed" || goal.status === "abandoned";
  return (
    <button
      className={`goal-card${finished ? " is-finished" : ""}${selected ? " is-sel" : ""}`}
      aria-pressed={selected}
      onClick={onOpen}
    >
      <div className="goal-card-head">
        <span className="goal-card-chip" style={{ "--goal-color": goal.color } as CSSProperties}>
          <i style={{ background: goal.color }} />
          {GOAL_STATUS_LABEL[goal.status]}
        </span>
      </div>
      <h3>{goal.title}</h3>
      <p>
        <b>{fmtContribution(goal.current_value)}{target.unit}</b> / {fmtContribution(target.value)}{target.unit}
      </p>
      <div className="goal-progress-track"><i style={{ width: `${progress}%`, background: goal.color }} /></div>
      <footer>
        <span>{Math.round(progress)}%</span>
        <span className={deadline?.behind ? "is-behind" : undefined}>
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
