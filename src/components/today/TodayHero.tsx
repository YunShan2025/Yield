import type { CSSProperties } from "react";

export function TodayHero({
  cursor,
  today,
  isTodayView,
  isInbox,
  conflictCount,
  doneCount,
  totalCount,
}: {
  cursor: string;
  today: string;
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
        <span className="today-eyebrow">
          {isInbox
            ? "积微 · 非今日任务"
            : cursor === today
              ? "积微 · 今日行动"
              : "积微 · 当日安排"}
        </span>
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
        <div
          className="today-progress-ring"
          style={{ "--progress": progress } as CSSProperties}
          aria-label={`已完成 ${doneCount}/${totalCount}`}
        >
          <div>
            <strong>
              {doneCount}/{totalCount}
            </strong>
            <span>已完成</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
