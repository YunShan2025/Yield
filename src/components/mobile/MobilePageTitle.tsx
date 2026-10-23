/**
 * 移动壳页头标题（今日 / 待办 / 记账 / 更多共用）。
 * 把标题逐字拆成 span：进场时逐字上浮淡入（方案 I，延迟按字序递增），
 * 「墨渗蓝」渐变字身（方案 F）由 mobile.css 作用在这些 span 上——
 * 渐变挂在字级 span 而非 h2，动画位移时背景随笔画一起走，不会错位。
 * prefers-reduced-motion 下 CSS 关闭动画，仅保留渐变。
 */
export function MobilePageTitle({ text }: { text: string }) {
  return (
    <h2 aria-label={text}>
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
    </h2>
  );
}
