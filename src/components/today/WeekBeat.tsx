import { useMemo } from "react";
import { useAppStore } from "@/store/app";
import { mondayWeekDates } from "@/lib/weeklyChecklist";
import { currentDateStreak, localDateKey } from "@/lib/growth";
import { todayDateString } from "@/lib/dates";

/**
 * 本周节拍器：把"今日"和"本周"两个坐标系对齐。
 *
 * 今日页回答"今天做什么"，节拍器回答"这一周走到哪了"——习惯打卡、任务完成、
 * 连续天数三个数并排放在一块，用户一眼能看到节奏，而不是只有一屏待办。
 */
export function WeekBeat() {
  const habits = useAppStore((s) => s.habits);
  const habitChecks = useAppStore((s) => s.habitChecks);
  const tasks = useAppStore((s) => s.tasks);
  const today = todayDateString();
  const week = mondayWeekDates(today);

  const stats = useMemo(() => {
    const weekStart = week[0];
    const weekEnd = week[6];
    const checkDates = habitChecks
      .map((check) => check.check_date)
      .filter((date) => date >= weekStart && date <= weekEnd);
    const doneDates = tasks
      .filter(
        (task) =>
          !task.parent_id &&
          !task.deleted_at &&
          task.status === "completed" &&
          task.completed_at &&
          localDateKey(new Date(task.completed_at)) >= weekStart &&
          localDateKey(new Date(task.completed_at)) <= weekEnd,
      )
      .map((task) => localDateKey(new Date(task.completed_at!)));
    const activeDates = [...checkDates, ...doneDates];
    return {
      checks: checkDates.length,
      done: doneDates.length,
      streak: currentDateStreak(activeDates, today),
      habitCount: habits.length,
    };
  }, [habits.length, habitChecks, tasks, today, week]);

  if (!stats.checks && !stats.done) return null;

  return (
    <section className="today-week-beat" aria-label="本周节奏">
      <span className="today-week-beat-label">本周</span>
      <div className="today-week-beat-stats">
        <span>
          <strong>{stats.checks}</strong>
          <em>次打卡</em>
        </span>
        <span>
          <strong>{stats.done}</strong>
          <em>件事完成</em>
        </span>
        <span>
          <strong>{stats.streak}</strong>
          <em>天连续</em>
        </span>
      </div>
    </section>
  );
}