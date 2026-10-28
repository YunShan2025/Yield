import { formatLedgerMoney, type LedgerMonthSummary } from "@/lib/db/ledger";

/* 半年走向 · 账本脉搏（桌面与移动壳共用，2026-10-27）
   绿线=收入、红线=支出的两条面积折线:走势形状取代双柱的目测比高低。
   样式与周历页的周脉搏同规格(带框面板、11px 点、整列按钮、描环),颜色各说各话。
   几何 viewBox 136 = 上留白 28 + 基线 118 + 下留白 18(与周脉搏同一组数);
   圆点用百分比 top——svg 随 CSS 的 --lt-h 纵向拉伸,移动壳压矮绘图区
   也不用改 JS,y 仍严格对齐折线。
   每月是整列 button:点了跳去看那个月(统计/明细随之换),但展示窗不跟着走——
   窗由数据侧 pickTrendWindow 挑「有账月份最多」的摆法,月份数不会因点选缩水。
   隐藏金额时读数照常打码。 */

const LT_TOP = 28;
const LT_BASE = 118;
const LT_PLOT_H = 136;

export function LedgerTrendPulse({
  trend,
  month,
  hidden,
  onPick,
}: {
  trend: LedgerMonthSummary[];
  month: string;
  hidden: boolean;
  onPick: (month: string) => void;
}) {
  const n = trend.length;
  const max = Math.max(1, ...trend.map((item) => Math.max(item.income_cents, item.expense_cents)));
  const ltX = (index: number) => ((index + 0.5) / Math.max(1, n)) * 100;
  const ltY = (cents: number) => LT_BASE - (cents / max) * (LT_BASE - LT_TOP);
  const ltDots = (cents: number) => `${((ltY(cents) / LT_PLOT_H) * 100).toFixed(2)}%`;
  const ltPoints = (pick: (item: LedgerMonthSummary) => number) =>
    trend.map((item, index) => `${ltX(index).toFixed(2)},${ltY(pick(item)).toFixed(1)}`);
  const ltArea = (pick: (item: LedgerMonthSummary) => number) =>
    `M ${ltX(0).toFixed(2)},${LT_BASE} L ${ltPoints(pick).join(" L ")} L ${ltX(n - 1).toFixed(2)},${LT_BASE} Z`;
  const incomeOf = (item: LedgerMonthSummary) => item.income_cents;
  const expenseOf = (item: LedgerMonthSummary) => item.expense_cents;

  return (
    <div className="lt-chart">
      <svg className="lt-lines" viewBox={`0 0 100 ${LT_PLOT_H}`} preserveAspectRatio="none" aria-hidden>
        <line x1="0" y1={LT_BASE} x2="100" y2={LT_BASE} className="lt-baseline" vectorEffect="non-scaling-stroke" />
        {n > 1 ? (
          <>
            <path d={ltArea(incomeOf)} className="lt-area inc" />
            <path d={ltArea(expenseOf)} className="lt-area exp" />
            <polyline points={ltPoints(incomeOf).join(" ")} className="lt-line inc" vectorEffect="non-scaling-stroke" />
            <polyline points={ltPoints(expenseOf).join(" ")} className="lt-line exp" vectorEffect="non-scaling-stroke" />
          </>
        ) : null}
      </svg>
      <div className="lt-cols">
        {trend.map((item) => {
          const sel = item.month === month;
          const label = `${Number(item.month.slice(5))}月`;
          const inc = formatLedgerMoney(item.income_cents, hidden);
          const exp = formatLedgerMoney(item.expense_cents, hidden);
          return (
            <button
              key={item.month}
              type="button"
              className={`lt-col${sel ? " is-sel" : ""}`}
              aria-pressed={sel}
              aria-label={`${label}，收入 ${inc}，支出 ${exp}，跳到该月`}
              title={`${label} · 收 ${inc} · 支 ${exp}`}
              onClick={() => onPick(item.month)}
            >
              <span className="lt-zone" aria-hidden>
                <i className={`lt-dot inc${item.income_cents ? "" : " is-zero"}`} style={{ top: ltDots(item.income_cents) }} />
                <i className={`lt-dot exp${item.income_cents ? "" : " is-zero"}`} style={{ top: ltDots(item.expense_cents) }} />
              </span>
              <span className="lt-m">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
