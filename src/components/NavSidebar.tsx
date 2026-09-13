import { useMemo } from "react";
import { useAppStore } from "@/store/app";
import { todayDateString } from "@/lib/dates";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { isInboxTask, isActiveTask } from "@/lib/tasks";
import type { NavId } from "@/types";

type NavSidebarProps = {
  onCollapse?: () => void;
  onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResetWidth?: () => void;
};

type NavEntry = {
  id: NavId;
  label: string;
  icon: AppIconName;
  count?: number | null;
};

export function NavSidebar({ onCollapse, onResizeStart, onResetWidth }: NavSidebarProps) {
  const nav = useAppStore((s) => s.nav);
  const setNav = useAppStore((s) => s.setNav);
  const tasks = useAppStore((s) => s.tasks);

  const counts = useMemo(() => {
    const today = todayDateString();
    const roots = tasks.filter((t) => !t.parent_id);
    return {
      today: roots.filter(
        (t) => isActiveTask(t) && t.due_date === today,
      ).length,
      inbox: roots.filter((t) => isInboxTask(t, today)).length,
    };
  }, [tasks]);

  const sections: { label: string; note?: string; items: NavEntry[] }[] = [
    {
      label: "积微",
      note: "积微 —— 《荀子·强国》：「积微，月不胜日。」每天的小积累，胜过攒着一起做。",
      items: [
        { id: "today", label: "今日", icon: "today", count: counts.today },
        { id: "inbox", label: "待办箱", count: counts.inbox, icon: "inbox" },
        { id: "week", label: "周清单", icon: "review" },
      ],
    },
    {
      label: "观澜",
      note: "观澜 —— 《孟子·尽心上》：「观水有术，必观其澜。」收支如水，可观其波澜。",
      items: [{ id: "ledger", label: "收支总览", icon: "wallet" }],
    },
    {
      label: "有恒",
      note: "有恒 —— 《论语·述而》：「得见有恒者，斯可矣。」成长靠的是不间断的人。",
      items: [
        { id: "growth", label: "成长", icon: "sparkle" },
        { id: "habits", label: "习惯", icon: "heart" },
        { id: "review", label: "复盘", icon: "review" },
      ],
    },
    {
      label: "百工",
      note: "百工 —— 《论语·子张》：「百工居肆以成其事。」先利其器，再善其事。",
      items: [
        { id: "reminders", label: "提醒", icon: "timer" },
        { id: "memos", label: "备忘录", icon: "memo" },
        { id: "projects", label: "项目", icon: "layers" },
      ],
    },
    {
      label: "更多",
      items: [
        { id: "anniversaries", label: "纪念日", icon: "heart" },
        { id: "tags", label: "标签", icon: "tag" },
        { id: "settings", label: "设置", icon: "settings" },
        { id: "trash", label: "回收站", icon: "trash" },
      ],
    },
  ];

  return (
    <aside className="nav-side">
      <div className="nav-side-scroll">
      <div className="brand-row">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden><AppIcon name="brand" size={18} /></span>
          <div>
            <h1>有秋</h1>
            <span className="brand-caption">Yield · 服田力穑，乃亦有秋</span>
          </div>
        </div>
      </div>

      {sections.map((section) => (
        <div key={section.label} className="nav-section">
          <div className="nav-section-label" title={section.note}>{section.label}</div>
          {section.items.map(({ id, label, icon, count }) => (
            <button
              key={id}
              type="button"
              className={`nav-item ${nav === id ? "active" : ""}`}
              onClick={() => setNav(id)}
            >
              <span className="nav-item-label"><AppIcon name={icon} size={17} />{label}</span>
              {count != null ? <span className="nav-count">{count}</span> : null}
            </button>
          ))}
        </div>
      ))}
      </div>
      {onResizeStart ? (
        <div
          className="nav-resize-handle"
          title="拖动调整侧栏宽度，双击恢复默认"
          onPointerDown={onResizeStart}
          onDoubleClick={onResetWidth}
        />
      ) : null}
      {onCollapse ? (
        <button
          type="button"
          className="nav-edge-collapse"
          title="折叠侧栏，主区域占满窗口"
          aria-label="折叠侧栏"
          onClick={onCollapse}
        >
          ◂
        </button>
      ) : null}
    </aside>
  );
}
