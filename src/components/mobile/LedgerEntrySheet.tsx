import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createLedgerTransaction,
  fetchLedgerAccounts,
  fetchLedgerCategories,
  parseAmountToCents,
  softDeleteLedgerTransaction,
  updateLedgerTransaction,
  type LedgerAccount,
  type LedgerCategory,
  type LedgerKind,
  type LedgerTransaction,
} from "@/lib/db";
import { AppIcon, type AppIconName } from "@/components/AppIcon";
import { confirmAction } from "@/components/AppConfirm";
import { attachSwipeRightToClose, pushBackHandler } from "@/lib/mobileBack";
import { useAppStore } from "@/store/app";

const CATEGORY_ICONS: Record<string, AppIconName> = {
  food: "food", car: "car", bag: "bag", home: "home", play: "music",
  medical: "medical", book: "book", gift: "gift", plane: "plane",
  dots: "dots", salary: "salary", star: "star", trend: "trend",
  zap: "zap", back: "back",
};

const SHEET_TITLE_ID = "ledger-entry-sheet-title";

/**
 * 移动端「记一笔」底部弹层：记账页的 FAB（新建）与明细行（编辑）打开。
 * 结构与任务详情面板同族：白色面板 + 灰标签/值行（.field-label + 发丝分隔线），
 * 底部动作栏放保存/删除；金额输入保留页面的衬线大字语言。
 */
export function LedgerEntrySheet({
  editing,
  today,
  onClose,
  onSaved,
}: {
  editing: LedgerTransaction | null;
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const setToast = useAppStore((state) => state.setToast);
  const [kind, setKind] = useState<LedgerKind>(editing?.type ?? "expense");
  const [amount, setAmount] = useState(
    editing ? (editing.amount_cents / 100).toFixed(2) : "",
  );
  const [categories, setCategories] = useState<LedgerCategory[]>([]);
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? 0);
  const [accountId, setAccountId] = useState(editing?.account_id ?? 0);
  const [date, setDate] = useState(editing?.date ?? today);
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetchLedgerAccounts(),
      fetchLedgerCategories(editing?.type ?? "expense"),
    ]).then(([accts, cats]) => {
      if (!alive) return;
      setAccounts(accts);
      setCategories(cats);
      setAccountId((current) => current || accts.find((a) => a.is_enabled)?.id || 0);
      setCategoryId((current) => current || cats.find((c) => c.is_enabled)?.id || 0);
    });
    return () => {
      alive = false;
    };
  }, [editing]);

  useEffect(() => {
    const timer = window.setTimeout(() => amountRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.body.classList.add("action-sheet-open");
    const unregister = pushBackHandler(() => {
      onClose();
      return true;
    });
    const detach = sheetRef.current
      ? attachSwipeRightToClose(sheetRef.current, onClose)
      : undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("action-sheet-open");
      unregister();
      detach?.();
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const switchKind = (next: LedgerKind) => {
    if (next === kind) return;
    setKind(next);
    setError("");
    void fetchLedgerCategories(next).then((cats) => {
      setCategories((prev) => [...cats, ...prev.filter((c) => c.kind !== next)]);
      setCategoryId(cats.find((c) => c.is_enabled)?.id ?? 0);
    });
  };

  const save = async () => {
    const cents = parseAmountToCents(amount);
    if (cents === null) {
      setError("请输入 0.01～99,999,999.99 的有效金额，最多两位小数");
      amountRef.current?.focus();
      return;
    }
    if (!categoryId || !accountId) {
      setError("请选择分类和账户");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      kind,
      amountCents: cents,
      categoryId,
      accountId,
      occurredOn: date,
      note,
    };
    try {
      if (editing) {
        await updateLedgerTransaction(editing.id, editing.version, payload);
        setToast("记录已更新");
      } else {
        await createLedgerTransaction(payload);
        setToast("已记一笔");
      }
      onSaved();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirmAction({
      title: "移入回收站？",
      description: "可在回收站中恢复该笔记录。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    if (!(await softDeleteLedgerTransaction(editing.id, editing.version))) {
      setToast("这笔记录已在别处修改，请关闭后重试");
      return;
    }
    setToast("已移入回收站");
    onSaved();
    onClose();
  };

  const activeCategories = categories.filter((c) => c.kind === kind && c.is_enabled);

  return createPortal(
    <>
      <button
        type="button"
        className="action-sheet-backdrop"
        aria-label="关闭记账面板"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="action-sheet mledger-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={SHEET_TITLE_ID}
      >
        <span className="action-sheet-grip" aria-hidden="true" />
        <header className="action-sheet-head">
          <div className="action-sheet-heading">
            <h2 id={SHEET_TITLE_ID} className="action-sheet-title">
              {editing ? "修改这一笔" : "记一笔"}
            </h2>
          </div>
          <button
            type="button"
            className="action-sheet-close"
            aria-label="关闭"
            onClick={onClose}
          >
            <AppIcon name="close" size={16} />
          </button>
        </header>
        <div className="action-sheet-body">
          <div className="mledger-amount">
            <span className="mledger-currency">¥</span>
            <input
              ref={amountRef}
              className="mledger-amount-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              value={amount}
              aria-label="金额"
              onChange={(e) => {
                const value = e.target.value.replace(/[^\d.]/g, "");
                if (value.length <= 11) setAmount(value);
              }}
            />
          </div>
          <div className="mledger-quick">
            {[10, 20, 50, 100].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAmount(String(value))}
              >
                ¥{value}
              </button>
            ))}
          </div>
          <div className="mledger-rows">
            <div className="mledger-row">
              <span className="field-label">类型</span>
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
            </div>
            <div className="mledger-row mledger-row-block">
              <span className="field-label">{kind === "expense" ? "支出分类" : "收入分类"}</span>
              <div className="mledger-chips">
                {activeCategories.map((cat) => (
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
            </div>
            <div className="mledger-row">
              <span className="field-label">账户</span>
              <select
                className="mledger-select"
                value={accountId}
                aria-label="账户"
                onChange={(e) => setAccountId(Number(e.target.value))}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mledger-row">
              <span className="field-label">日期</span>
              <input
                type="date"
                className="mledger-date"
                value={date}
                aria-label="记账日期"
                onChange={(e) => setDate(e.target.value || today)}
              />
            </div>
            <div className="mledger-row">
              <span className="field-label">备注</span>
              <input
                className="mledger-note-input"
                maxLength={60}
                value={note}
                placeholder="这笔钱花在了哪里"
                aria-label="备注（可选）"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>
          {error ? (
            <p className="mledger-error" role="alert">{error}</p>
          ) : null}
        </div>
        <footer className="mledger-sheet-foot">
          {editing ? (
            <button
              type="button"
              className="mledger-sheet-del"
              onClick={() => void remove()}
            >
              <AppIcon name="trash" size={15} />
              <span>删除</span>
            </button>
          ) : null}
          <button
            type="button"
            className="mledger-save"
            disabled={saving || !amount}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : editing ? "保存修改" : "保存"}
          </button>
        </footer>
      </div>
    </>,
    document.body,
  );
}
