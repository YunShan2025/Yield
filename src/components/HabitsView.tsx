import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString, toDateString } from "@/lib/dates";
import { DEFAULT_HABIT_TARGET_PER_WEEK, fetchGoals } from "@/lib/db";
import { mondayWeekDates } from "@/lib/weeklyChecklist";
import type { Goal, Habit } from "@/types";
import { AppIcon } from "@/components/AppIcon";
import { goalAcceptsSource, resolveGoalTarget, type GoalTarget } from "@/lib/growth";
import {
  describeHabitSchedule,
  matchesRepeatRule,
  parseRepeatRule,
  stringifyRepeatRule,
  weeklyTargetFromRule,
  WEEKDAY_OPTIONS,
  weekdayFromDate,
} from "@/lib/repeat";
import { WeekdayPicker } from "@/components/WeekdayPicker";
import { SelectMenu } from "@/components/SelectMenu";
import { ExpandRow } from "@/components/ExpandRow";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { DesktopGuideCard } from "@/components/DesktopGuideCard";
import { isMobileShell } from "@/lib/platform";
import { useFloatingDismiss } from "@/lib/floatingDialog";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { confirmAction } from "@/components/AppConfirm";
import type { RepeatRule } from "@/types";

const WEEKDAY_LABELS = new Map<number, string>(WEEKDAY_OPTIONS.map((d) => [d.value, d.label]));

