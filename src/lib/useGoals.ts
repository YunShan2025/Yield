import { useEffect, useMemo, useState } from "react";

import { fetchGoals } from "@/lib/db";
import type { Goal } from "@/types";

/**
 * 目标表（含归档）：任务行内的「目标」徽标要的是标题和颜色。
 *
 * 含归档是为了历史关联行不丢徽标。目标进度这类派生数据住在库里，写库成功才有最终
 * 值，故同时跟随「写完了」与「同步落了」两条事件重载；放在宿主页面里取一次、把
 * `goalById` 交给行件，别让每行各自去查库。
 */
export function useGoals(): { goals: Goal[]; goalById: Map<string, Goal> } {
  const [goals, setGoals] = useState<Goal[]>([]);

  useEffect(() => {
    const reload = () => void fetchGoals(true).then(setGoals);
    reload();
    window.addEventListener("youqiu:data-changed", reload);
    window.addEventListener("youqiu:sync-applied", reload);
    return () => {
      window.removeEventListener("youqiu:data-changed", reload);
      window.removeEventListener("youqiu:sync-applied", reload);
    };
  }, []);

  const goalById = useMemo(
    () => new Map(goals.map((goal) => [goal.id, goal])),
    [goals],
  );

  return { goals, goalById };
}
