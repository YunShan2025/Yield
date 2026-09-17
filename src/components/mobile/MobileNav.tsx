import { useMemo } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import { computeNavCounts } from "@/lib/tasks";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import type { NavId } from "@/types";

type MobileTab = {
  key: string;
  icon: AppIconName;
  label: string;
  count?: number;
  active: boolean;
  onPick: () => void;
};

/** 底部导航:今日 / 待办箱 / 记账 / 更多。「记账」切到账本页,录入走页面内入口。
 *  导航统一走 onNavigate(由 MainApp 提供):维护返回键语义与「更多」面板开关。 */
export function MobileNav({
  onMore,
  onNavigate,
  moreActive = false,
}: {
  onMore: () => void;
  onNavigate: (id: NavId) => void;
  moreActive?: boolean;
}) {
  const nav = useAppStore((s) => s.nav);
  const tasks = useAppStore((s) => s.tasks);

  const counts = useMemo(
    () => computeNavCounts(tasks, todayDateString()),
    [tasks],
  );

  const tabs: MobileTab[] = [
    {
      key: "today",
      icon: "today",
      label: "今日",
      count: counts.today,
      active: nav === "today",
      onPick: () => onNavigate("today"),
    },
    {
      key: "inbox",
      icon: "inbox",
      label: "待办箱",
      count: counts.inbox,
      active: nav === "inbox",
      onPick: () => onNavigate("inbox"),
    },
    {
      key: "ledger",
      icon: "wallet",
      label: "记账",
      active: nav === "ledger",
      onPick: () => onNavigate("ledger"),
    },
    {
      key: "more",
      icon: "panel",
      label: "更多",
      active: moreActive,
      onPick: onMore,
    },
  ];

  return (
    <nav className="mobile-nav" aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`mobile-nav-item ${tab.active ? "active" : ""}`}
          onClick={tab.onPick}
          aria-current={tab.active ? "page" : undefined}
        >
          <span className="mobile-nav-icon">
            <AppIcon name={tab.icon} size={22} />
            {tab.count ? (
              <i className="mobile-nav-badge">{tab.count > 99 ? "99+" : tab.count}</i>
            ) : null}
          </span>
          <span className="mobile-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
