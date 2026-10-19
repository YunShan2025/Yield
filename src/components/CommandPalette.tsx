import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import {
  fetchAnniversaries,
  fetchGoals,
  fetchMemos,
  formatLedgerMoney,
  searchLedgerTransactions,
  type LedgerTransaction,
} from "@/lib/db";
import type { Anniversary, Goal, Memo } from "@/types";
import { isMobileShell } from "@/lib/platform";
import { pushBackHandler } from "@/lib/mobileBack";

type PaletteKind = "task" | "memo" | "ledger" | "goal" | "project" | "tag" | "anniversary";

interface PaletteItem {
  kind: PaletteKind;
  id: string;
  title: string;
  meta: string;
  /** 账本条目日期，用于跳转时切月。 */
  date?: string;
}

interface PaletteSection {
  kind: PaletteKind;
  label: string;
  icon: AppIconName;
  items: PaletteItem[];
}

const GOAL_TYPE_LABELS: Record<Goal["goal_type"], string> = {
  quantity: "数量",
  change: "变化",
  frequency: "频次",
  time: "时长",
  project: "项目",
  custom: "自定义",
};

function compactPreview(text: string, max = 44) {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max)}…` : plain;
}

export function CommandPalette() {
  const tasks = useAppStore((state) => state.tasks);
  const tags = useAppStore((state) => state.tags);
  const projects = useAppStore((state) => state.projects);
  const archivedProjects = useAppStore((state) => state.archivedProjects);
  const open = useAppStore((state) => state.commandPaletteOpen);
  const closePalette = useAppStore((state) => state.closeCommandPalette);

  const [query, setQuery] = useState("");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [ledgerHits, setLedgerHits] = useState<LedgerTransaction[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  // 点按遮罩关闭：按下与抬起都落在遮罩上才算「点在外面」。
  // 只用 mousedown 会在遮罩上按下、面板内抬起时误关；只用 click 又会被
  // 桌面端从输入框往外拖选文字（mouseup 落回遮罩）误判成外部点击。
  const backdropPressRef = useRef(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") useAppStore.getState().closeCommandPalette();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // 页内实体（备忘/目标/纪念日）是各视图的本地状态，打开面板时统一拉取一次。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      fetchMemos({ archived: "all" }),
      fetchGoals(true),
      fetchAnniversaries(),
    ])
      .then(([nextMemos, nextGoals, nextAnniversaries]) => {
        if (cancelled) return;
        setMemos(nextMemos);
        setGoals(nextGoals);
        setAnniversaries(nextAnniversaries);
      })
      .catch(() => {
        /* 单个实体加载失败不应挡住其它检索；错误在对应视图内可见。 */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // 账本数据按月在视图内加载，这里跨月检索，输入防抖后查询。
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setLedgerHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void searchLedgerTransactions(term, 6)
        .then(setLedgerHits)
        .catch(() => setLedgerHits([]));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  const sections = useMemo<PaletteSection[]>(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const matches = (...values: Array<string | null | undefined>) =>
      values.some((value) => (value ?? "").toLowerCase().includes(term));
    const next: PaletteSection[] = [];

    const taskItems = tasks
      .filter((task) => !task.deleted_at && matches(task.title, task.description, task.notes))
      .slice(0, 5)
      .map<PaletteItem>((task) => ({
        kind: "task",
        id: task.id,
        title: task.title,
        meta: task.due_date ?? (task.status === "completed" ? "已完成" : "待办"),
      }));
    if (taskItems.length) {
      next.push({ kind: "task", label: "任务", icon: "inbox", items: taskItems });
    }

    const memoItems = memos
      .filter((memo) => matches(memo.title, memo.content))
      .slice(0, 5)
      .map<PaletteItem>((memo) => ({
        kind: "memo",
        id: memo.id,
        title: memo.title || "无标题备忘",
        meta: memo.archived ? "已归档备忘" : compactPreview(memo.content) || "备忘录",
      }));
    if (memoItems.length) {
      next.push({ kind: "memo", label: "备忘录", icon: "memo", items: memoItems });
    }

    const ledgerItems = ledgerHits.map<PaletteItem>((tx) => ({
      kind: "ledger",
      id: String(tx.id),
      title: tx.note || tx.category_name,
      meta: `${tx.type === "expense" ? "支出" : "收入"} ${formatLedgerMoney(tx.amount_cents)} · ${tx.date}`,
      date: tx.date,
    }));
    if (ledgerItems.length) {
      next.push({ kind: "ledger", label: "账本", icon: "wallet", items: ledgerItems });
    }

    const goalItems = goals
      .filter((goal) => matches(goal.title, goal.description, goal.motivation))
      .slice(0, 5)
      .map<PaletteItem>((goal) => ({
        kind: "goal",
        id: goal.id,
        title: goal.title,
        meta: `${GOAL_TYPE_LABELS[goal.goal_type]} · ${goal.status === "archived" ? "已归档" : "目标"}`,
      }));
    if (goalItems.length) {
      next.push({ kind: "goal", label: "成长目标", icon: "sparkle", items: goalItems });
    }

    const projectItems = [...projects, ...archivedProjects]
      .filter((project) => matches(project.name))
      .slice(0, 5)
      .map<PaletteItem>((project) => ({
        kind: "project",
        id: project.id,
        title: project.name,
        meta: project.due_date ? `截止 ${project.due_date}` : project.archived ? "已归档项目" : "项目",
      }));
    if (projectItems.length) {
      next.push({ kind: "project", label: "项目", icon: "layers", items: projectItems });
    }

    const tagItems = tags
      .filter((tag) => matches(tag.name))
      .slice(0, 5)
      .map<PaletteItem>((tag) => ({
        kind: "tag",
        id: tag.id,
        title: tag.name,
        meta: "标签",
      }));
    if (tagItems.length) {
      next.push({ kind: "tag", label: "标签", icon: "tag", items: tagItems });
    }

    const anniversaryItems = anniversaries
      .filter((item) => matches(item.title, item.note))
      .slice(0, 5)
      .map<PaletteItem>((item) => ({
        kind: "anniversary",
        id: item.id,
        title: item.title,
        meta: `${item.event_date}${item.recur_yearly ? " · 每年" : ""}`,
      }));
    if (anniversaryItems.length) {
      next.push({ kind: "anniversary", label: "纪念日", icon: "heart", items: anniversaryItems });
    }

    return next;
  }, [query, tasks, memos, ledgerHits, goals, projects, archivedProjects, tags, anniversaries]);

  const flatResults = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );

  // 移动端：系统返回键/左缘右滑先收起搜索面板，而不是退出应用。
  useEffect(() => {
    if (!open || !isMobileShell()) return;
    return pushBackHandler(() => {
      inputRef.current?.blur();
      closePalette();
      setQuery("");
      return true;
    });
  }, [open, closePalette]);

  if (!open) return null;

  const close = () => {
    inputRef.current?.blur();
    closePalette();
    setQuery("");
  };

  const pick = (item: PaletteItem) => {
    // 触摸端点选结果后立即收起软键盘，避免跳转后键盘仍占着半个屏幕。
    inputRef.current?.blur();
    const store = useAppStore.getState();
    if (item.kind === "task") store.selectTask(item.id);
    if (item.kind === "tag") store.setActiveTag(item.id);
    if (item.kind === "memo") {
      store.requestFocus({ kind: "memo", id: item.id });
      store.setNav("memos");
    }
    if (item.kind === "goal") {
      store.requestFocus({ kind: "goal", id: item.id });
      store.setNav("growth");
    }
    if (item.kind === "project") {
      store.requestFocus({ kind: "project", id: item.id });
      store.setNav("projects");
    }
    if (item.kind === "anniversary") {
      store.requestFocus({ kind: "anniversary", id: item.id });
      store.setNav("anniversaries");
    }
    if (item.kind === "ledger") {
      store.requestFocus({ kind: "ledger", id: item.id, date: item.date });
      store.setNav("ledger");
    }
    close();
  };

  return (
    <div
      className="command-backdrop"
      onMouseDown={() => {
        backdropPressRef.current = true;
      }}
      onClick={() => {
        if (!backdropPressRef.current) return;
        backdropPressRef.current = false;
        close();
      }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-label="命令面板"
        onMouseDown={(event) => {
          backdropPressRef.current = false;
          event.stopPropagation();
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="command-search">
          <div className="command-search-field">
            <AppIcon name="search" size={18} />
            <input
              ref={inputRef}
              value={query}
              aria-label="全局搜索"
              placeholder="搜索任务、备忘、账本、目标…"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && flatResults.length) {
                  event.preventDefault();
                  setActiveIndex((current) => (current + 1) % flatResults.length);
                  return;
                }
                if (event.key === "ArrowUp" && flatResults.length) {
                  event.preventDefault();
                  setActiveIndex(
                    (current) => (current - 1 + flatResults.length) % flatResults.length,
                  );
                  return;
                }
                if (event.key !== "Enter") return;
                const first = flatResults[activeIndex] ?? flatResults[0];
                if (first) pick(first);
              }}
            />
            {query ? (
              <button
                type="button"
                className="command-search-clear"
                aria-label="清空搜索"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
              >
                <AppIcon name="close" size={14} />
              </button>
            ) : (
              <kbd className="command-search-hint" aria-hidden="true">Esc</kbd>
            )}
          </div>
        </div>

        {query.trim() ? (
          sections.map((section) => (
            <div key={section.kind}>
              <p className="command-label">
                {section.label}
                <small className="command-label-hint">↑↓ 选择 · Enter 打开</small>
                <small className="command-label-tap">点按打开</small>
              </p>
              <div className="command-results">
                {section.items.map((item) => (
                  <button
                    key={`${item.kind}-${item.id}`}
                    type="button"
                    className={
                      flatResults[activeIndex]?.id === item.id &&
                      flatResults[activeIndex]?.kind === item.kind
                        ? "active"
                        : undefined
                    }
                    onClick={() => pick(item)}
                  >
                    <AppIcon name={section.icon} size={16} />
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </button>
                ))}
              </div>
            </div>
          ))
        ) : null}
        {query.trim() && !flatResults.length ? (
          <p className="command-empty">没有匹配结果</p>
        ) : null}
      </section>
    </div>
  );
}
