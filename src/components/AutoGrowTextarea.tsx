import { useEffect, useRef, type TextareaHTMLAttributes } from "react";

/**
 * 随内容逐行长高的多行输入：默认一行,写满一行自动加一行,到 CSS max-height
 * 后内部滚动。高度完全由本组件计算——对应控件在 CSS 里不要再给 min-height
 * 或 resize,否则手动拖拽会和自动长高互相抢高度。
 * scrollHeight 不含边框,补上 offsetHeight-clientHeight（上下边框之和）才刚好
 * 不滚；弹窗随窗口缩放时换行点会变,重算一次。
 */
export function AutoGrowTextarea({
  value,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grow = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    grow();
    window.addEventListener("resize", grow);
    return () => window.removeEventListener("resize", grow);
  }, [value]);

  return <textarea ref={ref} rows={1} value={value} {...rest} />;
}
