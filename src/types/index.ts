export type TaskStatus =
  | "draft"
  | "pending"
  | "in_progress"
  | "waiting"
  | "blocked"
  | "completed"
  | "cancelled";
export type TaskPriority = 1 | 2 | 3 | 4;
export type ThemeMode = "light" | "dawn" | "glass" | "dark" | "system";
export type ViewMode = "list" | "board" | "calendar";

export type NavId =
  | "today"
  | "myday"
  | "inbox"
  | "week"
  | "board"
  | "calendar"
  | "tags"
  | "habits"
  | "focus"
  | "goals"
  | "footprint"
  | "anniversaries"
  | "memos"
  | "trash"
  | "settings"
  | "projects"
  | "ledger";

/** 命令面板跳转到页内实体时携带的聚焦目标。 */
type FocusKind = "memo" | "goal" | "project" | "anniversary" | "ledger";

export interface FocusRequest {
  kind: FocusKind;
  id: string;
  /** 账本条目所在日期（YYYY-MM-DD），用于切到对应月份。 */
  date?: string;
}

type RepeatFrequency = "daily" | "weekly" | "monthly" | "custom";

export interface RepeatRule {
  frequency: RepeatFrequency;
  interval: number;
  /** 0=Sun .. 6=Sat for weekly */
  weekdays?: number[];
  /** day of month 1-31, or -1 for last */
  monthDay?: number;
  /** e.g. last Friday of month */
  nthWeekday?: { n: -1 | 1 | 2 | 3 | 4; weekday: number };
}

