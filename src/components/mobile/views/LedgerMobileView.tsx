import { useEffect, useMemo, useState } from "react";
import {
  createLedgerTransaction,
  fetchLedgerAccounts,
  fetchLedgerCategories,
  fetchLedgerTransactions,
  formatLedgerMoney,
  parseAmountToCents,
  type LedgerAccount,
  type LedgerCategory,
  type LedgerKind,
  type LedgerTransaction,
} from "@/lib/db";
import { AppIcon, type AppIconName } from "@/components/AppIcon";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const CATEGORY_ICONS: Record<string, AppIconName> = {
  food: "food", car: "car", bag: "bag", home: "home", play: "music",
  medical: "medical", book: "book", gift: "gift", plane: "plane",
  dots: "dots", salary: "salary", star: "star", trend: "trend",
  zap: "zap", back: "back",
};

function timeLabel(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 移动端「记一笔」—— 页面内快速录入，不是弹窗。
 * 金额是页面主视觉；保存后留在本页并清空金额（连续记账）。
 * 收支总览从顶部应用栏进入。
 */
export function LedgerMobileView() {
  const [kind, setKind] = useState<LedgerKind>("expense");
  const [amount, setAmount] = useState("");
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [categoryId, setCategoryId] = useState(0);
  const [accountId, setAccountId] = useState(0);
  const [recent, setRecent] = useState<LedgerTransaction[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [cats, accts] = await Promise.all([
        fetchLedgerCategories("expense"),
        fetchLedgerAccounts(),
      ]);
      if (!alive) return;
      setCategories(cats);
      setAccounts(accts);
      if (cats.length && !cats.some((c) => c.id === categoryId))
        setCategoryId(cats[0].id);
      if (accts.length && !accts.some((a) => a.id === accountId))
        setAccountId(accts[0].id);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = () => {
    void fetchLedgerTransactions(currentMonth()).then((rows) => {
      setRecent(rows.slice(0, 8));
    });
  };

  useEffect(() => {
    reload();
    window.addEventListener("youqiu:data-changed", reload);
    return () => window.removeEventListener("youqiu:data-changed", reload);
  }, []);

  const kindCategories = useMemo(
    () => categories.filter((c) => c.kind === kind),
    [categories, kind],
  );

  const switchKind = (next: LedgerKind) => {
    setKind(next);
    void fetchLedgerCategories(next).then((cats) => {
      setCategories((prev) => {
        const others = prev.filter((c) => c.kind !== next);
        return [...cats, ...others];
      });
      if (cats.length) setCategoryId(cats[0].id);
    });
  };

  const save = async () => {
    const cents = parseAmountToCents(amount);
    if (cents === null || cents <= 0) return;
    if (!categoryId || !accountId) return;
    setSaving(true);
    try {
      await createLedgerTransaction({
        kind,
        amountCents: cents,
        categoryId,
        accountId,
        occurredOn: todayStr(),
      });
      setAmount("");
      setSavedAt(Date.now());
      reload();
    } finally {
      setSaving(false);
    }
  };

  const dateLabel = (() => {
    const d = new Date();
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  })();

  return (
    <div className="mtoday mledger">
      <header className="mtoday-top">
        <div className="mtoday-top-text">
          <h2>记一笔</h2>
          <p>{dateLabel}</p>
        </div>
      </header>

      <div className="mtoday-scroll">
        <section className="mledger-hero" aria-label="记一笔">
          <div className="mledger-amount">
            <span className="mledger-currency">¥</span>
            <input
              className="mledger-amount-input"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              aria-label="金额"
            />
          </div>
          <div className="mledger-kind">
            <button
              type="button"
              className={kind === "expense" ? "on" : ""}
              onClick={() => switchKind("expense")}
            >
              支出
            </button>
            <button
              type="button"
              className={kind === "income" ? "on" : ""}
              onClick={() => switchKind("income")}
            >
              收入
            </button>
          </div>
          <div className="mledger-chips">
            {kindCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`mledger-chip${cat.id === categoryId ? " on" : ""}`}
                style={{ "--chip-color": cat.color } as React.CSSProperties}
                onClick={() => setCategoryId(cat.id)}
              >
                <AppIcon name={CATEGORY_ICONS[cat.icon] ?? "dots"} size={16} />
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
          <div className="mledger-fields">
            <label className="mledger-field">
              <span>账户</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(Number(e.target.value))}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="mledger-field">
              <span>日期</span>
              <span>今天</span>
            </label>
          </div>
          <button
            type="button"
            className="mledger-save"
            disabled={saving || !amount}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </section>

        {recent.length ? (
          <section className="mtoday-card" aria-label="近期流水">
            <div className="mtoday-shead">
              <h3>今日流水</h3>
            </div>
            <ul className="mledger-txlist">
              {recent.map((tx) => (
                <li key={tx.id} className="mledger-tx">
                  <i
                    className="mledger-tx-dot"
                    style={{ background: tx.category_color }}
                  />
                  <span className="mledger-tx-main">
                    <b>{tx.note || tx.category_name}</b>
                    <i>{tx.category_name} · {tx.account_name}</i>
                  </span>
                  <span className={`mledger-tx-amt ${tx.type === "expense" ? "out" : "in"}`}>
                    {tx.type === "expense" ? "−" : "+"}
                    {formatLedgerMoney(tx.amount_cents)}
                  </span>
                  <span className="mledger-tx-time">{timeLabel(tx.created_at)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      {savedAt ? (
        <p key={savedAt} className="mledger-toast" aria-live="polite">已记一笔</p>
      ) : null}
    </div>
  );
}
