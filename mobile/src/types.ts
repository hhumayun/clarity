export interface User {
  id: number;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: "admin" | "user";
}

export type TaskStatus = "done" | "in_progress" | "todo";
export type SuggestionSource = "ai" | "history" | "offline" | "prompt";
export type SuggestionAction = "accepted" | "dismissed" | "edited" | "shown";
export type EntityType = "activity" | "event" | "person" | "place" | "topic";

export type NoteRecord = {
  id: string;
  title: string;
  content: string;
  archived: boolean;
  /** null for a note written in the editor; "focus" for a thought parked during focus time. */
  source: "focus" | null;
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
  status: TaskStatus;
  projectId: string;
  projectName: string;
  noteId: string | null;
  completeBy: Date | null;
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
