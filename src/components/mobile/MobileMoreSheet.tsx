import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { MobilePageTitle } from "@/components/mobile/MobilePageTitle";
import { useAppStore } from "@/store/app";
import type { NavId } from "@/types";

/** 更多页按侧栏典故分组的次级入口（MOBILE-IA §3.2）。
 *  分组头只留一句白话释义，典故全文收在「设置 · 命名缘起」；
 *  图标口径与桌面侧栏 NavSidebar 对齐（周清单 checklist、纪念日 gift）。 */
const MORE_GROUPS: {
  name: string;
  gloss?: string;
  items: { id: NavId; label: string; icon: AppIconName }[];
}[] = [
  {
    name: "积微",
    gloss: "每天的小积累",
    items: [{ id: "week", label: "周清单", icon: "checklist" }],
  },
  {
    name: "有恒",
    gloss: "成长靠的是不间断",
    items: [
      { id: "growth", label: "成长", icon: "sparkle" },
      { id: "habits", label: "习惯", icon: "heart" },
      { id: "review", label: "复盘", icon: "review" },
    ],
  },
  {
    name: "百工",
    gloss: "先利其器，再善其事",
    items: [
      { id: "reminders", label: "提醒", icon: "timer" },
      { id: "memos", label: "备忘录", icon: "memo" },
      { id: "projects", label: "项目", icon: "layers" },
      { id: "tags", label: "标签", icon: "tag" },
    ],
  },
  {
    name: "更多",
    items: [
      { id: "anniversaries", label: "纪念日", icon: "gift" },
      { id: "settings", label: "设置", icon: "settings" },
      { id: "trash", label: "回收站", icon: "trash" },
    ],
  },
];

/** 更多页：底部导航上方的面板。骨架与「今日 / 待办 / 记账」共用一套
 *  （mtoday-top 页头 + mtoday-scroll 卡片流），入口行沿用记账明细行的
 *  行式语言：图标方块在左、标题随行、右缘箭头提示可点。
 *  导航交给 onNavigate（MainApp 维护返回键语义）；底部导航常驻可见，
 *  返回键也可收起本面板，不再需要「完成」按钮。 */
export function MobileMoreSheet({ onNavigate }: { onNavigate: (id: NavId) => void }) {
  // 全局搜索入口：移动壳没有标题栏，桌面端收进标题栏的搜索只能放到这里
  // （页头右上圆钮，与「今日」页的搜索同位同样式）。
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);

  return (
    <div className="mobile-more" role="dialog" aria-label="更多页面">
      <header className="mtoday-top">
        <div className="mtoday-top-text">
          <MobilePageTitle text="更多" />
          <p>服田力穑，乃亦有秋</p>
        </div>
        <button
          type="button"
          className="mtoday-icon-btn"
          aria-label="搜索"
          onClick={openCommandPalette}
        >
          <AppIcon name="search" size={19} />
        </button>
      </header>

      <div className="mtoday-scroll">
        {MORE_GROUPS.map((group) => (
          <section
            key={group.name}
            className="mtoday-card mmore-group"
            aria-label={group.name}
          >
            <div className="mtoday-shead">
              <h3>{group.name}</h3>
              {group.gloss ? <span className="mtoday-hint">{group.gloss}</span> : null}
            </div>
            <ul className="mmore-list">
              {group.items.map(({ id, label, icon }) => (
                <li key={id}>
                  <button
                    type="button"
                    className="mmore-item"
                    onClick={() => onNavigate(id)}
                  >
                    <span className="mmore-icon" aria-hidden="true">
                      <AppIcon name={icon} size={17} />
                    </span>
                    <span className="mmore-label">{label}</span>
                    <span className="mmore-go" aria-hidden="true">
                      <AppIcon name="chevron" size={16} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <footer className="mmore-foot">
          <AppIcon name="brand" size={14} />
          <span>典故全文见「设置 · 命名缘起」</span>
        </footer>
      </div>
    </div>
  );
}
