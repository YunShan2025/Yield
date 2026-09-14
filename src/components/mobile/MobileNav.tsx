import { useMemo } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import { computeNavCounts } from "@/lib/tasks";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

type MobileTab = {
  key: string;
  icon: AppIconName;
  label: string;
  count?: number;
  active: boolean;
  onPick: () => void;
};

/** 底部导航:今日 / 待办箱 / 记一笔 / 更多。「记一笔」直达账本快速录入面板。 */
export function MobileNav({ onMore }: { onMore: () => void }) {
  const nav = useAppStore((s) => s.nav);
  const setNav = useAppStore((s) => s.setNav);
  const openLedgerQuickAdd = useAppStore((s) => s.openLedgerQuickAdd);
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
      onPick: () => setNav("today"),
    },
    {
      key: "inbox",
      icon: "inbox",
      label: "待办箱",
      count: counts.inbox,
      active: nav === "inbox",
      onPick: () => setNav("inbox"),
    },
    {
      key: "ledger",
      icon: "wallet",
      label: "记一笔",
      active: nav === "ledger",
      onPick: openLedgerQuickAdd,
    },
    {
      key: "more",
      icon: "panel",
      label: "更多",
      active: false,
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
