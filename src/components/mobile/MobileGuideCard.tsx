import type { CSSProperties } from "react";

/** 移动壳二级页顶部的「数据型引导卡」，与今日页 mtoday-hero、待办页
 *  minbox-summary、记账页顶卡同属「淡蓝顶卡」族：accent-faint 底 + 衬线大读数
 *  + 一句速览，可选周条概览（七日小柱）或分段色条（分布 + legend），右下麦穗
 *  水印（mtoday-wheat，三页顶卡同图）。只在移动壳渲染；桌面保持各自的 guide-hero。 */

export type MobileGuideBar = {
  /** 柱底标签（如「一」「二」） */
  label: string;
  /** 0..1 完成比 */
  ratio: number;
  isToday?: boolean;
};

export type MobileGuideSegment = {
  label: string;
  value: number;
  /** 直接给色（token var 或 hex），不新增 tone 类 */
  color: string;
};

export function MobileGuideCard({
  value,
  unit,
  label,
  hint,
  bars,
  segments,
}: {
  value: number | string;
  unit?: string;
  label: string;
  hint?: string;
  bars?: MobileGuideBar[];
  segments?: MobileGuideSegment[];
}) {
  // 没有第二行概览（七日柱 / 分段色条）时进紧凑态：不再硬撑 100px 卡高，
  // 按内容收成一条「小而实」的摘要，杜绝大卡只装一行读数（.is-compact）。
  // 分段条的意义是分布：全 0 没有分布，整格不出（图例亦然）——与「统计格
  // 为 0 不出现」同规。
  const visibleSegments = segments?.some((segment) => segment.value > 0) ? segments : undefined;
  const compact = !bars?.length && !visibleSegments;
  return (
    <section className={`mtoday-card guide-stat${compact ? " is-compact" : ""}`} aria-label={label}>
      <div className="guide-stat-top">
        <span className="guide-stat-total">
          <b>{value}</b>
          {unit ? <span>{unit}</span> : null}
        </span>
        <span className="guide-stat-label">{label}</span>
        {hint ? <span className="guide-stat-hint">{hint}</span> : null}
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
          </div>
        </>
      ) : null}
      {/* 麦穗水印：与今日 / 待办 / 记账三张顶卡同图，淡蓝顶卡族的身份记号。 */}
      <span className="mtoday-wheat" aria-hidden="true" />
    </section>
  );
}
