import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (accepted: boolean) => void };

type ConfirmStore = {
  pending: PendingConfirm | null;
  open: (pending: PendingConfirm) => void;
  close: () => void;
};

const useConfirmStore = create<ConfirmStore>((set) => ({
  pending: null,
  open: (pending) => set({ pending }),
  close: () => set({ pending: null }),
}));

/** Promise-based in-app confirm; resolves false on dismiss. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().open({ ...options, resolve });
  });
}

export function AppConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  const close = useConfirmStore((s) => s.close);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    if (!pending) return;
    const settle = (accepted: boolean) => {
      const current = pendingRef.current;
      if (!current) return;
      close();
      current.resolve(accepted);
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
  }, [pending, close]);

  if (!pending) return null;

  return createPortal(
    <div
      className="modal-backdrop app-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          pending.resolve(false);
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
          <h3 id="app-confirm-title">{pending.title}</h3>
        </div>
        {pending.description ? (
          <p className="create-task-hint app-confirm-description">
            {pending.description}
          </p>
        ) : null}
        <div className="create-task-actions app-confirm-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              pending.resolve(false);
              close();
            }}
          >
            {pending.cancelText ?? "取消"}
          </button>
          <button
            type="button"
            className={pending.danger ? "btn-primary danger" : "btn-primary"}
            autoFocus
            onClick={() => {
              pending.resolve(true);
              close();
            }}
          >
            {pending.confirmText ?? "确认"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
