import { useEffect, useState } from "react";

import { todayDateString } from "@/lib/dates";

/**
 * 跨零点会自己翻页的「今天」。
 * 应用可能整夜开着；只在组件挂载时取一次日期，待办箱和今日页会在零点后继续
 * 按昨天计算。这里按分钟校准，且只在日期真正变化时触发重新渲染。
 */
export function useTodayDate(): string {
  const [today, setToday] = useState(todayDateString);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setToday((current) => {
        const next = todayDateString();
        return current === next ? current : next;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  return today;
}