export interface Task {
  id: string;
  title: string;
  description: string;
  notes: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  due_time: string | null;
  /** Optional end time HH:mm; due_time is start */
  end_time: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
  parent_id: string | null;
  project_id: string | null;
  goal_id: string | null;
  /** 计量关联的权重：0 = 只关联、不计数；>0 = 完成时给目标加 N 个单位。 */
  goal_contribution: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Habit {
  id: string;
  title: string;
  target_per_week: number;
  /** 目标累计打卡天数；null 表示无限期。 */
  target_days: number | null;
  archived: number;
  /** 习惯回收站：非空即已删除，可在回收站恢复。 */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  goal_id: string | null;
  /** 计量关联的权重：0 = 只关联、不计数；>0 = 打卡时给目标加 N 个单位。 */
  goal_contribution: number;
  /**
   * 排期规则（JSON，沿用 RepeatRule 结构）：决定习惯出现在哪几天。
   * 空 = 浮动次数模式（每周 N 次，不指定日子，每天都出现在今日清单）。
   */
  repeat_rule: string | null;
}

export interface HabitCheck {
  id: string;
  habit_id: string;
  check_date: string;
}

export interface Memo {
  id: string;
  title: string;
  content: string;
  pinned: number;
  archived: number;
  format: "markdown" | "richtext";
  created_at: string;
  updated_at: string;
}

/** 计时记录类型：专注（番茄钟）会话。历史上的「循环提醒 interval」已下线。 */
type TimerKind = "task";

/** 专注与任务的关联方式：不关联 / 关联已有任务（完成即勾它）/ 预建新任务（完成即建并勾）。 */
export type FocusTaskMode = "none" | "existing" | "new";

/** 「新建任务」档在专注弹窗里预填的任务信息（与编辑任务同一套原子，钟点由专注区间推导）。 */
export interface FocusTaskDraft {
  description?: string;
  priority?: TaskPriority;
  projectId?: string | null;
  tagId?: string | null;
  /** 关联目标（与新建任务弹窗同原子：目标 + 计量档 + 自定义单位数）。 */
  goalId?: string | null;
  goalMeasure?: "none" | "one" | "custom";
  goalContribution?: number;
}

export interface Timer {
  id: string;
  kind: TimerKind;
  title: string;
  interval_sec: number;
  remaining_sec: number;
  running: number;
  enabled: number;
  ends_at: string | null;
  last_fired_at: string | null;
  task_mode: FocusTaskMode;
  /** existing 档指向的已有任务 id。 */
  task_ref_id: string | null;
  /** new 档预填的任务信息（FocusTaskDraft 的 JSON 串）。 */
  task_draft: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimerDraft {
  kind: TimerKind;
  title: string;
  interval_sec: number;
  /** If true, start running immediately. */
  start?: boolean;
  taskMode?: FocusTaskMode;
  taskRefId?: string | null;
  taskDraft?: FocusTaskDraft | null;
}

/** 专注完成流水（本地表 focus_logs）：点一次「完成」记一行，三档关联都记。 */
export interface FocusLog {
  id: string;
  title: string;
  /** 完成那一刻的关联档（none / existing / new）。 */
  mode: FocusTaskMode;
  /** 落账到的任务 id（existing 勾的 / new 建的；none 档为 null）。 */
  task_id: string | null;
  /** 完成时刻（ISO）。按本地日期聚合出「今日已专注 x 次」。 */
  ended_at: string;
  duration_sec: number;
  created_at: string;
}

export interface TaskDraft {
  title: string;
  description?: string;
  notes?: string;
  priority?: TaskPriority;
  due_date?: string | null;
  due_time?: string | null;
  end_time?: string | null;
  parent_id?: string | null;
  project_id?: string | null;
  relative_due_days?: number;
  subtasks?: TaskDraft[];
  goal_id?: string | null;
  goal_contribution?: number;
  tagIds?: string[];
}

export interface HabitDraft {
  title: string;
  goal_id?: string | null;
  goal_contribution?: number;
  /** 每周目标打卡次数，1–7；缺省按 3 处理。 */
  target_per_week?: number;
  target_days?: number | null;
  /** 排期规则 JSON；空 = 浮动次数模式。 */
  repeat_rule?: string | null;
}

export interface TaskUpdate {
  title?: string;
  description?: string;
  notes?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  /** 仅在任务保持 completed 状态时允许显式修改（修改完成时间）。 */
  completed_at?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  end_time?: string | null;
  parent_id?: string | null;
  project_id?: string | null;
  goal_id?: string | null;
  goal_contribution?: number;
  sort_order?: number;
}

export interface AppSettings {
  theme: ThemeMode;
  autostart: boolean;
  privacyMode: boolean;
  autoBackup: boolean;
  /** ISO timestamp of last successful auto-backup, if any */
  autoBackupLastOk: string | null;
  /** ISO timestamp of last failed auto-backup attempt, if any */
  autoBackupLastFailAt: string | null;
  /** Last auto-backup failure message */
  autoBackupLastError: string | null;
  /** Consecutive auto-backup failures */
  autoBackupFailStreak: number;
  onboardingComplete: boolean;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  due_date: string | null;
  archived: number;
  /** 项目回收站：非空即已删除，可在回收站恢复；永久删除后行消失。 */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** 项目自带的标签：选中该项目的任务默认打上此标签。 */
  tag_id: string | null;
}

export interface TaskEvent {
  id: string;
  task_id: string;
  event_type: string;
  before_json: string | null;
  after_json: string | null;
  note: string;
  created_at: string;
}

/** 纪念日：记录原日期，可按年循环倒数。 */
export interface Anniversary {
  id: string;
  title: string;
  /** YYYY-MM-DD 锚定公历日（农历条目也存对应公历） */
  event_date: string;
  /** solar=公历循环，lunar=农历同日循环 */
  calendar: "solar" | "lunar";
  /** 农历月 1–12；公历时为 null */
  lunar_month: number | null;
  /** 农历日 1–30；公历时为 null */
  lunar_day: number | null;
  /** 1=闰月 */
  lunar_leap: number;
  /** 1=每年循环，0=仅该日一次 */
  recur_yearly: number;
  note: string;
  created_at: string;
  updated_at: string;
}

/**
 * 目标的状态。三个（「放弃」已下线，历史数据经 migration v28 归为暂停）：
 * - active    进行中
 * - paused    暂停
 * - completed 已完成（终点态：达成或手动完成即定，不再自动回退）
 */
export type GoalStatus = "active" | "paused" | "completed";

/**
 * 目标。进度只有一个来源（migration v29 起）：关联任务完成与习惯打卡的
 * 计量事件累计。没有类型、没有基线、没有手动记录——current_value 恒等于
 * 记录之和，「正在推进」清单就是进度的全部输入。
 */
export interface Goal {
  id: string;
  title: string;
  color: string;
  start_date: string;
  target_date: string | null;
  target_value: number;
  current_value: number;
  unit: string;
  status: GoalStatus;
  motivation: string;
  /** 目标回收站：非空即已删除，可在回收站恢复。 */
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoalEntry {
  id: string;
  goal_id: string;
  entry_date: string;
  value: number;
  source_type: "task" | "habit";
  source_id: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  tasks: Task[];
  tags: Tag[];
  taskTags: { task_id: string; tag_id: string; updated_at?: string }[];
  habits: Habit[];
  habitChecks: HabitCheck[];
  memos?: Memo[];
  projects?: Project[];
  taskEvents?: TaskEvent[];
  goals?: Goal[];
  goalEntries?: GoalEntry[];
  timers?: Timer[];
  anniversaries?: Anniversary[];
  ledgerCategories?: Record<string, unknown>[];
  ledgerAccounts?: Record<string, unknown>[];
  ledgerTransactions?: Record<string, unknown>[];
  ledgerBudgets?: Record<string, unknown>[];
  settings: Record<string, string>;
}
