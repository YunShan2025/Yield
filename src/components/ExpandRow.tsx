import type { CSSProperties, ReactNode } from "react";
import { AppIcon } from "@/components/AppIcon";

/**
 * 可展开行：一行一条，点行展开内容，展开的内容附着在这一行下面，
 * 而不是掉到列表底部另起一块（另起一块会让人对不上是哪一行展开的）。
 */
export function ExpandRow({
  open,
  onToggle,
  dot,
  title,
  meta,
  trailing,
  accent,
  toggleTitle,
  children,
  foot,
  bodyClassName,
  className,
  rowId,
}: {
  open: boolean;
  onToggle: () => void;
  dot?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** 右对齐的计数/状态。 */
  trailing?: ReactNode;
  accent?: string;
  toggleTitle?: string;
  children?: ReactNode;
  /** 附着在行上的动作条。挂载时机由调用方决定：项目页双端都只随展开行渲染
   *  （展开＝选中，一屏一套；2026-10-29 移动壳常驻条退役，改行即卡片）。 */
  foot?: ReactNode;
  bodyClassName?: string;
  /** 行级状态类（移动壳用它承载「整组已完成」的成就标记）。 */
  className?: string;
  rowId?: string;
}) {
  return (
    <article
      className={`expand-row${open ? " is-open" : ""}${className ? ` ${className}` : ""}`}
      data-expand-row={rowId}
      style={accent ? ({ "--tag-accent": accent } as CSSProperties) : undefined}
    >
      <div className="expand-row-head">
        <button
          type="button"
          className="expand-row-toggle"
          aria-expanded={open}
          title={toggleTitle}
          onClick={onToggle}
        >
          {dot}
          <strong className="expand-row-title">{title}</strong>
          {meta ? <span className="expand-row-meta">{meta}</span> : null}
          {trailing ? <span className="expand-row-trailing">{trailing}</span> : null}
          <span className={`expand-row-caret${open ? " open" : ""}`} aria-hidden>
            <AppIcon name="chevron" size={14} />
          </span>
        </button>
      </div>
      {open ? <div className={`expand-row-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div> : null}
      {foot}
    </article>
  );
}
