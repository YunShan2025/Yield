import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  description?: string;
  /** 输入框预填值 */
  initial?: string;
  placeholder?: string;
  maxLength?: number;
  confirmText?: string;
  cancelText?: string;
};

type PendingConfirm = ConfirmOptions & { resolve: (accepted: boolean) => void };
type PendingPrompt = PromptOptions & { resolve: (value: string | null) => void };

type DialogStore = {
  confirm: PendingConfirm | null;
  prompt: PendingPrompt | null;
  openConfirm: (pending: PendingConfirm) => void;
  openPrompt: (pending: PendingPrompt) => void;
  close: () => void;
};

const useDialogStore = create<DialogStore>((set) => ({
  confirm: null,
  prompt: null,
  openConfirm: (confirm) => set({ confirm, prompt: null }),
  openPrompt: (prompt) => set({ prompt, confirm: null }),
  close: () => set({ confirm: null, prompt: null }),
}));

/** Promise-based in-app confirm; resolves false on dismiss. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().openConfirm({ ...options, resolve });
  });
}

/** Promise-based in-app prompt（替代 window.prompt）；取消/关闭时 resolve null。 */
export function promptAction(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().openPrompt({ ...options, resolve });
  });
}

export function AppConfirmHost() {
  const confirm = useDialogStore((s) => s.confirm);
  const prompt = useDialogStore((s) => s.prompt);
  const close = useDialogStore((s) => s.close);
  const pending = confirm ?? prompt;
  const pendingRef = useRef<PendingConfirm | PendingPrompt | null>(null);
  pendingRef.current = pending;

  const [draft, setDraft] = useState("");
  useEffect(() => {
    setDraft(prompt?.initial ?? "");
  }, [prompt]);

  useEffect(() => {
    if (!pending) return;
    // 键盘监听随 draft 重绑（开销可忽略），settle 始终读当前输入。
    const openedIsPrompt = pending === prompt;
    const settle = (accepted: boolean) => {
      close();
      if (openedIsPrompt) (pending as PendingPrompt).resolve(accepted ? draft : null);
      else (pending as PendingConfirm).resolve(accepted);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      } else if (event.key === "Enter") {
        event.preventDefault();
        settle(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pending, close, confirm, prompt, draft]);

  if (!pending) return null;

  const isPrompt = pending === prompt;
  const options = pending as ConfirmOptions;
  const promptPending = pending as PendingPrompt;
  return createPortal(
    <div
      className="modal-backdrop app-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          if (isPrompt) promptPending.resolve(null);
          else (pending as PendingConfirm).resolve(false);
          close();
        }
      }}
    >
      <section
        className="create-task-modal app-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <h3 id="app-confirm-title">{options.title}</h3>
        </div>
        {options.description ? (
          <p className="create-task-hint app-confirm-description">
            {options.description}
          </p>
        ) : null}
        {isPrompt ? (
          <input
            className="field app-confirm-input"
            autoFocus
            maxLength={promptPending.maxLength ?? 32}
            placeholder={promptPending.placeholder ?? ""}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
          />
        ) : null}
        <div className="create-task-actions app-confirm-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              if (isPrompt) promptPending.resolve(null);
              else (pending as PendingConfirm).resolve(false);
              close();
            }}
          >
            {options.cancelText ?? "取消"}
          </button>
          <button
            type="button"
            className={options.danger ? "btn-primary danger" : "btn-primary"}
            autoFocus={!isPrompt}
            onClick={() => {
              if (isPrompt) promptPending.resolve(draft);
              else (pending as PendingConfirm).resolve(true);
              close();
            }}
          >
            {options.confirmText ?? "确认"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
