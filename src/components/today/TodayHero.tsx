import type { CSSProperties } from "react";

export function TodayHero({
  isTodayView,
  isInbox,
  conflictCount,
  doneCount,
  totalCount,
}: {
  isTodayView: boolean;
  isInbox: boolean;
  conflictCount: number;
  doneCount: number;
  totalCount: number;
}) {
  const progress = totalCount
    ? Math.round((doneCount / totalCount) * 100)
    : 0;
  return (
    <section className={`today-hero ${isTodayView ? "is-deadline" : "is-plan"}${isInbox ? " is-inbox" : ""}`}>
      <div className="today-hero-copy">
        {/* 引导框只留一句功能性说明；格言在页头副标题层。 */}
        <p className="today-hero-note">
          {isInbox
            ? "截止日期不在今天的任务集中在这里，慢慢完成。"
            : "今天要做的事集中在这里，逐项完成。"}
        </p>
        {conflictCount ? (
          <span className="plan-warning">
            {conflictCount} 项任务存在时间冲突
          </span>
        ) : null}
      </div>
      <div className="today-hero-meter">
        {isInbox ? (
          <>
            <span className="today-hero-meter-count">
              <strong>{totalCount}</strong>
              <span>件</span>
            </span>
            <span className="today-hero-meter-label">待处理</span>
          </>
        ) : (
          <>
            <span className="today-hero-meter-count">
              <strong>{doneCount}</strong>
              <span>/{totalCount}</span>
            </span>
            <span className="today-hero-meter-label">已完成</span>
          </>
        )}
      </div>
      {/* 完成度大条（2026-10-31 用户定）：从 meter 右侧小档升为通栏一档，
          与其余顶卡 guide-stat-seg 同形制（8px 通栏胶囊）；待处理档无进度不出条。 */}
      {isInbox ? null : (
        <span className="today-hero-meter-track">
          <i style={{ "--progress": `${progress}%` } as CSSProperties} />
        </span>
      )}
    </section>
  );
}
