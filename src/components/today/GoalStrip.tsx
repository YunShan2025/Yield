import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAppStore } from "@/store/app";
import { fetchGoals } from "@/lib/db";
import { calculateGoalProgress, goalAcceptsSource, resolveGoalTarget } from "@/lib/growth";
import { AppIcon } from "@/components/AppIcon";
import type { Goal } from "@/types";

/**
 * 今日页的目标条：把"长期方向"压缩成一行可执行入口，
 * 让目标在每日流程里有存在感，而不必先跳去成长页。
 */
export function GoalStrip() {
  const [goals, setGoals] = useState<Goal[]>([]);

  // 目标进度在同步后才会被复算，这里跟随同一条事件重载，今日页才不落后于成长页。
  useEffect(() => {
    const reload = () => void fetchGoals().then(setGoals);
    reload();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
  }, []);

  const activeGoals = useMemo(
    () => goals.filter((goal) => goal.status === "active"),
    [goals],
  );

  if (!activeGoals.length) return null;

  return (
    <section className="today-goal-strip" aria-label="本周目标">
      <div className="today-goal-strip-head">
        <span>本周目标</span>
        <button
          type="button"
          onClick={() => useAppStore.getState().setNav("growth")}
        >
          成长页
        </button>
      </div>
      <div className="today-goal-rows">
        {activeGoals.map((goal) => {
          // 分母与进度一律走 growth 的唯一真源，今日条与目标卡不再各取一套。
          const target = resolveGoalTarget(goal);
          const progress = calculateGoalProgress(goal);
          // 只有接受"任务完成自动计量"的目标才给「推进」入口：
          // 阶段型目标由阶段勾选推进，数值变化型只认手动测量。
          const canSchedule = goalAcceptsSource(goal, "task");
          return (
            <div key={goal.id} className="today-goal-row">
              <button
                type="button"
                className="today-goal-main"
                style={{ "--goal-color": goal.color } as CSSProperties}
                title="查看目标详情"
                onClick={() => {
                  useAppStore.getState().requestFocus({ kind: "goal", id: goal.id });
                  useAppStore.getState().setNav("growth");
                }}
              >
                <i aria-hidden />
                <span className="today-goal-name">{goal.title}</span>
                <span className="today-goal-value">
                  {Math.round(goal.current_value * 10) / 10}/{Math.round(target.value * 10) / 10}{target.unit}
                </span>
                <span className="today-goal-track">
                  <i style={{ width: `${Math.round(progress)}%` }} />
                </span>
              </button>
              {canSchedule && (
                <button
                  type="button"
                  className="item-action-btn"
                  title="为该目标安排今天的行动"
                  onClick={() => useAppStore.getState().openCreateTask({ goalId: goal.id })}
                >
                  <AppIcon name="play" size={14} />
                  <span>推进</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
