import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { useAppStore } from "@/store/app";
import type { NavId } from "@/types";

/** 更多页按侧栏典故分组的次级入口（MOBILE-IA §3.2）。 */
const MORE_GROUPS: {
  name: string;
  origin: string;
  items: { id: NavId; label: string; icon: AppIconName }[];
}[] = [
  {
    name: "积微",
    origin: "《荀子·强国》「积微，月不胜日。」每天的小积累，胜过攒着一起做",
    items: [{ id: "week", label: "周清单", icon: "review" }],
  },
  {
    name: "观澜",
    origin: "《孟子·尽心上》「观水有术，必观其澜。」收支如水，可观其波澜",
    items: [{ id: "ledger", label: "收支总览", icon: "wallet" }],
  },
  {
    name: "有恒",
    origin: "《论语·述而》「得见有恒者，斯可矣。」成长靠的是不间断的人",
    items: [
      { id: "growth", label: "成长", icon: "sparkle" },
      { id: "habits", label: "习惯", icon: "heart" },
      { id: "review", label: "复盘", icon: "review" },
    ],
  },
  {
    name: "百工",
    origin: "《论语·子张》「百工居肆以成其事。」先利其器，再善其事",
    items: [
      { id: "reminders", label: "提醒", icon: "timer" },
      { id: "memos", label: "备忘录", icon: "memo" },
      { id: "projects", label: "项目", icon: "layers" },
      { id: "tags", label: "标签", icon: "tag" },
    ],
  },
  {
    name: "更多",
    origin: "",
    items: [
      { id: "anniversaries", label: "纪念日", icon: "heart" },
      { id: "settings", label: "设置", icon: "settings" },
      { id: "trash", label: "回收站", icon: "trash" },
    ],
  },
];

/** 更多页：底部导航上方的面板。导航交给 onNavigate（MainApp 维护返回键语义）；
 *  底部导航常驻可见，返回键也可收起本面板，不再需要「完成」按钮。 */
export function MobileMoreSheet({ onNavigate }: { onNavigate: (id: NavId) => void }) {
  // 全局搜索入口：移动壳没有标题栏，桌面端收进标题栏的搜索只能放到这里。
  const openCommandPalette = useAppStore((s) => s.openCommandPalette);

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
          className="mobile-more-search"
          onClick={openCommandPalette}
        >
          <AppIcon name="search" size={18} />
          <span>搜索</span>
        </button>
      </header>
      {MORE_GROUPS.map((group) => (
        <section key={group.name} className="mobile-more-group">
          <div className="mobile-more-group-head">
            <h3>{group.name}</h3>
            <p>{group.origin}</p>
          </div>
          <div className="mobile-more-list">
            {group.items.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                className="mobile-more-item"
                onClick={() => onNavigate(id)}
              >
                <span className="mobile-more-icon">
                  <AppIcon name={icon} size={19} />
                </span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
