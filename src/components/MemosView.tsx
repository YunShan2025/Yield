import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { AppIcon } from "@/components/AppIcon";
import { confirmAction, promptAction } from "@/components/AppConfirm";
import { useAppStore } from "@/store/app";
import { createMemo, deleteMemo, fetchMemos, updateMemo } from "@/lib/db";
import { richTextToPlainText, sanitizeRichText } from "@/lib/richText";
import type { Memo } from "@/types";

function formatMemoTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function memoPreview(memo: Memo): string {
  const text = memo.format === "richtext" ? richTextToPlainText(memo.content) : memo.content.replace(/[#*_>`\[\]()-]/g, " ").replace(/\s+/g, " ").trim();
  return text.slice(0, 80) || "暂无内容";
}

export function MemosView() {
  const setToast = useAppStore((state) => state.setToast);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [keyword, setKeyword] = useState("");
  const [listMode, setListMode] = useState<"active" | "archived">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<Memo["format"]>("richtext");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showTypeChooser, setShowTypeChooser] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const markdownRef = useRef<HTMLTextAreaElement>(null);

  const applyMemo = (memo: Memo | null) => {
    setSelectedId(memo?.id ?? null);
    setTitle(memo?.title ?? "");
    setContent(memo?.content ?? "");
    setFormat(memo?.format ?? "richtext");
    setDirty(false);
    setEditing(false);
  };

  const refresh = async (preferId?: string | null, mode: "active" | "archived" = listMode) => {
    const list = await fetchMemos({ archived: "all" });
    setMemos(list);
    const visible = list.filter((memo) => mode === "archived" ? memo.archived === 1 : memo.archived !== 1);
    // 详情是抽屉:只在有明确目标(新建/保存/点击某行)时打开,默认只看到列表。
    const next = visible.find((memo) => memo.id === preferId) ?? visible.find((memo) => memo.id === selectedId) ?? null;
    applyMemo(next);
    return next;
  };

  useEffect(() => { void refresh(); }, []);

  // 同步拉回新备忘后重载页内列表（备忘为页内本地状态，不进全局 store）。
  useEffect(() => {
    const reload = () => void refresh();
    window.addEventListener("youqiu:sync-applied", reload);
    return () => window.removeEventListener("youqiu:sync-applied", reload);
  });
  useEffect(() => {
    if (editing && editorRef.current) editorRef.current.innerHTML = sanitizeRichText(content);
  }, [editing, selectedId]);
  useEffect(() => {
    const editor = editorRef.current;
    if (!editing || !editor) return;
    const pastePlainText = (event: ClipboardEvent) => {
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "");
    };
    editor.addEventListener("paste", pastePlainText);
    return () => editor.removeEventListener("paste", pastePlainText);
  }, [editing, selectedId]);

  const visibleMemos = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return memos.filter((memo) => (listMode === "archived" ? memo.archived === 1 : memo.archived !== 1)).filter((memo) => !query || memo.title.toLowerCase().includes(query) || memoPreview(memo).toLowerCase().includes(query));
  }, [memos, keyword, listMode]);
  const selected = memos.find((memo) => memo.id === selectedId) ?? null;
  const activeCount = memos.filter((memo) => memo.archived !== 1).length;
  const archivedCount = memos.length - activeCount;

  const persistCurrent = async () => {
    if (!selected) return;
    const safeContent = format === "richtext" ? sanitizeRichText(content) : content;
    const safeTitle = title.trim() || "无标题备忘";
    await updateMemo(selected.id, { title: safeTitle, content: safeContent, format });
    setTitle(safeTitle); setContent(safeContent); setDirty(false);
  };

  const selectMemo = async (memo: Memo) => {
    if (dirty) await persistCurrent();
    applyMemo(memo);
  };

  const startEditing = () => {
    setEditing(true);
  };

  const save = async () => {
    if (!selected) return;
    await persistCurrent();
    setEditing(false);
    setToast("备忘录已保存");
    await refresh(selected.id);
  };

  // 抽屉的 ✕:沿用备忘录「切换即保存」的习惯,未保存的修改先落库再收起。
  const closeDrawer = async () => {
    if (dirty) await persistCurrent();
    applyMemo(null);
  };

  // 点击抽屉以外的任意区域收起抽屉;应用级浮层(确认弹窗、新建类型菜单)不算“点了外面”。
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    closeRef.current = () => { void closeDrawer(); };
  });
  useEffect(() => {
    if (!selectedId) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".detail-panel, .modal-backdrop, .memo-create-menu, .row-menu, .row-menu-backdrop")) return;
      closeRef.current();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const createNew = async (memoFormat: Memo["format"]) => {
    if (dirty) await persistCurrent();
    const memo = await createMemo("", "无标题备忘", memoFormat);
    setShowTypeChooser(false);
    setListMode("active");
    const current = await refresh(memo.id, "active");
    if (current) { setEditing(true); setFormat(memoFormat); }
  };

  const insertMarkdown = (before: string, after = "", fallback = "文本") => {
    const textarea = markdownRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.slice(start, end) || fallback;
    const next = `${content.slice(0, start)}${before}${selectedText}${after}${content.slice(end)}`;
    setContent(next); setDirty(true);
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + before.length, start + before.length + selectedText.length); });
  };

  const runCommand = (command: string, value?: string) => {
    if (command === "createLink" && value && !/^https?:\/\//i.test(value)) {
      setToast("仅支持 http/https 链接");
      return;
    }
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setContent(editorRef.current?.innerHTML ?? "");
    setDirty(true);
  };

  const switchList = (mode: "active" | "archived") => {
    if (dirty) void persistCurrent();
    setListMode(mode); applyMemo(null); void refresh(null, mode);
  };

  const archiveSelected = async () => {
    if (!selected) return;
    if (dirty) await persistCurrent();
    const archived = selected.archived ? 0 : 1;
    await updateMemo(selected.id, { archived });
    setToast(archived ? "备忘录已归档" : "备忘录已恢复");
    applyMemo(null);
    await refresh(null, archived ? "active" : "archived");
  };

  const removeSelected = async () => {
    if (!selected) return;
    const ok = await confirmAction({
      title: `删除「${selected.title || "无标题备忘"}」？`,
      description: "此操作无法撤销。",
      confirmText: "删除",
      danger: true,
    });
    if (!ok) return;
    await deleteMemo(selected.id); applyMemo(null); await refresh(null);
    setToast("备忘录已删除");
  };

  const togglePinned = async () => {
    if (!selected) return;
    await updateMemo(selected.id, { pinned: selected.pinned ? 0 : 1 });
    await refresh(selected.id);
  };

  return <main className="main-workspace memo-page">
    {/* 与「今日」同构的标题区:h2 标题 + 副标题,右侧直达「＋ 新建」。 */}
    <div className="workspace-top">
      <div>
        <h2>备忘录</h2>
        <p className="workspace-subtitle">随手记下的想法与灵感，都收在这里。</p>
      </div>
      <div className="top-controls">
        <div className="memo-new-wrap">
          <button type="button" className="btn-primary" aria-expanded={showTypeChooser} onClick={() => setShowTypeChooser((value) => !value)}>＋ 新建</button>
          {showTypeChooser ? <div className="memo-create-menu"><button type="button" onClick={() => void createNew("richtext")}><strong>富文本</strong><span>适合日常记录和排版</span></button><button type="button" onClick={() => void createNew("markdown")}><strong>Markdown</strong><span>适合技术笔记和纯文本</span></button></div> : null}
        </div>
      </div>
    </div>

    {/* 与「今日」同款的暖色引导框。 */}
    <section className="today-hero guide-hero">
      <div className="today-hero-copy">
        <span className="today-eyebrow">百工 · 备忘录</span>
        <h3>好记性不如烂笔头。</h3>
        <p className="today-hero-note">点开任意一条即可阅读；支持富文本与 Markdown，可置顶、归档。</p>
      </div>
    </section>

    <div className="memo-body">
      <div className="memo-toolbar">
        <div className="memo-search"><AppIcon name="search" size={16} /><input placeholder="搜索备忘录" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></div>
        <div className="memo-list-tabs" aria-label="备忘录分类"><button type="button" className={listMode === "active" ? "active" : ""} onClick={() => switchList("active")}>全部 <span>{activeCount}</span></button><button type="button" className={listMode === "archived" ? "active" : ""} onClick={() => switchList("archived")}>已归档 <span>{archivedCount}</span></button></div>
      </div>
      <div className="memo-list">{visibleMemos.map((memo) => <button key={memo.id} type="button" className={`memo-list-item ${selectedId === memo.id ? "active" : ""}`} onClick={() => void selectMemo(memo)}><div className="memo-list-title"><span className="memo-list-title-copy">{memo.pinned ? <AppIcon name="pin" size={13} /> : null}{memo.title || "无标题备忘"}</span><span className={`memo-format-badge is-${memo.format}`}>{memo.format === "richtext" ? "RT" : "MD"}</span></div><div className="memo-list-preview">{memoPreview(memo)}</div><div className="memo-list-meta"><span>{formatMemoTime(memo.updated_at)}</span>{memo.archived ? <span>已归档</span> : null}</div></button>)}{!visibleMemos.length ? <div className="memo-empty-list">{keyword ? "没有找到相关备忘录" : listMode === "archived" ? "还没有归档内容" : "新建一条备忘录，记录需要长期保存的内容"}</div> : null}</div>
    </div>

    {selected ? <aside className="detail-panel memo-detail-panel">
      <div className="panel-head">
        <h3>{editing ? "编辑备忘" : "备忘详情"}</h3>
        <div className="detail-head-actions">
          <button type="button" className="btn-ghost" onClick={() => void closeDrawer()}>✕</button>
        </div>
      </div>
      <div className="memo-drawer-body">
        {editing ? <>
          <input className="memo-title-input" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }} placeholder="备忘录标题" autoFocus />
          {format === "richtext" ? <>
            <div className="memo-rich-toolbar" aria-label="富文本格式工具"><button type="button" title="正文" onClick={() => runCommand("formatBlock", "p")}>正文</button><button type="button" title="二级标题" onClick={() => runCommand("formatBlock", "h2")}>H2</button><button type="button" title="三级标题" onClick={() => runCommand("formatBlock", "h3")}>H3</button><i /><button type="button" title="粗体" onClick={() => runCommand("bold")}><b>B</b></button><button type="button" title="斜体" onClick={() => runCommand("italic")}><em>I</em></button><button type="button" title="引用" onClick={() => runCommand("formatBlock", "blockquote")}>❝</button><button type="button" title="无序列表" onClick={() => runCommand("insertUnorderedList")}>• 列表</button><button type="button" title="有序列表" onClick={() => runCommand("insertOrderedList")}>1. 列表</button><button type="button" title="添加链接" onClick={() => { void promptAction({ title: "添加链接", initial: "https://", placeholder: "链接地址", confirmText: "插入" }).then((url) => { if (url) runCommand("createLink", url); }); }}>链接</button></div>
            <div ref={editorRef} className="memo-rich-editor" contentEditable suppressContentEditableWarning data-placeholder="从这里开始记录……" onInput={(event) => { setContent(event.currentTarget.innerHTML); setDirty(true); }} onKeyDown={(event) => { if (event.key === "s" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } }} />
          </> : <>
            <div className="memo-rich-toolbar memo-markdown-toolbar" aria-label="Markdown 快捷工具"><button type="button" onClick={() => insertMarkdown("## ", "", "标题")}>H2</button><button type="button" onClick={() => insertMarkdown("### ", "", "标题")}>H3</button><i /><button type="button" onClick={() => insertMarkdown("**", "**")}><b>B</b></button><button type="button" onClick={() => insertMarkdown("*", "*")}><em>I</em></button><button type="button" onClick={() => insertMarkdown("> ", "", "引用")}>❝</button><button type="button" onClick={() => insertMarkdown("- ", "", "列表项")}>• 列表</button><button type="button" onClick={() => insertMarkdown("- [ ] ", "", "待办")}>☐ 待办</button><button type="button" onClick={() => insertMarkdown("[", "](https://)", "链接文字")}>链接</button></div>
            <textarea ref={markdownRef} className="memo-markdown-editor" value={content} onChange={(event) => { setContent(event.target.value); setDirty(true); }} onKeyDown={(event) => { if (event.key === "s" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void save(); } }} placeholder="使用 Markdown 开始记录……" />
          </>}
        </> : <>
          <header className="memo-document-head"><div><span>{formatMemoTime(selected.updated_at)} <em className={`memo-document-format is-${format}`}>{format === "richtext" ? "富文本" : "Markdown"}</em></span><h1>{selected.title || "无标题备忘"}</h1></div></header>
          <article className="memo-reading-surface">{content.trim() ? format === "richtext" ? <div dangerouslySetInnerHTML={{ __html: sanitizeRichText(content) }} /> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{content}</ReactMarkdown> : <div className="memo-reading-empty"><AppIcon name="memo" size={30} /><strong>这条备忘录还没有内容</strong><button type="button" onClick={startEditing}>开始编辑</button></div>}</article>
        </>}
      </div>
      <div className="detail-footer">
        {editing ? (
          <>
            <button type="button" className="btn-primary" onClick={() => void save()}>保存并返回</button>
            <button type="button" className="btn-ghost" onClick={() => applyMemo(selected)}>取消</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary" onClick={startEditing}>编辑</button>
            <button type="button" className="btn-ghost" onClick={() => void togglePinned()}>{selected.pinned ? "取消置顶" : "置顶"}</button>
            <button type="button" className="btn-ghost" onClick={() => void archiveSelected()}>{selected.archived ? "恢复" : "归档"}</button>
          </>
        )}
        <button type="button" className="btn-ghost danger" onClick={() => void removeSelected()}>删除备忘</button>
      </div>
    </aside> : null}
  </main>;
}
