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
    <section className={`today-hero ${isTodayView ? "is-deadline" : "is-plan"}`}>
      <div className="today-hero-copy">
        <h3>
          {isInbox
            ? "不着急的事，先收进待办箱。"
            : doneCount
              ? "做得很好，继续保持节奏。"
              : "从一件小事开始今天。"}
        </h3>
        <p className="today-hero-note">
          {isInbox
            ? "截止日期不在今天的任务集中在这里，慢慢完成。"
            : "今天要做的事集中在这里，逐项完成。"}
        </p>
        {isTodayView && conflictCount ? (
          <span className="plan-warning">
            {conflictCount} 项任务存在时间冲突
          </span>
        ) : null}
      </div>
      {!isInbox ? (
        <div className="today-hero-meter">
          <span className="today-hero-meter-count">
            <strong>{doneCount}</strong>
            <span>/{totalCount}</span>
          </span>
          <span className="today-hero-meter-label">已完成</span>
          <span className="today-hero-meter-track">
            <i style={{ "--progress": `${progress}%` } as CSSProperties} />
          </span>
        </div>
      ) : null}
    </section>
  );
}