export function HabitsView() {
  const habits = useAppStore((s) => s.habits);
  const archivedHabits = useAppStore((s) => s.archivedHabits);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const addHabit = useAppStore((s) => s.addHabit);
  const updateHabit = useAppStore((s) => s.updateHabit);
  const archiveHabit = useAppStore((s) => s.archiveHabit);
  const restoreHabit = useAppStore((s) => s.restoreHabit);
  const removeHabit = useAppStore((s) => s.removeHabit);
  const [creating, setCreating] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  // 桌面卡片化（同项目页 setActiveProjectId 口径）：一屏一张展开卡，收/放都落点明确。
  const [activeHabitId, setActiveHabitId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState("");
  const [goalContribution, setGoalContribution] = useState("1");
  const [goalMeasure, setGoalMeasure] = useState<"none" | "one" | "custom">("none");
  const [targetPerWeek, setTargetPerWeek] = useState(
    String(DEFAULT_HABIT_TARGET_PER_WEEK),
  );
  // 排期：每天 / 每周指定几天 / 每周 N 次（不指定日子）。
  const [scheduleMode, setScheduleMode] = useState<"daily" | "weekdays" | "flexible">(
    "flexible",
  );
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [targetDays, setTargetDays] = useState("30");
  const [unlimitedDays, setUnlimitedDays] = useState(false);
  const [saving, setSaving] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const today = todayDateString();
  const goalById = new Map(goals.map((goal) => [goal.id, goal]));
  // 目标分母与目标卡、今日条同源，避免同一个目标在两处显示不同的分母。
  const linkedGoalFor = (habit: Habit) => {
    const goal = habit.goal_id ? goalById.get(habit.goal_id) ?? null : null;
    return { goal, goalTarget: goal ? resolveGoalTarget(goal) : null };
  };

  // 习惯的目标关联下拉靠这份列表，同步拉回新目标后要能立刻选到。
  useEffect(() => {
    const reload = () => void fetchGoals().then(setGoals);
    reload();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
  }, []);

  // 所有进行中的目标都能关联（服务关系）；能不能"打卡即计量"由目标自己决定。
  const activeGoals = goals.filter((goal) => goal.status === "active");
  const canMeasure = goalId
    ? goalAcceptsSource(goals.find((goal) => goal.id === goalId) ?? ({} as Goal), "habit")
    : false;

  const checksFor = (habitId: string) =>
    habitChecks.filter((item) => item.habit_id === habitId);

  const inProgress = habits.filter((habit) => checksFor(habit.id).length > 0);
  // 桌面默认展开「进行中」第一条习惯的本周面板（只在数据到位后生效一次，
  // 用户手动收起后不再复活）；移动壳保持点卡展开的卡片流节奏。
  const defaultOpenedRef = useRef(false);
  useEffect(() => {
    if (defaultOpenedRef.current || isMobileShell()) return;
    const first = inProgress[0];
    if (first) {
      defaultOpenedRef.current = true;
      setActiveHabitId(first.id);
    }
  }, [inProgress]);
  const notStarted = habits.filter((habit) => checksFor(habit.id).length === 0);

  const openCreate = () => {
    setEditingHabit(null);
    setTitle("");
    setGoalId("");
    setGoalContribution("1");
    setGoalMeasure("none");
    setTargetPerWeek(String(DEFAULT_HABIT_TARGET_PER_WEEK));
    setTargetDays("30");
    setUnlimitedDays(false);
    setScheduleMode("flexible");
    setWeekdays([1, 3, 5]);
    setSaving(false);
    setCreating(true);
  };

  const openEdit = (habit: Habit) => {
    setCreating(false);
    setEditingHabit(habit);
    setTitle(habit.title);
    setGoalId(habit.goal_id ?? "");
    setGoalContribution(String(habit.goal_contribution || 0));
    setGoalMeasure(
      (habit.goal_contribution ?? 0) > 0
        ? habit.goal_contribution === 1
          ? "one"
          : "custom"
        : "none",
    );
    setTargetPerWeek(String(habit.target_per_week || DEFAULT_HABIT_TARGET_PER_WEEK));
    setTargetDays(habit.target_days ? String(habit.target_days) : "30");
    setUnlimitedDays(habit.target_days === null);
    const rule = parseRepeatRule(habit.repeat_rule ?? null);
    if (!rule) {
      setScheduleMode("flexible");
      setWeekdays([1, 3, 5]);
    } else if (rule.frequency === "daily") {
      setScheduleMode("daily");
      setWeekdays([1, 3, 5]);
    } else if (rule.frequency === "weekly" && rule.weekdays?.length) {
      setScheduleMode("weekdays");
      setWeekdays(rule.weekdays);
    } else {
      setScheduleMode("flexible");
      setWeekdays([1, 3, 5]);
    }
    setSaving(false);
  };

  const closeEditor = () => {
    setCreating(false);
    setEditingHabit(null);
    setSaving(false);
  };

  const submitHabit = async () => {
    const habitTitle = title.trim();
    const contribution = Number(goalContribution);
    if (!habitTitle) {
      useAppStore.getState().setToast("习惯名称不能为空");
      return;
    }
    if (goalMeasure === "custom" && (!Number.isFinite(contribution) || contribution < 0)) {
      useAppStore.getState().setToast("计入目标的单位数需为不小于 0 的数字");
      return;
    }
    if (scheduleMode === "weekdays" && !weekdays.length) {
      useAppStore.getState().setToast("请至少选择一天");
      return;
    }
    const rawTargetDays = Number(targetDays);
    if (!goalId && !unlimitedDays && (!Number.isInteger(rawTargetDays) || rawTargetDays < 1)) {
      useAppStore.getState().setToast("目标打卡日数至少为 1 天");
      return;
    }
    // 「每周几次」在固定排期下是派生值：每天 = 7，指定星期 = 选中的天数。
    const derivedPerWeek =
      scheduleMode === "daily" ? 7 : scheduleMode === "weekdays" ? weekdays.length : null;
    const rawTargetPerWeek = derivedPerWeek ?? Number(targetPerWeek);
    if (
      !Number.isInteger(rawTargetPerWeek) ||
      rawTargetPerWeek < 1 ||
      rawTargetPerWeek > 7
    ) {
      useAppStore.getState().setToast("每周目标次数需为 1–7 的整数");
      return;
    }
    const rule: RepeatRule | null =
      scheduleMode === "daily"
        ? { frequency: "daily", interval: 1 }
        : scheduleMode === "weekdays"
          ? { frequency: "weekly", interval: 1, weekdays }
          : null;
    const measuredContribution =
      !goalId || goalMeasure === "none"
        ? 0
        : goalMeasure === "one"
          ? 1
          : Math.max(0, contribution);
    setSaving(true);
    try {
      const draft = {
        title: habitTitle,
        goal_id: goalId || null,
        goal_contribution: measuredContribution,
        target_per_week: rawTargetPerWeek,
        target_days: goalId || unlimitedDays ? null : rawTargetDays,
        repeat_rule: stringifyRepeatRule(rule),
      };
      if (editingHabit) {
        await updateHabit(editingHabit.id, draft);
      } else {
        await addHabit(draft);
      }
      closeEditor();
    } finally {
      setSaving(false);
    }
  };

  const removeHabitWithConfirm = async (habit: Habit) => {
    const ok = await confirmAction({
      title: `将习惯「${habit.title}」移入回收站？`,
      description: "可在回收站中恢复。",
      confirmText: "移入回收站",
      danger: true,
    });
    if (ok) {
      setActiveHabitId((current) => (current === habit.id ? null : current));
      void removeHabit(habit.id);
    }
  };

  // 归档/恢复后卡片会换组，展开态跟着收起，免得焦点跟着行「跳组」。
  const archiveWithCollapse = (habit: Habit) => {
    setActiveHabitId((current) => (current === habit.id ? null : current));
    void archiveHabit(habit.id);
  };

  // 桌面悬浮卡：新建/编辑习惯收进右上角，点外/Esc 收起（同「新建任务」）。
  useFloatingDismiss(creating || Boolean(editingHabit), closeEditor);

  // 引导框读数与分段条：按「今天该不该做」分箱，与行头排期说明同口径。
  const dueHabits = habits.filter((habit) =>
    matchesRepeatRule(today, parseRepeatRule(habit.repeat_rule ?? null)),
  );
  const checkedTodayCount = dueHabits.filter((habit) =>
    checksFor(habit.id).some((item) => item.check_date === today),
  ).length;
  const guideSegments = [
    { label: "已打卡", value: checkedTodayCount, color: "var(--warning)" },
    {
      label: "今天要做",
      value: dueHabits.length - checkedTodayCount,
      color: "var(--accent-strong)",
    },
    {
      label: "排期休息",
      value: habits.length - dueHabits.length,
      color: "color-mix(in srgb, var(--text-secondary) 38%, transparent)",
    },
    {
      label: "未开始",
      value: notStarted.length,
      color: "color-mix(in srgb, var(--accent-strong) 45%, transparent)",
    },
  ].filter((segment) => segment.value > 0);

  return (
    <main className="main-workspace habits-view">
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "习惯" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="习惯" /> : "习惯"}

          </h2>
          <p className="workspace-subtitle">小步不断，胜过心血来潮。</p>
        </div>
        <div className="top-controls">
          <button type="button" className="btn-primary" onClick={openCreate}>
            新建习惯
          </button>
        </div>
      </div>

      <div className="habits-body">
        {isMobileShell() ? (
          <MobileGuideCard
            value={habits.filter((habit) => checksFor(habit.id).some((c) => c.check_date === today)).length}
            unit={`/${habits.length}`}
            label="今日已打卡"
            hint={`已有打卡记录 ${inProgress.length} 个`}
            segments={guideSegments}
          />
        ) : (
          <DesktopGuideCard
            value={checkedTodayCount}
            unit={`/${dueHabits.length}`}
            label="今日已打卡"
            hint={`已有打卡记录 ${inProgress.length} 个`}
            segments={guideSegments}
            note="按排期打卡，进度会替你记得；点行展开可补打本周任意一天。"
          />
        )}

        <section>
          <div className="section-title-row">
            <h3>进行中</h3>
            <span className="tags-filtered-count">{inProgress.length}</span>
          </div>
          <div className="habits-grid">
            {inProgress.map((habit) =>
              isMobileShell() ? (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  checks={checksFor(habit.id)}
                  today={today}
                  open={activeHabitId === habit.id}
                  onToggle={() => setActiveHabitId((c) => (c === habit.id ? null : habit.id))}
                  {...linkedGoalFor(habit)}
                  onEdit={() => openEdit(habit)}
                  onArchive={() => archiveWithCollapse(habit)}
                  onDelete={() => void removeHabitWithConfirm(habit)}
                />
              ) : (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  checks={checksFor(habit.id)}
                  today={today}
                  open={activeHabitId === habit.id}
                  onToggle={() => setActiveHabitId((c) => (c === habit.id ? null : habit.id))}
                  {...linkedGoalFor(habit)}
                  onEdit={() => openEdit(habit)}
                  onArchive={() => archiveWithCollapse(habit)}
                  onDelete={() => void removeHabitWithConfirm(habit)}
                />
              ),
            )}
            {!inProgress.length ? (
              /* 与项目页同规：只有整页一条习惯都没有才引导创建；只是还没人
                 开打卡，说的是「还没开始」，不喊「创建第一个」。 */
              <div className="scope-empty">
                {notStarted.length ? "还没有已开始打卡的习惯。" : "创建第一个习惯开始追踪。"}
              </div>
            ) : null}
          </div>
        </section>

        {/* 与项目页同规：空分组整段不渲染，不给「未开始」摆一句假空状态。 */}
        {notStarted.length ? (
          <section aria-label="未开始习惯">
            <div className="section-title-row">
              <h3>未开始</h3>
              <span className="tags-filtered-count">{notStarted.length}</span>
            </div>
            <div className="habits-grid">
              {notStarted.map((habit) =>
                isMobileShell() ? (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    checks={[]}
                    today={today}
                    open={activeHabitId === habit.id}
                    onToggle={() => setActiveHabitId((c) => (c === habit.id ? null : habit.id))}
                    {...linkedGoalFor(habit)}
                    onEdit={() => openEdit(habit)}
                    onArchive={() => archiveWithCollapse(habit)}
                    onDelete={() => void removeHabitWithConfirm(habit)}
                  />
                ) : (
                  <HabitRow
                    key={habit.id}
                    habit={habit}
                    checks={[]}
                    today={today}
                    open={activeHabitId === habit.id}
                    onToggle={() => setActiveHabitId((c) => (c === habit.id ? null : habit.id))}
                    {...linkedGoalFor(habit)}
                    onEdit={() => openEdit(habit)}
                    onArchive={() => archiveWithCollapse(habit)}
                    onDelete={() => void removeHabitWithConfirm(habit)}
                  />
                ),
              )}
            </div>
          </section>
        ) : null}

        {archivedHabits.length ? (
          <section aria-label="已归档习惯">
            <div className="section-title-row">
              <h3>已归档</h3>
              <span className="tags-filtered-count">{archivedHabits.length}</span>
            </div>
            <div className="habits-grid">
              {archivedHabits.map((habit) =>
                isMobileShell() ? (
                  <HabitCard
                    key={habit.id}
                    habit={habit}
                    checks={habitChecks.filter((item) => item.habit_id === habit.id)}
                    today={today}
                    open={activeHabitId === habit.id}
                    onToggle={() => setActiveHabitId((c) => (c === habit.id ? null : habit.id))}
                    archived
                    {...linkedGoalFor(habit)}
                    onEdit={() => openEdit(habit)}
                    onRestore={() => void restoreHabit(habit.id)}
                    onDelete={() => void removeHabitWithConfirm(habit)}
                  />
                ) : (
                  <HabitRow
                    key={habit.id}
                    habit={habit}
                    checks={habitChecks.filter((item) => item.habit_id === habit.id)}
                    today={today}
                    open={activeHabitId === habit.id}
                    onToggle={() => setActiveHabitId((c) => (c === habit.id ? null : habit.id))}
                    archived
                    {...linkedGoalFor(habit)}
                    onEdit={() => openEdit(habit)}
                    onRestore={() => void restoreHabit(habit.id)}
                    onDelete={() => void removeHabitWithConfirm(habit)}
                  />
                ),
              )}
            </div>
          </section>
        ) : null}
      </div>

      {creating || editingHabit ? (
        <div className="modal-backdrop floating-backdrop" onMouseDown={closeEditor}>
          <form
            className="project-edit-modal habit-edit-modal floating-card"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitHabit();
            }}
          >
            <div className="modal-head">
              <div>
                <h3>{editingHabit ? "编辑习惯" : "新建习惯"}</h3>
              </div>
              <button type="button" className="icon-btn" onClick={closeEditor}>×</button>
            </div>
            <label className="field-full">
              习惯名称
              <input
                autoFocus
                value={title}
                placeholder="想每天坚持做什么？"
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label>
              排期
              <SelectMenu
                ariaLabel="排期"
                value={scheduleMode}
                onChange={(value) => setScheduleMode(value as "daily" | "weekdays" | "flexible")}
                options={[
                  { value: "flexible", label: "每周若干次" },
                  { value: "daily", label: "每天" },
                  { value: "weekdays", label: "每周指定几天" },
                ]}
              />
              <small className="project-field-hint">
                今日事项只列出今天该做的习惯；重复性的事请建习惯，别建任务。
              </small>
            </label>
            {scheduleMode === "weekdays" ? (
              <label className="field-full">
                选择星期
                <WeekdayPicker weekdays={weekdays} onChange={setWeekdays} />
                <small className="project-field-hint">
                  每周 {weekdays.length} 次，今天是{weekdays.includes(new Date(`${today}T12:00:00`).getDay()) ? "要做的日子" : "休息日"}。
                </small>
              </label>
            ) : null}
            <label>
              每周目标次数
              <input
                type="number"
                min={1}
                max={7}
                step={1}
                disabled={scheduleMode !== "flexible"}
                value={scheduleMode === "daily" ? "7" : scheduleMode === "weekdays" ? String(weekdays.length) : targetPerWeek}
                onChange={(event) => setTargetPerWeek(event.target.value)}
              />
              <small className="project-field-hint">
                {scheduleMode === "flexible"
                  ? "1–7 次，今日事项会显示本周进度。"
                  : "固定排期下由排期自动推算。"}
              </small>
            </label>
            <label>
              关联目标
              <SelectMenu
                ariaLabel="关联目标"
                value={goalId}
                onChange={setGoalId}
                options={[
                  { value: "", label: "不关联目标" },
                  ...activeGoals.map((goal) => ({
                    value: goal.id,
                    label: goal.title,
                  })),
                ]}
              />
              <small className="project-field-hint">所有进行中的目标都可以关联。</small>
            </label>
            <label>
              目标计量
              <SelectMenu
                ariaLabel="目标计量"
                value={goalMeasure}
                onChange={(value) => setGoalMeasure(value as "none" | "one" | "custom")}
                options={canMeasure
                  ? [
                      { value: "none", label: "不计入（只关联）" },
                      { value: "one", label: "算 1 个单位" },
                      { value: "custom", label: "自定义单位数" },
                    ]
                  : [{ value: "none", label: "不计入（只关联）" }]}
              />
              <small className="project-field-hint">
                打卡是否给目标算数，由你在这里显式声明。
              </small>
            </label>
            {goalMeasure === "custom" ? (
              <label>
                计入的单位数
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={goalContribution}
                  onChange={(event) => setGoalContribution(event.target.value)}
                />
              </label>
            ) : null}
            <label>
              目标打卡日数
              <input
                type="number"
                min={1}
                step={1}
                disabled={unlimitedDays || Boolean(goalId)}
                value={unlimitedDays ? "" : targetDays}
                placeholder="无限"
                onChange={(event) => setTargetDays(event.target.value)}
              />
              {goalId ? (
                <small className="project-field-hint">已关联目标，进度以目标为准。</small>
              ) : null}
            </label>
            <label className="settings-toggle habit-unlimited-toggle">
              <input
                type="checkbox"
                checked={unlimitedDays}
                disabled={Boolean(goalId)}
                onChange={(event) => setUnlimitedDays(event.target.checked)}
              />
              <span>
                <strong>无限期打卡</strong>
                <small>不设置目标打卡日数</small>
              </span>
            </label>
            <div className="project-edit-actions">
              <button
                type="button"
                className="btn-ghost item-action-btn"
                onClick={closeEditor}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn-primary item-action-btn item-action-primary"
                disabled={!title.trim() || saving}
              >
                {saving
                  ? editingHabit
                    ? "保存中…"
                    : "新建中…"
                  : editingHabit
                    ? "保存修改"
                    : "新建习惯"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

/**
 * 桌面习惯卡（项目页 B+ 同族）：收起＝今日金勾圈 + 名称 + 连续 chip + 排期说明 +
 * 本周比率胶囊；展开＝描边框内「本周七枚日期圈」直接补卡 + 四项数据栏，
 * 框底动作条与项目/标签页同一套。移动壳不走这里（HabitCard 维持已验收卡片流）。
 */
function HabitRow({
  habit,
  checks,
  today,
  open,
  onToggle,
  goal,
  goalTarget,
  archived = false,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  habit: Habit;
  checks: { check_date: string }[];
  today: string;
  open: boolean;
  onToggle: () => void;
  goal: Goal | null;
  goalTarget: GoalTarget | null;
  archived?: boolean;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const toggleHabitDay = useAppStore((s) => s.toggleHabitDay);
  const checkedToday = checks.some((item) => item.check_date === today);
  const weekDates = mondayWeekDates(today);
  const checkSet = new Set(checks.map((item) => item.check_date));
  const weekDone = weekDates.filter((date) => checkSet.has(date)).length;
  // 固定排期的习惯，「每周几次」由排期推算；浮动模式才用习惯自己设的值。
  const rule = parseRepeatRule(habit.repeat_rule ?? null);
  const weekTarget = weeklyTargetFromRule(rule) ?? habit.target_per_week;
  const scheduleText = describeHabitSchedule(rule);
  const dueToday = matchesRepeatRule(today, rule);
  const weekFull = weekDone >= weekTarget;
  const streak = (() => {
    let count = 0;
    const cursor = new Date(`${today}T12:00:00`);
    while (checkSet.has(toDateString(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  })();

  return (
    <ExpandRow
      open={open}
      onToggle={onToggle}
      className={archived ? "is-archived" : undefined}
      rowId={habit.id}
      leading={
        <button
          type="button"
          className={`proj-check habit-row-check${checkedToday ? " is-done" : ""}`}
          aria-label={checkedToday ? `取消完成 ${habit.title}` : `完成 ${habit.title}`}
          aria-pressed={checkedToday}
          title={checkedToday ? "取消今天的打卡" : "今天打卡"}
          onClick={() => void toggleHabitDay(habit.id, today)}
        />
      }
      title={
        <>
          {habit.title}
          {streak > 1 ? <span className="habit-streak-chip">连续 {streak} 天</span> : null}
        </>
      }
      meta={<>{scheduleText}{rule && !dueToday ? " · 今天休息" : ""}</>}
      trailing={
        <span className={`ratio-chip${weekFull ? " is-clear" : ""}`}>
          本周 {weekDone}/{weekTarget} 次
        </span>
      }
      toggleTitle={open ? "收起本周打卡" : "查看本周打卡并补卡"}
      foot={
        open ? (
          <div className="expand-row-foot">
            <button type="button" className="item-action-btn item-action-edit" onClick={onEdit}>
              <AppIcon name="edit" size={14} />
              <span>编辑</span>
            </button>
            {archived ? (
              <button type="button" className="item-action-btn item-action-archive item-action-restore" onClick={onRestore}>
                <AppIcon name="review" size={14} />
                <span>恢复</span>
              </button>
            ) : (
              <button type="button" className="item-action-btn item-action-archive" onClick={onArchive}>
                <AppIcon name="archive" size={14} />
                <span>归档</span>
              </button>
            )}
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
      <div className="habit-week-frame">
        <h4>本周 · {weekDates[0].slice(5).replace("-", "/")} – {weekDates[6].slice(5).replace("-", "/")}</h4>
        <div className="habit-week-strip">
          {weekDates.map((date) => {
            const done = checkSet.has(date);
            const restDay = rule ? !matchesRepeatRule(date, rule) : false;
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                className={[
                  "habit-day",
                  done ? "is-done" : "",
                  isToday ? "is-today" : "",
                  restDay && !done ? "is-rest" : "",
                ].filter(Boolean).join(" ")}
                aria-label={`${date}${done ? " 已打卡" : restDay ? " 排期休息日" : " 未打卡"}`}
                aria-pressed={done}
                title={done ? "取消这一天打卡" : restDay ? "排期休息日，也可补卡" : "补打这一天"}
                onClick={() => void toggleHabitDay(habit.id, date)}
              >
                <span className="habit-day-wd">{isToday ? "今" : WEEKDAY_LABELS.get(weekdayFromDate(date))}</span>
                <span className={`proj-check habit-day-check${done ? " is-done" : ""}`} />
                <span className="habit-day-num">{Number(date.slice(8, 10))}</span>
              </button>
            );
          })}
        </div>
        <div className="habit-stats-row">
          <span><em>连续</em><b>{streak}</b><small>天</small></span>
          <span><em>本周</em><b>{weekDone}</b><small>/{weekTarget} 次</small></span>
          <span><em>累计打卡</em><b>{checks.length}</b><small>{habit.target_days ? `/${habit.target_days} 天` : " 天"}</small></span>
          {goal ? (
            <span>
              <em>{goal.title}</em>
              <b>{Math.round(goal.current_value * 100) / 100}</b>
              <small>/{Math.round((goalTarget?.value ?? 0) * 100) / 100}{goalTarget?.unit ?? goal.unit}</small>
            </span>
          ) : (
            <span><em>排期</em><b>{scheduleText}</b></span>
          )}
        </div>
      </div>
    </ExpandRow>
  );
}

/**
 * 移动壳习惯卡（2026-10-30 甲案，并入项目页移动卡族）：行即白卡、点卡展开；
 * 折叠＝标题行（连续 chip + 右置今日勾圈，.mtoday-check 同款）＋子行（排期/本周
 * 注记 + 七枚日期圈直接补卡）；展开＝四格数据栏 + 通栏动作条。
 * 勾圈与日期圈都是 toggle 之外的独立动作（subline 空白处点按=展开）。
 */
function HabitCard({
  habit,
  checks,
  today,
  open,
  onToggle,
  archived = false,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  habit: Habit;
  checks: { check_date: string }[];
  today: string;
  open: boolean;
  onToggle: () => void;
  goal: Goal | null;
  goalTarget: GoalTarget | null;
  archived?: boolean;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const toggleHabitDay = useAppStore((s) => s.toggleHabitDay);
  const checkedToday = checks.some((item) => item.check_date === today);
  const weekDates = mondayWeekDates(today);
  const weekDone = checks.filter(
    (item) => item.check_date >= weekDates[0] && item.check_date <= weekDates[6],
  ).length;
  // 固定排期的习惯，「每周几次」由排期推算；浮动模式才用习惯自己设的值。
  const rule = parseRepeatRule(habit.repeat_rule ?? null);
  const weekTarget = weeklyTargetFromRule(rule) ?? habit.target_per_week;
  const scheduleText = describeHabitSchedule(rule);
  const dueToday = matchesRepeatRule(today, rule);
  const weekFull = weekDone >= weekTarget;
  const streak = (() => {
    const dates = new Set(checks.map((item) => item.check_date));
    let count = 0;
    const cursor = new Date(`${today}T12:00:00`);
    while (dates.has(toDateString(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  })();

  return (
    <ExpandRow
      open={open}
      onToggle={onToggle}
      className={archived ? "is-archived" : undefined}
      rowId={habit.id}
      leading={
        <button
          type="button"
          className={`mtoday-check mhabit-row-check${checkedToday ? " is-done" : ""}`}
          aria-label={checkedToday ? `取消打卡 ${habit.title}` : `打卡 ${habit.title}`}
          aria-pressed={checkedToday}
          title={checkedToday ? "取消今天的打卡" : "今天打卡"}
          onClick={() => void toggleHabitDay(habit.id, today)}
        />
      }
      title={
        <>
          {habit.title}
          {streak > 1 ? <span className="habit-streak-chip">连续 {streak} 天</span> : null}
        </>
      }
      toggleTitle={open ? "收起数据与操作" : "查看数据与操作"}
      subline={
        <div className="mhabit-sub" role="presentation" onClick={onToggle}>
          <p className="mhabit-subrow">
            <span className="mhabit-schedule">
              {scheduleText}
              {rule && !dueToday ? " · 今天不做" : ""}
            </span>
            <span className={`mhabit-weekcount${weekFull ? " is-full" : ""}`}>
              本周 {weekDone}/{weekTarget} 次
            </span>
          </p>
          {/* 周一→周日七列均分的日期圈：点圈直接补卡（与桌面周历同一读法），
              实色=打过、accent 环=今天、虚线=排期外；独立于卡片的展开点按。 */}
          <div className="mhabit-week">
            {weekDates.map((date) => {
              const done = checks.some((item) => item.check_date === date);
              const restDay = rule ? !matchesRepeatRule(date, rule) : false;
              const isToday = date === today;
              return (
                <button
                  key={date}
                  type="button"
                  className={[
                    "mhabit-day",
                    done ? "is-done" : "",
                    isToday ? "is-today" : "",
                    restDay && !done ? "is-rest" : "",
                  ].filter(Boolean).join(" ")}
                  aria-label={`${date}${done ? " 已打卡" : restDay ? " 排期休息日" : " 未打卡"}`}
                  aria-pressed={done}
                  title={done ? "取消这一天打卡" : restDay ? "排期休息日，也可补卡" : "补打这一天"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleHabitDay(habit.id, date);
                  }}
                >
                  <span className="mhabit-day-dot" aria-hidden="true" />
                  <span className="mhabit-day-wd">
                    {isToday ? "今" : WEEKDAY_LABELS.get(weekdayFromDate(date))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      }
      foot={
        open ? (
          <div className="expand-row-foot">
            <button type="button" className="item-action-btn item-action-edit" onClick={onEdit}>
              <AppIcon name="edit" size={14} />
              <span>编辑</span>
            </button>
            {archived ? (
              <button type="button" className="item-action-btn item-action-archive item-action-restore" onClick={onRestore}>
                <AppIcon name="review" size={14} />
                <span>恢复</span>
              </button>
            ) : (
              <button type="button" className="item-action-btn item-action-archive" onClick={onArchive}>
                <AppIcon name="archive" size={14} />
                <span>归档</span>
              </button>
            )}
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
    />
  );
}
