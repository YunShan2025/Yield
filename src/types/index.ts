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
export type DateScope = "day" | "week" | "month";

export type NavId =
  | "today"
  | "myday"
  | "inbox"
  | "week"
  | "board"
  | "calendar"
  | "tags"
  | "habits"
  | "reminders"
  | "review"
  | "growth"
  | "anniversaries"
  | "memos"
  | "trash"
  | "settings"
  | "projects"
  | "ledger";

export type RepeatFrequency = "daily" | "weekly" | "monthly" | "custom";

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
  repeat_rule: string | null;
  reminder_minutes: number[];
  project_id: string | null;
  blocked_by_id: string | null;
  completion_criteria: string;
  energy_level: "low" | "medium" | "high";
  flexible: number;
  schedule_locked: number;
  actual_minutes: number;
  goal_id: string | null;
  goal_contribution: number;
  /** Repeat occurrence spawned when completing another task. */
  generated_from_id: string | null;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  task_id: string;
  kind: "file" | "url" | "image";
  name: string;
  path: string;
  created_at: string;
}

export interface Habit {
  id: string;
  title: string;
  target_per_week: number;
  created_at: string;
  updated_at: string;
  goal_id: string | null;
  goal_contribution: number;
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

export type TimerKind = "interval" | "task";

export interface Timer {
  id: string;
  kind: TimerKind;
  title: string;
  interval_sec: number;
  remaining_sec: number;
  running: number;
  enabled: number;
  task_id: string | null;
  ends_at: string | null;
  last_fired_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimerDraft {
  kind: TimerKind;
  title: string;
  interval_sec: number;
  task_id?: string | null;
  /** If true, start running immediately. */
  start?: boolean;
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
  repeat_rule?: string | null;
  reminder_minutes?: number[];
  project_id?: string | null;
  relative_due_days?: number;
  subtasks?: TaskDraft[];
  blocked_by_id?: string | null;
  completion_criteria?: string;
  energy_level?: Task["energy_level"];
  flexible?: number;
  schedule_locked?: number;
  goal_id?: string | null;
  goal_contribution?: number;
  tagIds?: string[];
  generated_from_id?: string | null;
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
  repeat_rule?: string | null;
  reminder_minutes?: number[];
  project_id?: string | null;
  blocked_by_id?: string | null;
  completion_criteria?: string;
  energy_level?: Task["energy_level"];
  flexible?: number;
  schedule_locked?: number;
  actual_minutes?: number;
  goal_id?: string | null;
  goal_contribution?: number;
  sort_order?: number;
}

export interface AppSettings {
  theme: ThemeMode;
  notifyAhead: number;
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

export type GoalType =
  | "quantity"
  | "change"
  | "frequency"
  | "time"
  | "project"
  | "custom";
export type GoalStatus =
  | "active"
  | "paused"
  | "completed"
  | "abandoned"
  | "archived";

export interface Goal {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  goal_type: GoalType;
  start_date: string;
  target_date: string | null;
  start_value: number;
  target_value: number;
  current_value: number;
  unit: string;
  status: GoalStatus;
  motivation: string;
  project_id: string | null;
  weekly_target: number;
  manual_completion: number;
  created_at: string;
  updated_at: string;
}

export interface GoalEntry {
  id: string;
  goal_id: string;
  entry_date: string;
  value: number;
  source_type: "manual" | "task" | "habit" | "focus" | "milestone";
  source_id: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface GoalMilestone {
  id: string;
  goal_id: string;
  title: string;
  target_value: number;
  target_date: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Achievement {
  id: string;
  goal_id: string | null;
  title: string;
  description: string;
  achieved_at: string;
  image_path: string | null;
  source_type: "manual" | "milestone" | "goal";
  source_id: string | null;
  pinned: number;
  created_at: string;
}

export interface AppNotification {
  id: string;
  task_id: string | null;
  kind: "reminder" | "missed" | "system";
  title: string;
  body: string;
  scheduled_at: string | null;
  status: "pending" | "delivered" | "read" | "dismissed";
  snoozed_until: string | null;
  created_at: string;
}

export interface BackupPayload {
  version: 1;
  exportedAt: string;
  tasks: Task[];
  tags: Tag[];
  taskTags: { task_id: string; tag_id: string; updated_at?: string }[];
  attachments: Attachment[];
  habits: Habit[];
  habitChecks: HabitCheck[];
  memos?: Memo[];
  projects?: Project[];
  notifications?: AppNotification[];
  taskEvents?: TaskEvent[];
  goals?: Goal[];
  goalEntries?: GoalEntry[];
  goalMilestones?: GoalMilestone[];
  achievements?: Achievement[];
  timers?: Timer[];
  anniversaries?: Anniversary[];
  ledgerCategories?: Record<string, unknown>[];
  ledgerAccounts?: Record<string, unknown>[];
  ledgerTransactions?: Record<string, unknown>[];
  ledgerBudgets?: Record<string, unknown>[];
  settings: Record<string, string>;
}
