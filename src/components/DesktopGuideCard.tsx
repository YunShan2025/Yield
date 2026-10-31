import type { CSSProperties, ReactNode } from "react";
import type { MobileGuideBar, MobileGuideSegment } from "@/components/mobile/MobileGuideCard";

/** 桌面档「淡蓝数据顶卡」（2026-10-31 桌面引导框升卡）：与移动壳 MobileGuideCard
 *  同 props、同 guide-stat-* DOM（一份数据双端共用，各穿各壳）。样式族段见
 *  components.css「桌面数据顶卡族」；移动壳走 mobile.css §14.1，本组件只在桌面渲染。
 *  note 为桌面可选项：卡尾一句引导说明（移动 trash-note 说明档同规，整行次级墨），
 *  没有说明不出行——与「为 0 不硬撑」同哲学。footer 为桌面专属扩展槽：
 *  收支页把预算进度行（含设置编辑器）挂这里，四张统计卡读数并入顶卡。 */
export function DesktopGuideCard({
  value,
  unit,
  label,
  hint,
  bars,
  segments,
  note,
  footer,
}: {
  value: number | string;
  unit?: string;
  label: string;
  hint?: string;
  bars?: MobileGuideBar[];
  segments?: MobileGuideSegment[];
  note?: string;
  footer?: ReactNode;
}) {
  // 与移动壳同规：分段条的意义是分布，全 0 没有分布，整格不出（图例亦然）；
  // 没有第二行概览（七日柱 / 分段色条）时进紧凑态，按内容收成一条摘要。
  const visibleSegments = segments?.some((segment) => segment.value > 0) ? segments : undefined;
  const compact = !bars?.length && !visibleSegments;
  // 有图例时 hint 下沉到图例行右端（2026-10-31 用户定：「已有打卡记录 x 个」
  // 挪到色条下方与图例同行），顶行只留 label+读数；无图例（七日柱/紧凑）留顶行。
  const hintInLegend = Boolean(visibleSegments && hint);
  return (
    <section className={`guide-stat-card${compact ? " is-compact" : ""}`} aria-label={label}>
      <div className="guide-stat-top">
        {hint && !hintInLegend ? <span className="guide-stat-hint">{hint}</span> : null}
        {/* 读数右钉做视觉锚；label 贴其前作前缀（2026-10-31 用户定：
            「本周已完成」挪到 x/x 前面——读数连读成词，速览留左）。 */}
        <span className="guide-stat-label">{label}</span>
        <span className="guide-stat-total">
          <b>{value}</b>
          {unit ? <span>{unit}</span> : null}
        </span>
      </div>
      {bars?.length ? (
        <div className="guide-stat-bars" aria-hidden="true">
          {bars.map((bar, index) => (
            <span
              key={index}
              className={`guide-stat-col${bar.isToday ? " is-today" : ""}`}
            >
              <span className="guide-stat-track">
                <i
                  style={{
                    height: `${bar.ratio > 0 ? Math.max(14, Math.round(bar.ratio * 100)) : 0}%`,
                  }}
                />
              </span>
              <em>{bar.label}</em>
            </span>
          ))}
        </div>
      ) : null}
      {visibleSegments ? (
        <>
          <div className="guide-stat-seg" aria-hidden="true">
            {visibleSegments
              .filter((segment) => segment.value > 0)
              .map((segment) => (
                <i
                  key={segment.label}
                  style={{ flexGrow: segment.value, background: segment.color } as CSSProperties}
                />
              ))}
          </div>
          <div className="guide-stat-legend">
            {visibleSegments.map((segment) => (
              <span key={segment.label}>
                <i style={{ background: segment.color } as CSSProperties} aria-hidden="true" />
                {segment.label}
                <b>{segment.value}</b>
              </span>
            ))}
            {hintInLegend ? <span className="guide-stat-hint">{hint}</span> : null}
          </div>
        </>
      ) : null}
      {note ? <p className="guide-stat-note">{note}</p> : null}
      {footer}
      {/* 麦穗水印：淡蓝顶卡族的身份记号（--wheat-mask 共用 token，随主题取色）。 */}
      <span className="guide-stat-wheat" aria-hidden="true" />
    </section>
  );
}
