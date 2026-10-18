import { useEffect, useState } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString, toDateString } from "@/lib/dates";
import { fetchGoals } from "@/lib/db";
import type { Goal, Habit } from "@/types";
import { AppIcon } from "@/components/AppIcon";
import { SelectMenu } from "@/components/SelectMenu";
import { confirmAction } from "@/components/AppConfirm";

export function HabitsView() {
  const habits = useAppStore((s) => s.habits);
  const archivedHabits = useAppStore((s) => s.archivedHabits);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const addHabit = useAppStore((s) => s.addHabit);
  const updateHabit = useAppStore((s) => s.updateHabit);
  const archiveHabit = useAppStore((s) => s.archiveHabit);
  const restoreHabit = useAppStore((s) => s.restoreHabit);
  const removeHabit = useAppStore((s) => s.removeHabit);
  const toggleHabitDay = useAppStore((s) => s.toggleHabitDay);
  const [creating, setCreating] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);
  const [title, setTitle] = useState("");
  const [goalId, setGoalId] = useState("");
  const [goalContribution, setGoalContribution] = useState("1");
  const [targetDays, setTargetDays] = useState("30");
  const [unlimitedDays, setUnlimitedDays] = useState(false);
  const [saving, setSaving] = useState(false);
  const [goals, setGoals] = useState<Goal[]>([]);
  const today = todayDateString();

  useEffect(() => {
    void fetchGoals().then(setGoals);
  }, []);

  const activeGoals = goals.filter(
    (goal) =>
      goal.status === "active" &&
      ["quantity", "frequency"].includes(goal.goal_type),
  );

  const checksFor = (habitId: string) =>
    habitChecks.filter((item) => item.habit_id === habitId);

  const inProgress = habits.filter((habit) => checksFor(habit.id).length > 0);
  const notStarted = habits.filter((habit) => checksFor(habit.id).length === 0);

  const openCreate = () => {
    setEditingHabit(null);
    setTitle("");
    setGoalId("");
    setGoalContribution("1");
    setTargetDays("30");
    setUnlimitedDays(false);
    setSaving(false);
    setCreating(true);
  };

  const openEdit = (habit: Habit) => {
    setCreating(false);
    setEditingHabit(habit);
    setTitle(habit.title);
    setGoalId(habit.goal_id ?? "");
    setGoalContribution(String(habit.goal_contribution || 1));
    setTargetDays(habit.target_days ? String(habit.target_days) : "30");
    setUnlimitedDays(habit.target_days === null);
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
    if (!Number.isFinite(contribution) || contribution < 0.1) {
      useAppStore.getState().setToast("请输入有效的每日打卡贡献值");
      return;
    }
    const rawTargetDays = Number(targetDays);
    if (!unlimitedDays && (!Number.isInteger(rawTargetDays) || rawTargetDays < 1)) {
      useAppStore.getState().setToast("目标打卡日数至少为 1 天");
      return;
    }
    setSaving(true);
    try {
      const draft = {
        title: habitTitle,
        goal_id: goalId || null,
        goal_contribution: contribution,
        target_days: unlimitedDays ? null : rawTargetDays,
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
          <h2>习惯</h2>
          <p className="workspace-subtitle">每天打一次卡，连续天数会替你记得。</p>
        </div>
        <div className="top-controls">
          <button type="button" className="btn-primary" onClick={openCreate}>
            ＋ 新建习惯
          </button>
        </div>
      </div>

      <div className="habits-body">
        <section className="today-hero guide-hero">
          <div className="today-hero-copy">
            <span className="today-eyebrow">有恒 · 习惯</span>
            <h3>让坚持成为默认选项。</h3>
            <p className="today-hero-note">小步不断，胜过心血来潮。</p>
          </div>
        </section>

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
                onCheck={() => void toggleHabitDay(habit.id, today)}
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
                onCheck={() => void toggleHabitDay(habit.id, today)}
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
                  onCheck={() => void toggleHabitDay(habit.id, today)}
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
                <span>有恒</span>
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
              <small className="project-field-hint">只支持累计数量和持续频率目标。</small>
            </label>
            <label>
              每日打卡贡献值
              <input
                type="number"
                min={0.1}
                step={0.1}
                value={goalContribution}
                onChange={(event) => setGoalContribution(event.target.value)}
              />
              <small className="project-field-hint">未关联成长目标时不会计入。</small>
            </label>
            <label>
              目标打卡日数
              <input
                type="number"
                min={1}
                step={1}
                disabled={unlimitedDays}
                value={unlimitedDays ? "" : targetDays}
                placeholder="无限"
                onChange={(event) => setTargetDays(event.target.value)}
              />
            </label>
            <label className="settings-toggle habit-unlimited-toggle">
              <input
                type="checkbox"
                checked={unlimitedDays}
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
                    : "创建中…"
                  : editingHabit
                    ? "保存修改"
                    : "创建习惯"}
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
  archived = false,
  onCheck,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
}: {
  habit: Habit;
  checks: { check_date: string }[];
  today: string;
  archived?: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onDelete: () => void;
}) {
  const checkedToday = checks.some((item) => item.check_date === today);
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
          {habit.target_days
            ? `已打卡 ${checks.length}/${habit.target_days} 天`
            : `已打卡 ${checks.length} 天`}
          <span> · 连续 {streak} 天</span>
        </p>
      </div>
      <div className="habit-card-actions">
        <button
          type="button"
          className={
            checkedToday
              ? "habit-action-btn habit-check-btn is-done"
              : "habit-action-btn habit-check-btn"
          }
          disabled={archived}
          onClick={onCheck}
        >
          <AppIcon name="check" size={15} />
          <span>{checkedToday ? "已打卡" : "打卡"}</span>
        </button>
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
          className="habit-action-btn habit-delete-btn"
          onClick={onDelete}
        >
          <AppIcon name="trash" size={14} />
          <span>删除</span>
        </button>
      </div>
    </section>
  );
}
