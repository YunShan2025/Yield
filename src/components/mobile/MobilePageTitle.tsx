/**
 * 移动壳页头标题艺术化（今日 / 待办 / 记账 / 更多 + 各二级页共用）。
 * 把标题逐字拆成 span：进场时逐字上浮淡入（方案 I，延迟按字序递增），
 * 「墨渗蓝」渐变字身（方案 F）由 mobile.css 作用在这些 span 上——
 * 渐变挂在字级 span 而非 h2，动画位移时背景随笔画一起走，不会错位。
 * prefers-reduced-motion 下 CSS 关闭动画，仅保留渐变。
 */

/** 字级 span 序列（含 aria-hidden）：放进 h2 里替纯文本 children 用，
 *  父级 h2 需自备 aria-label（span 对读屏隐藏）。 */
export function MobileTitleChars({ text }: { text: string }) {
  return (
    <>
      {Array.from(text, (ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="mt-title-ch"
          style={{ animationDelay: `${i * 90}ms` }}
        >
          {ch}
        </span>
      ))}
    </>
  );
}

export function MobilePageTitle({ text }: { text: string }) {
  return (
    <h2 aria-label={text}>
      <MobileTitleChars text={text} />
    </h2>
  );
}
