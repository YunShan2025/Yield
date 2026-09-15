import { useAppStore } from "@/store/app";
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

export function MobileMoreSheet({ onClose }: { onClose: () => void }) {
  const setNav = useAppStore((s) => s.setNav);

  return (
    <div className="mobile-more" role="dialog" aria-label="更多页面">
      <header className="mobile-more-head">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden>
            <AppIcon name="brand" size={18} />
          </span>
          <div>
            <h1>有秋</h1>
            <span className="brand-caption">Yield · 服田力穑，乃亦有秋</span>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost mobile-more-close"
          aria-label="关闭更多"
          onClick={onClose}
        >
          完成
        </button>
      </header>
      <div className="mobile-more-grid">
        {MORE_ITEMS.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            className="mobile-more-item"
            onClick={() => {
              onClose();
              setNav(id);
            }}
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
