import { AppIcon, type AppIconName } from "@/components/AppIcon";
import type { NavId } from "@/types";

/** 更多页收纳的次级入口:今日/待办箱/记账已在底部导航,其余全部收进这里。 */
const MORE_ITEMS: { id: NavId; label: string; icon: AppIconName }[] = [
  { id: "week", label: "周清单", icon: "review" },
  { id: "growth", label: "成长", icon: "sparkle" },
  { id: "habits", label: "习惯", icon: "heart" },
  { id: "review", label: "复盘", icon: "review" },
  { id: "reminders", label: "提醒", icon: "timer" },
  { id: "memos", label: "备忘录", icon: "memo" },
  { id: "projects", label: "项目", icon: "layers" },
  { id: "ledger", label: "收支总览", icon: "wallet" },
  { id: "anniversaries", label: "纪念日", icon: "heart" },
  { id: "tags", label: "标签", icon: "tag" },
  { id: "trash", label: "回收站", icon: "trash" },
  { id: "settings", label: "设置", icon: "settings" },
];

/** 更多页：底部导航上方的面板。导航交给 onNavigate（MainApp 维护返回键语义）；
 *  底部导航常驻可见，返回键也可收起本面板，不再需要「完成」按钮。 */
export function MobileMoreSheet({ onNavigate }: { onNavigate: (id: NavId) => void }) {
  return (
    <div className="mobile-more" role="dialog" aria-label="更多页面">
      <header className="mobile-more-head">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden>
            <AppIcon name="brand" size={18} />
          </span>
          <div>
            <h1>更多</h1>
            <span className="brand-caption">周清单 · 成长 · 习惯 · 设置</span>
          </div>
        </div>
      </header>
      <div className="mobile-more-grid">
        {MORE_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className="mobile-more-item"
            onClick={() => onNavigate(id)}
          >
            <span className="mobile-more-icon">
              <AppIcon name={icon} size={21} />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
