import { useEffect, useState } from "react";
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
} from "@/lib/repeat";
import { WeekdayPicker } from "@/components/WeekdayPicker";
import { SelectMenu } from "@/components/SelectMenu";
import { MobileGuideCard } from "@/components/mobile/MobileGuideCard";
import { isMobileShell } from "@/lib/platform";
import { MobileTitleChars } from "@/components/mobile/MobilePageTitle";
import { confirmAction } from "@/components/AppConfirm";
import type { RepeatRule } from "@/types";

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
    if (ok) void removeHabit(habit.id);
  };

  return (
    <main className="main-workspace habits-view">
      <div className="workspace-top">
        <div>
          <h2 aria-label={isMobileShell() ? "习惯" : undefined}>

            {isMobileShell() ? <MobileTitleChars text="习惯" /> : "习惯"}

          </h2>
          <p className="workspace-subtitle">每天打一次卡，连续天数会替你记得。</p>
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
          />
        ) : (
          <section className="today-hero guide-hero">
            <div className="today-hero-copy">
              <h3>让坚持成为默认选项。</h3>
              <p className="today-hero-note">小步不断，胜过心血来潮。</p>
            </div>
          </section>
        )}

        <section>
          <div className="section-title-row">
            <h3>进行中</h3>
            <span className="tags-filtered-count">{inProgress.length}</span>
          </div>
          <div className="habits-grid">
            {inProgress.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                checks={checksFor(habit.id)}
                today={today}
                {...linkedGoalFor(habit)}
                onEdit={() => openEdit(habit)}
                onArchive={() => void archiveHabit(habit.id)}
                onDelete={() => void removeHabitWithConfirm(habit)}
              />
            ))}
            {!inProgress.length ? (
              <div className="scope-empty">还没有已开始打卡的习惯。</div>
            ) : null}
          </div>
        </section>

        <section aria-label="未开始习惯">
          <div className="section-title-row">
            <h3>未开始</h3>
            <span className="tags-filtered-count">{notStarted.length}</span>
          </div>
          <div className="habits-grid">
            {notStarted.map((habit) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                checks={[]}
                today={today}
                {...linkedGoalFor(habit)}
                onEdit={() => openEdit(habit)}
                onArchive={() => void archiveHabit(habit.id)}
                onDelete={() => void removeHabitWithConfirm(habit)}
              />
            ))}
            {!notStarted.length ? (
              <div className="scope-empty">创建第一个习惯开始追踪。</div>
            ) : null}
          </div>
        </section>

        {archivedHabits.length ? (
          <section aria-label="已归档习惯">
            <div className="section-title-row">
              <h3>已归档</h3>
              <span className="tags-filtered-count">{archivedHabits.length}</span>
            </div>
            <div className="habits-grid">
              {archivedHabits.map((habit) => (
                <HabitCard
                  key={habit.id}
                  habit={habit}
                  checks={habitChecks.filter((item) => item.habit_id === habit.id)}
                  today={today}
                  archived
                  {...linkedGoalFor(habit)}
                  onEdit={() => openEdit(habit)}
                  onRestore={() => void restoreHabit(habit.id)}
                  onDelete={() => void removeHabitWithConfirm(habit)}
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {creating || editingHabit ? (
        <div className="modal-backdrop" onMouseDown={closeEditor}>
          <form
            className="project-edit-modal"
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
              <button type="button" onClick={closeEditor}>×</button>
            </div>
            <label>
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
                  { value: "flexible", label: "每周若干次（不指定日子）" },
                  { value: "daily", label: "每天" },
                  { value: "weekdays", label: "每周指定几天" },
                ]}
              />
              <small className="project-field-hint">
                今日事项只列出今天该做的习惯；重复性的事请建习惯，别建任务。
              </small>
            </label>
            {scheduleMode === "weekdays" ? (
              <label>
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
              关联成长目标
              <SelectMenu
                ariaLabel="关联成长目标"
                value={goalId}
                onChange={setGoalId}
                options={[
                  { value: "", label: "不关联成长目标" },
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
                <small className="project-field-hint">已关联成长目标，进度以目标为准。</small>
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

function HabitCard({
  habit,
  checks,
  today,
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
  goal: Goal | null;
  goalTarget: GoalTarget | null;
  archived?: boolean;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
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
    <section
      className={`habits-card habit-card${checkedToday ? " is-checked" : ""}${archived ? " is-archived" : ""}`}
    >
      <div className="habit-card-main">
        <div className="habits-card-head">
          <strong className={streak > 0 ? "streak-pop" : ""}>{habit.title}</strong>
        </div>
        <p className="habits-card-meta">
          {goal
            ? `目标进度 ${Math.round(goal.current_value * 100) / 100}/${Math.round((goalTarget?.value ?? 0) * 100) / 100}${goalTarget?.unit ?? goal.unit}`
            : habit.target_days
              ? `已打卡 ${checks.length}/${habit.target_days} 天`
              : `已打卡 ${checks.length} 天`}
          <span> · 连续 {streak} 天</span>
        </p>
        <p className="habits-card-schedule">
          {scheduleText}
          {rule && !dueToday ? " · 今天不做" : ""}
        </p>
        <div
          className={`habit-week-progress${weekFull ? " is-full" : ""}`}
          aria-label={`本周已打卡 ${weekDone}/${weekTarget} 次`}
        >
          <em>
            本周 {weekDone}/{weekTarget} 次
          </em>
        </div>
      </div>
      <div className="habit-card-actions">
        <button
          type="button"
          className="habit-action-btn habit-edit-btn"
          onClick={onEdit}
        >
          <AppIcon name="edit" size={14} />
          <span>编辑</span>
        </button>
        {archived ? (
          <button
            type="button"
            className="habit-action-btn habit-archive-btn"
            onClick={onRestore}
          >
            <AppIcon name="review" size={14} />
            <span>恢复</span>
          </button>
        ) : (
          <button
            type="button"
            className="habit-action-btn habit-archive-btn"
            onClick={onArchive}
          >
            <AppIcon name="archive" size={14} />
            <span>归档</span>
          </button>
        )}
        <button
          type="button"
          className="habit-action-btn habit-delete-btn quiet-danger"
          onClick={onDelete}
        >
          <AppIcon name="trash" size={14} />
          <span>删除</span>
        </button>
      </div>
    </section>
  );
}
