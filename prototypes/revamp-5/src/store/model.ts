import type { Day } from "../lib/dates";
import type { AccentName, PaperName } from "../theme/tokens";

/**
 * The prototype's model, after Clarity's own (src/types.ts in the app), kept
 * on the phone with no backend. Areas are keyed by name; every task has one.
 */
export type Area = {
  name: string;
  /** Kept from the app's data; this design doesn't colour areas. */
  hue: number;
};

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly";

export type Task = {
  id: string;
  title: string;
  details: string;
  done: boolean;
  /** When it was ticked off, for "Done today" and the order of Done. */
  doneAt: number | null;
  area: string;
  day: Day | null;
  /** Minutes after midnight; only with a day. */
  time: number | null;
  /** Minutes before the time, or before 9:00 on the day when there's no time. */
  remind: number | null;
  repeat: Repeat | null;
  /** Linked notes, oldest link first. */
  noteIds: string[];
  /** The note it was found in, if any. */
  foundIn: string | null;
  createdAt: number;
  /** The first day it was planned for, when Catch up moved it. */
  movedFrom: Day | null;
};

export type Outcome = "finished" | "progress" | "stuck";

export type FocusHistory = {
  sessions: number;
  minutes: number;
  lastAt: number | null;
  leftOff: string | null;
  outcome: Outcome | null;
};

export type Block =
  | { kind: "p"; text: string }
  | { kind: "check"; text: string; done?: boolean }
  | { kind: "quote"; text: string };

export type Note = {
  id: string;
  title: string;
  excerpt: string;
  blocks?: Block[];
  area: string | null;
  day: Day;
  /** "7:40" */
  time: string;
  words: number;
  /** "focus" for a thought parked during focus time. */
  source?: "focus";
  /** Its words as written in the editor (Markdown), once written or edited on its page. */
  markdown?: string;
  /** The title as typed on its page; empty when the one shown comes from the first line. */
  typedTitle?: string;
};

/** A possible task found in a note, waiting for a yes or no. */
export type Suggestion = {
  key: string;
  title: string;
  area: string;
  day: Day | null;
  time: number | null;
  picked: boolean;
  /** Added from its card: the card shows a check until the list is closed. */
  added?: boolean;
};

export type FocusLength = 10 | 15 | 25;

export type Prefs = {
  /** The person's colour, picked in Settings. */
  accent: AccentName;
  /** The light page's warmth, picked in Settings. */
  paper: PaperName;
  focusLength: FocusLength;
  breakAfter: boolean;
  /** Demo only: a minute of focus passes in two seconds. */
  fastTimers: boolean;
  largeText: boolean;
};

export function emptyHistory(): FocusHistory {
  return { sessions: 0, minutes: 0, lastAt: null, leftOff: null, outcome: null };
}
