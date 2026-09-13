import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import { fetchGoals, updateHabitGoal } from "@/lib/db";
import type { Goal } from "@/types";
import { SelectMenu } from "@/components/SelectMenu";

export function HabitsView() {
  const habits = useAppStore((s) => s.habits);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const addHabit = useAppStore((s) => s.addHabit);
  const removeHabit = useAppStore((s) => s.removeHabit);
  const toggleHabitDay = useAppStore((s) => s.toggleHabitDay);
  const [title, setTitle] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const today = todayDateString();

  useEffect(() => {
    void fetchGoals().then(setGoals);
  }, []);

  const weekDates = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    const start = new Date(d);
    start.setDate(d.getDate() - day);
    return Array.from({ length: 7 }, (_, i) => {
      const x = new Date(start);
      x.setDate(start.getDate() + i);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    });
  }, []);

  const submitHabit = () => {
    if (!title.trim()) return;
    void addHabit(title.trim(), 3);
    setTitle("");
  };

  return (
    <main className="main-workspace habits-view">
      {/* 与「今日」同构的标题区:h2 标题 + 副标题,右侧直达「添加习惯」。 */}
      <div className="workspace-top">
        <div>
          <h2>习惯</h2>
          <p className="workspace-subtitle">每天打一次卡，连续天数会替你记得。</p>
        </div>
        <div className="top-controls">
          <input
            className="field habits-name-input"
            placeholder="习惯名称"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitHabit();
            }}
          />
          <button type="button" className="btn-primary" onClick={submitHabit}>
            添加
          </button>
        </div>
      </div>
      <div className="habits-body">
      {/* 与「今日/成长」同款的暖色引导框。 */}
      <section className="today-hero guide-hero">
        <div className="today-hero-copy">
          <span className="today-eyebrow">有恒 · 习惯</span>
          <h3>让坚持成为默认选项。</h3>
          <p className="today-hero-note">小步不断，胜过心血来潮。</p>
        </div>
      </section>

      {!habits.length ? (
        <div className="empty-state">创建第一个习惯开始追踪。</div>
      ) : (
        habits.map((habit) => {
          const checks = habitChecks.filter((c) => c.habit_id === habit.id);
          const weekCount = checks.filter((c) => weekDates.includes(c.check_date)).length;
          const streak = (() => {
            let s = 0;
            const set = new Set(checks.map((c) => c.check_date));
            const cursor = new Date(`${today}T12:00:00`);
            while (set.has(
              `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
            )) {
              s += 1;
              cursor.setDate(cursor.getDate() - 1);
            }
            return s;
          })();

          return (
            <section key={habit.id} className="habits-card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong className={streak > 0 ? "streak-pop" : ""}>
                  {habit.title}
                </strong>
                <button
                  type="button"
                  className="btn-ghost danger"
                  onClick={() => void removeHabit(habit.id)}
                >
                  删除
                </button>
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                本周 {weekCount}/{habit.target_per_week} · 连续 {streak} 天
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <SelectMenu
                  className="field"
                  ariaLabel="关联成长目标"
                  value={habit.goal_id ?? ""}
                  onChange={(value) =>
                    void updateHabitGoal(
                      habit.id,
                      value || null,
                      habit.goal_contribution,
                    ).then(() => useAppStore.getState().refreshAll())
                  }
                  options={[{ value: "", label: "不关联成长目标" }, ...goals.filter((goal) =>
                    goal.status === "active" &&
                    ["quantity", "frequency"].includes(goal.goal_type)
                  ).map((goal) => ({ value: goal.id, label: goal.title }))]}
                />
                <input
                  className="field"
                  type="number"
                  min={0.1}
                  step={0.1}
                  title="每次打卡贡献值"
                  style={{ width: 88 }}
                  value={habit.goal_contribution}
                  onChange={(event) =>
                    void updateHabitGoal(
                      habit.id,
                      habit.goal_id,
                      Math.max(0.1, Number(event.target.value) || 1),
                    ).then(() => useAppStore.getState().refreshAll())
                  }
                />
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {weekDates.map((date) => {
                  const on = checks.some((c) => c.check_date === date);
                  return (
                    <button
                      key={date}
                      type="button"
                      className={`tag-pill ${on ? "on" : ""}`}
                      onClick={() => void toggleHabitDay(habit.id, date)}
                    >
                      {date.slice(8)}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })
      )}
      </div>
    </main>
  );
}
