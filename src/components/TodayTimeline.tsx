import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "@/store/app";
import { formatIsoTime, todayDateString } from "@/lib/dates";
import { layoutTimeline } from "@/lib/timeline";
import type { Task } from "@/types";
import { AppIcon } from "@/components/AppIcon";
import { isActiveTask } from "@/lib/tasks";

const SLOT_W = 96;
const LANE_H = 84;

type LaidOut = {
  task: Task;
  startMin: number;
  endMin: number;
  lane: number;
};

function formatRange(start?: string | null, end?: string | null) {
  if (!start && !end) return "";
  if (start && end) return `${start}–${end}`;
  return start ?? end ?? "";
}

export function TodayTimeline() {
  const tasks = useAppStore((s) => s.tasks);
  const selectTask = useAppStore((s) => s.selectTask);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const cursor = useAppStore((s) => s.calendarCursor);
  const today = todayDateString();
  // 时间轴跟随日期行(游标)呈现所看那天;「现在」分钟线只在看今天时有意义。
  const isToday = cursor === today;

  // Ticks every 30s so the now-line tracks the current minute.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [hoveredTask, setHoveredTask] = useState<{
    task: Task;
    range: string;
    x: number;
    y: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isToday) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isToday]);

  const dayTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.parent_id &&
          t.due_date === cursor &&
          // 已完成的事项保留在时间轴上并以「已完成」样式呈现,只有取消的不出现。
          (isActiveTask(t) || t.status === "completed"),
      ),
    [tasks, cursor],
  );

  const { timed, allDay, startHour, endHour } = useMemo(
    () => layoutTimeline(dayTasks),
    [dayTasks],
  );

  const items: LaidOut[] = timed.map((block) => ({
    task: block.task as Task,
    startMin: block.start,
    endMin: block.end,
    lane: block.lane,
  }));
  // 实际使用的泳道数(最高占用 +1),避免少重叠时多渲染空泳道。
  const laneCount = items.length
    ? Math.max(...items.map((i) => i.lane)) + 1
    : 1;

  const now = new Date(nowTick);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const axisStart = startHour * 60;
  const axisEnd = endHour * 60;
  const totalMin = axisEnd - axisStart;
  const hourCount = endHour - startHour;
  const axisWidth = hourCount * SLOT_W;
  const nowLeft =
    ((Math.min(axisEnd, Math.max(axisStart, nowMin)) - axisStart) /
      totalMin) *
    axisWidth;

  const minToX = (min: number) =>
    ((Math.min(axisEnd, Math.max(axisStart, min)) - axisStart) / totalMin) *
    axisWidth;

  const firstTaskId = items[0]?.task.id ?? allDay[0]?.id ?? null;
  const highlightTaskId = selectedTaskId ?? firstTaskId;

  // 仅在选中/高亮目标变化时定位一次。不能把 items 放进依赖:它每次渲染都是
  // 新数组,会让 30 秒一次的当前时间刷新等任何重渲染把用户手动滚动拽回原点。
  useEffect(() => {
    if (items.length === 0) return;
    const target =
      items.find((i) => i.task.id === highlightTaskId) ?? items[0];
    const el = scrollRef.current;
    if (!el || !target) return;

    const raf = requestAnimationFrame(() => {
      const left = minToX(target.startMin);
      const pad = 12;
      el.scrollLeft = Math.max(0, left - pad);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightTaskId]);

  const openTaskDetail = (taskId: string) => {
    setHoveredTask(null);
    selectTask(taskId);
  };

  const showTaskPreview = (
    event: { currentTarget: HTMLButtonElement },
    task: Task,
    range: string,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHoveredTask({
      task,
      range,
      x: Math.min(window.innerWidth - 304, Math.max(12, rect.left)),
      y:
        rect.bottom + 200 < window.innerHeight
          ? rect.bottom + 10
          : Math.max(12, rect.top - 198),
    });
  };

  return (
    <>
      <section className="today-timeline" aria-label={isToday ? "今日时间轴" : "当日时间轴"}>
        <div className="timeline-dock-head">
          <div className="timeline-dock-title">
            <h3>{isToday ? "今日时间轴" : "当日时间轴"}</h3>
            <span className="nav-count">{dayTasks.length}</span>
          </div>
        </div>

        <div className="timeline-dock-body">
          <div className="timeline-h-scroll" ref={scrollRef}>
            <div
              className="timeline-h-axis"
              style={{
                width: axisWidth,
                height:
                  36 +
                  (allDay.length ? 42 : 0) +
                  Math.max(1, laneCount) * LANE_H +
                  20,
              }}
            >
              <div className="timeline-h-hours">
                {Array.from({ length: hourCount }, (_, i) => i + startHour).map(
                  (h) => (
                    <div
                      key={h}
                      className="timeline-h-hour"
                      style={{ width: SLOT_W }}
                    >
                      {String(h).padStart(2, "0")}:00
                    </div>
                  ),
                )}
              </div>

              {allDay.length ? (
                <div className="timeline-h-allday" style={{ width: axisWidth }}>
                  <span className="timeline-h-allday-label">
                    全天 · {allDay.length}
                  </span>
                  {allDay.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      className={`timeline-h-allday-chip ${task.status === "completed" ? "is-done" : ""} ${highlightTaskId === task.id ? "is-focus" : ""}`}
                      onClick={() => openTaskDetail(task.id)}
                    >
                      {task.status === "completed" ? (
                        <AppIcon name="check" size={12} />
                      ) : null}
                      {task.title}
                    </button>
                  ))}
                </div>
              ) : null}

              <div
                className="timeline-h-lanes"
                style={{ height: Math.max(1, laneCount) * LANE_H }}
              >
                {Array.from({ length: hourCount + 1 }, (_, i) => (
                  <div
                    key={i}
                    className="timeline-h-gridline"
                    style={{ left: i * SLOT_W }}
                  />
                ))}

                {isToday && nowMin >= axisStart && nowMin <= axisEnd ? (
                  <div
                    className="timeline-h-now"
                    style={{ left: nowLeft }}
                  />
                ) : null}

                {items.map(({ task, startMin, endMin, lane }) => {
                  const left = minToX(startMin);
                  const width = Math.max(168, minToX(endMin) - left - 7);
                  const range = formatRange(task.due_time, task.end_time);
                  const p = task.priority ?? 3;
                  const done = task.status === "completed";
                  return (
                    <button
                      key={task.id}
                      type="button"
                      className={`timeline-h-event p${p} ${done ? "is-done" : ""} ${highlightTaskId === task.id ? "is-focus" : ""}`}
                      style={{
                        left,
                        width,
                        top: lane * LANE_H + 8,
                        height: LANE_H - 16,
                      }}
                      aria-label={`${task.title} ${range}${done ? " 已完成" : ""}`}
                      onMouseEnter={(event) =>
                        showTaskPreview(event, task, range)
                      }
                      onMouseMove={(event) =>
                        showTaskPreview(event, task, range)
                      }
                      onMouseLeave={() => setHoveredTask(null)}
                      onFocus={(event) =>
                        showTaskPreview(event, task, range)
                      }
                      onBlur={() => setHoveredTask(null)}
                      onClick={() => openTaskDetail(task.id)}
                    >
                      <span className="timeline-h-event-title">
                        {task.title}
                      </span>
                      {range ? (
                        <span className="timeline-h-event-time">
                          {range}
                        </span>
                      ) : null}
                      {done ? (
                        <span
                          className="timeline-h-event-done"
                          aria-label="已完成"
                        >
                          <AppIcon name="check" size={10} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {hoveredTask ? (
        <div
          className="timeline-task-popover"
          style={{ left: hoveredTask.x, top: hoveredTask.y }}
          role="tooltip"
        >
          <div className="timeline-task-popover-head">
            <strong>{hoveredTask.task.title}</strong>
            <span
              className={`timeline-task-priority p${hoveredTask.task.priority}`}
            >
              P{hoveredTask.task.priority}
            </span>
          </div>
          <div className="timeline-task-popover-meta">
            <span>
              <AppIcon name="timer" size={14} />
              {hoveredTask.range || "未设置时间"}
            </span>
            {hoveredTask.task.status === "completed" ? (
              <span className="done-at-chip">
                {formatIsoTime(hoveredTask.task.completed_at)
                  ? `完成于 ${formatIsoTime(hoveredTask.task.completed_at)}`
                  : "已完成"}
              </span>
            ) : (
              <span>
                {hoveredTask.task.status === "in_progress" ? "进行中" : "待处理"}
              </span>
            )}
          </div>
          {hoveredTask.task.description || hoveredTask.task.notes ? (
            <p>{hoveredTask.task.description || hoveredTask.task.notes}</p>
          ) : (
            <p className="is-muted">点击任务可查看完整详情</p>
          )}
        </div>
      ) : null}
    </>
  );
}
