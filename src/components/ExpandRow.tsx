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
  tag,
  meta,
  trailing,
  actions,
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
  /** 紧跟标题的小胶囊（如项目所属标签：标签色底 + 标签名）。 */
  tag?: ReactNode;
  meta?: ReactNode;
  /** 右对齐的计数/状态。 */
  trailing?: ReactNode;
  /** 行内右对齐的操作（编辑 / 删除…）。 */
  actions?: ReactNode;
  accent?: string;
  toggleTitle?: string;
  children?: ReactNode;
  /** 附着在行上、不随展开收起的动作条（编辑/归档/删除属于项目本身，不是任务的）。 */
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
          {tag}
          {meta ? <span className="expand-row-meta">{meta}</span> : null}
          {trailing ? <span className="expand-row-trailing">{trailing}</span> : null}
          <span className={`expand-row-caret${open ? " open" : ""}`} aria-hidden>
            <AppIcon name="chevron" size={14} />
          </span>
        </button>
        {actions ? <div className="expand-row-actions">{actions}</div> : null}
      </div>
      {open ? <div className={`expand-row-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div> : null}
      {foot}
    </article>
  );
}
