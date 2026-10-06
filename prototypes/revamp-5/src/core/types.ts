export interface User {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: "admin" | "user";
}

export type TaskStatus = "done" | "in_progress" | "todo";
export type ReminderRepeat = "daily" | "weekdays" | "weekly" | "monthly";
export type SuggestionSource = "ai" | "history" | "offline" | "prompt";
export type SuggestionAction = "accepted" | "dismissed" | "edited" | "shown";
export type EntityType = "activity" | "event" | "person" | "place" | "topic";

export type NoteRecord = {
  id: string;
  title: string;
  /** The words, as Markdown: what search, the AI and previews read. */
  content: string;
  /** The rich text as the editor keeps it (Tiptap JSON). Missing or null for notes without it. */
  doc?: unknown;
  archived: boolean;
  /** null for a note written in the editor; "focus" for a thought parked during focus time; "page" for a day's page (revamp 5). */
  source: "focus" | "page" | null;
  /** The projects ("areas") this note is tagged with. */
  projectIds: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TaskRecord = {
  id: string;
  text: string;
  /** Longer detail under the one line. Missing from servers older than it. */
  description?: string;
  status: TaskStatus;
  projectId: string;
  projectName: string;
  /** The note the task was found in, if any; Find tasks uses it. */
  noteId: string | null;
  /**
   * Every note the task is linked to, oldest link first. Missing from servers
   * older than links; read it through linkedNoteIds().
   */
  noteIds?: string[];
  completeBy: Date | null;
  /** When it was done; null while it isn't. Missing from servers before migration 014 (revamp 5). */
  completedAt?: Date | null;
  /** The day it was planned for before a move pushed it on. Missing before migration 014 (revamp 5). */
  movedFrom?: Date | null;
  /** Its time on its day, "HH:MM" on the phone's clock; null for any time that day. */
  dueTime?: string | null;
  /**
   * Minutes before its time (or 9:00 on its day, with no time) to remind;
   * null for no reminder.
   */
  remindBefore?: number | null;
  /** How the task comes back once ticked off; null if it does not repeat. */
  remindRepeat?: ReminderRepeat | null;
  /** The reminder is for this time only: when the repeating task comes back, it has none (revamp 5). */
  remindOnce?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export const TASK_STATUS_VALUES = ["todo", "in_progress", "done"] as const;
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const SuggestionSourceArrayValues: [SuggestionSource, ...SuggestionSource[]] = [
  "ai",
  "history",
  "offline",
  "prompt",
];
export const SuggestionActionArrayValues: [SuggestionAction, ...SuggestionAction[]] = [
  "accepted",
  "dismissed",
  "edited",
  "shown",
];

export const SUGGESTION_CATEGORIES = ["deeper", "continue", "forward"] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

export type Suggestion = {
  text: string;
  source: SuggestionSource;
  category: SuggestionCategory;
};

export type CompletionSuggestion = {
  text: string;
  source: SuggestionSource;
  kind: "completion";
};

export type BubbleSuggestion = Suggestion | CompletionSuggestion;

export function isCompletionSuggestion(
  suggestion: BubbleSuggestion,
): suggestion is CompletionSuggestion {
  return "kind" in suggestion && suggestion.kind === "completion";
}

export const SUGGESTION_CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  deeper: "GO DEEPER",
  continue: "KEEP GOING",
  forward: "FORWARD",
};

export type SuggestedTask = {
  text: string;
  projectName: string;
  completeBy: Date | null;
};

export type TaskFocusSummary = {
  taskId: string;
  sessions: number;
  totalSeconds: number;
  lastLeftOff: string;
  lastOutcome: "finished" | "progress" | "stuck";
  lastPlannedMinutes: number;
  lastEndedAt: Date;
};

/** A note linked to a task, as listed under it. */
export type LinkedNote = {
  id: string;
  title: string;
  preview: string;
  source: "focus" | "page" | null;
  createdAt: Date;
  updatedAt: Date;
};

/** How a task is going, from its notes and focus time (made by AI). */
export type TaskSummary = {
  /** null when there is nothing to go on yet: no notes, no focus time. */
  summary: string | null;
  progress: { date: string; text: string }[];
  generatedAt: Date | null;
  noteCount: number;
  sessionCount: number;
};
