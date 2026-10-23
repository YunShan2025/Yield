import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchLedgerCategorySummary,
  fetchLedgerTransactions,
  fetchLedgerTrend,
  formatLedgerMoney,
  type LedgerCategorySummary,
  type LedgerMonthSummary,
  type LedgerTransaction,
} from "@/lib/db";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { LedgerEntrySheet } from "@/components/mobile/LedgerEntrySheet";
import { useTodayDate } from "@/lib/useTodayDate";
import { addDays } from "@/lib/dates";

const CATEGORY_ICONS: Record<string, AppIconName> = {
  food: "food", car: "car", bag: "bag", home: "home", play: "music",
  medical: "medical", book: "book", gift: "gift", plane: "plane",
  dots: "dots", salary: "salary", star: "star", trend: "trend",
  zap: "zap", back: "back",
};

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function moveMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  const d = new Date(year, value - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthDayLabel(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function timeLabel(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 大数字专用：只留数值（带千分位、两位小数），货币符号由外层衬线 ¥ 承担。 */
function moneyNum(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 久远日期在日头里补一个星期，翻看明细时更容易对上日子。 */
function weekdayLabel(date: string) {
  return WEEKDAYS[new Date(`${date}T00:00:00`).getDay()];
}

/**
 * 移动端「记账」—— 以账单统计与展示为主：月度总览、支出去向、
 * 六个月流向与按日分组的明细。新建与修改走 FAB 打开的底部弹层。
 */
export function LedgerMobileView() {
  const today = useTodayDate();
  const [month, setMonth] = useState(currentMonth);
  const [transactions, setTransactions] = useState<LedgerTransaction[]>([]);
  const [summary, setSummary] = useState<LedgerCategorySummary[]>([]);
  const [trend, setTrend] = useState<LedgerMonthSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<null | { editing: LedgerTransaction | null }>(null);
  const [compExpanded, setCompExpanded] = useState(false);

  const load = useCallback(() => {
    void Promise.all([
      fetchLedgerTransactions(month),
      fetchLedgerCategorySummary(month),
      fetchLedgerTrend(month),
    ]).then(([tx, categories, months]) => {
      setTransactions(tx);
      setSummary(categories);
      setTrend(months);
      setLoading(false);
    });
  }, [month]);

  useEffect(() => {
    setLoading(true);
    setCompExpanded(false);
    load();
    const reload = () => load();
    window.addEventListener("youqiu:data-changed", reload);
    window.addEventListener("youqiu:sync-applied", reload);
    return () => {
      window.removeEventListener("youqiu:data-changed", reload);
      window.removeEventListener("youqiu:sync-applied", reload);
    };
  }, [load]);

  const expense = transactions.reduce(
    (sum, row) => (row.type === "expense" ? sum + row.amount_cents : sum),
    0,
  );
  const income = transactions.reduce(
    (sum, row) => (row.type === "income" ? sum + row.amount_cents : sum),
    0,
  );
  const isCurrentMonth = month === currentMonth();
  const monthNum = Number(month.slice(5, 7));
  const yearNum = Number(month.slice(0, 4));
  const yesterday = addDays(today, -1);
  const dayLabel = (date: string) =>
    date === today ? "今天" : date === yesterday ? "昨天" : monthDayLabel(date);

  const grouped = useMemo(() => {
    const map = new Map<string, LedgerTransaction[]>();
    transactions.forEach((tx) => {
      const list = map.get(tx.date);
      if (list) list.push(tx);
      else map.set(tx.date, [tx]);
    });
    return [...map.entries()];
  }, [transactions]);

  const chartMax = Math.max(
    1,
    ...trend.map((item) => Math.max(item.expense_cents, item.income_cents)),
  );
  // 构成默认只列前 3 类，「展开全部 N 类」看全量（与计数、顶卡色条同口径）。
  const visibleCategories = compExpanded ? summary : summary.slice(0, 3);

  return (
    <div className="mtoday mledger">
      <header className="mtoday-top">
        <div className="mtoday-top-text">
          <h2>记账</h2>
          <p>{yearNum}年{monthNum}月账单</p>
        </div>
        <div className="mledger-month-switch" role="group" aria-label="切换月份">
          <button
            type="button"
            className="mtoday-icon-btn"
            aria-label="上个月"
            onClick={() => setMonth(moveMonth(month, -1))}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <strong>
            {yearNum === new Date().getFullYear()
              ? `${monthNum}月`
              : `${yearNum}年${monthNum}月`}
          </strong>
          <button
            type="button"
            className="mtoday-icon-btn"
            aria-label="下个月"
            disabled={isCurrentMonth}
            onClick={() => setMonth(moveMonth(month, 1))}
          >
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </header>

      <div className="mtoday-scroll">
        <section className="mtoday-hero" aria-label="月度收支总览">
          <div className="mtoday-hero-num">
            <u>¥</u>
            <b>{moneyNum(expense)}</b>
            <em>{monthNum}月支出</em>
          </div>
          <div className="mtoday-hero-side">
            {summary.length ? (
              <div className="mledger-mix" aria-hidden="true">
                {summary.map((item) => (
                  <i
                    key={item.category_id}
                    style={{ flexGrow: item.amount_cents, background: item.color }}
                  />
                ))}
              </div>
            ) : null}
            <span className="mtoday-hero-sub">
              收入 {formatLedgerMoney(income)} · 结余 {formatLedgerMoney(income - expense)}
              {" · "}{transactions.length} 笔
            </span>
          </div>
          <span className="mtoday-wheat" aria-hidden="true" />
        </section>

        <section className="mtoday-card" aria-label="支出去向">
          <div className="mtoday-shead">
            <h3>支出去向</h3>
            <span className="mledger-month-stat">{summary.length} 类</span>
          </div>
          {visibleCategories.length ? (
            visibleCategories.map((item) => {
              const pct = expense ? Math.round((item.amount_cents / expense) * 100) : 0;
              return (
                <div className="mledger-comp" key={item.category_id}>
                  <div className="mledger-comp-line">
                    <i style={{ background: item.color }} aria-hidden="true" />
                    <span>{item.name}</span>
                    <em>{pct === 0 ? "<1" : pct}%</em>
                    <b>{formatLedgerMoney(item.amount_cents)}</b>
                  </div>
                  <div className="mledger-comp-bar">
                    <i
                      style={{
                        width: `${Math.max(
                          4,
                          Math.round(
                            (item.amount_cents / summary[0].amount_cents) * 100,
                          ),
                        )}%`,
                        background: item.color,
                      }}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <p className="mtoday-empty">记下几笔支出后，这里会出现清晰的构成。</p>
          )}
          {summary.length > 3 ? (
            <button
              type="button"
              className="mledger-comp-more"
              aria-expanded={compExpanded}
              onClick={() => setCompExpanded((v) => !v)}
            >
              <span>{compExpanded ? "收起" : `展开全部 ${summary.length} 类`}</span>
              <AppIcon name="chevron" size={14} />
            </button>
          ) : null}
        </section>

        <section className="mtoday-card" aria-label="六个月流向">
          <div className="mtoday-shead">
            <h3>六个月流向</h3>
            <span className="mledger-legend">
              <i className="inc" aria-hidden="true" />收入
              <i className="exp" aria-hidden="true" />支出
            </span>
          </div>
          {trend.length ? (
            <div className="mledger-trend">
              {trend.map((item) => (
                <div
                  className={`mledger-trend-col${item.month === month ? " on" : ""}`}
                  key={item.month}
                >
                  <div className="mledger-trend-bars">
                    <i
                      className="inc"
                      style={{
                        height: `${Math.max(
                          3,
                          Math.round((item.income_cents / chartMax) * 100),
                        )}%`,
                      }}
                    />
                    <i
                      className="exp"
                      style={{
                        height: `${Math.max(
                          3,
                          Math.round((item.expense_cents / chartMax) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                  <small>{Number(item.month.slice(5))}月</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="mtoday-empty">还没有趋势数据。</p>
          )}
        </section>

        <section className="mtoday-card" aria-label="收支明细">
          <div className="mtoday-shead">
            <h3>明细</h3>
            <span className="mledger-month-stat">{transactions.length} 笔</span>
          </div>
          {loading ? (
            <p className="mtoday-empty">正在汇总账目…</p>
          ) : grouped.length ? (
            grouped.map(([date, items]) => {
              const dayExpense = items.reduce(
                (sum, tx) => (tx.type === "expense" ? sum + tx.amount_cents : sum),
                0,
              );
              const dayIncome = items.reduce(
                (sum, tx) => (tx.type === "income" ? sum + tx.amount_cents : sum),
                0,
              );
              return (
                <div className="mledger-day" key={date}>
                  <div className="mledger-day-head">
                    <span className={date === today ? "is-today" : undefined}>
                      {dayLabel(date)}
                      {date === today || date === yesterday
                        ? ""
                        : ` ${weekdayLabel(date)}`}
                    </span>
                    <b className={!dayExpense && dayIncome ? "is-in" : undefined}>
                      {dayExpense ? "−" : "+"}
                      {formatLedgerMoney(dayExpense || dayIncome)}
                    </b>
                  </div>
                  <ul className="mledger-txlist">
                    {items.map((tx) => (
                      <li key={tx.id}>
                        <button
                          type="button"
                          className="mledger-tx"
                          onClick={() => setSheet({ editing: tx })}
                        >
                          <span
                            className="mledger-tx-icon"
                            style={{
                              background: `color-mix(in srgb, ${tx.category_color} 18%, var(--surface-panel))`,
                              color: `color-mix(in srgb, ${tx.category_color} 55%, var(--text-primary))`,
                            }}
                          >
                            <AppIcon
                              name={CATEGORY_ICONS[tx.category_icon] ?? "dots"}
                              size={15}
                            />
                          </span>
                          <span className="mledger-tx-main">
                            <b>{tx.category_name}</b>
                            <i>
                              {tx.note ? `${tx.note} · ` : ""}
                              {tx.account_name} · {timeLabel(tx.created_at)}
                            </i>
                          </span>
                          <span
                            className={`mledger-tx-amt ${tx.type === "expense" ? "out" : "in"}`}
                          >
                            {tx.type === "expense" ? "−" : "+"}
                            {formatLedgerMoney(tx.amount_cents)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          ) : (
            <p className="mtoday-empty">这个月还没有记录。点右下角 ＋ 记下第一笔。</p>
          )}
        </section>
      </div>

      <button
        type="button"
        className="mtoday-fab"
        aria-label="记一笔"
        onClick={() => setSheet({ editing: null })}
      />

      {sheet ? (
        <LedgerEntrySheet
          editing={sheet.editing}
          today={today}
          onClose={() => setSheet(null)}
          onSaved={load}
        />
      ) : null}
    </div>
  );
}
