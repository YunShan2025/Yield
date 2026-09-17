// 标签统一用列表框选择：任务可多标签，下拉单选表达不了；
// 桌面与移动端都以固定高度滚动区呈现，选中行打勾。
export function TagListBox({
  tags,
  selected,
  onToggle,
  emptyHint = "暂无标签，可在「更多 → 标签」中新建",
}: {
  tags: { id: string; name: string }[];
  selected: string[];
  onToggle: (tagId: string) => void;
  emptyHint?: string;
}) {
  if (!tags.length) {
    return <span className="field-hint">{emptyHint}</span>;
  }
  return (
    <div className="tag-listbox" role="listbox" aria-multiselectable="true">
      {tags.map((tag) => {
        const on = selected.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            role="option"
            aria-selected={on}
            className={`tag-listbox-option${on ? " on" : ""}`}
            onClick={() => onToggle(tag.id)}
          >
            <span className="tag-listbox-check">{on ? "✓" : ""}</span>
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
