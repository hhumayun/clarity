import { formatClockTime, isSameDay } from "./dates";

/**
 * The Notes screen's rules: what a note is called, which day it belongs
 * under, and how a search like "receipts last week" is read. No React Native
 * imports, so the rules can be checked on their own.
 *
 * Notes sit under the day they were WRITTEN (createdAt), not last edited:
 * the journal view exists for people who find notes by remembering when
 * they wrote them.
 */

type NoteLike = { title: string; content: string; createdAt: Date };

const DAY_MS = 86_400_000;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const TITLE_MAX = 60;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Whole days from `date` back to `now`: 0 today, 1 yesterday. */
export function daysAgo(date: Date, now: Date = new Date()): number {
  return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
}

/**
 * The title to show. An untitled note is named from its first line, and the
 * preview then starts after that line so it is not said twice.
 */
export function displayTitle(note: { title: string; content: string }): {
  title: string;
  preview: string;
  derived: boolean;
} {
  const collapse = (text: string) => text.replace(/\s+/g, " ").trim();
  const title = note.title.trim();
  if (title) return { title, preview: collapse(note.content), derived: false };

  const lines = note.content.split("\n");
  const firstIndex = lines.findIndex((line) => line.trim().length > 0);
  if (firstIndex === -1) return { title: "Untitled note", preview: "", derived: true };

  let first = collapse(lines[firstIndex]);
  let rest = collapse(lines.slice(firstIndex + 1).join(" "));
  if (first.length > TITLE_MAX) {
    // Cut at a word boundary, and carry the remainder into the preview.
    const cut = first.lastIndexOf(" ", TITLE_MAX);
    const at = cut > TITLE_MAX / 2 ? cut : TITLE_MAX;
    rest = collapse(`${first.slice(at)} ${rest}`);
    first = `${first.slice(0, at).trim()}…`;
  }
  return { title: first, preview: rest, derived: true };
}

export type NoteGroup<T> = { key: string; label: string; notes: T[] };

/** Today, Yesterday, Earlier this week (2–6 days ago), then one group per month. */
export function groupNotesByDay<T extends NoteLike>(notes: T[], now: Date = new Date()): NoteGroup<T>[] {
  const sorted = [...notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const groups: NoteGroup<T>[] = [];
  const byKey = new Map<string, NoteGroup<T>>();
  for (const note of sorted) {
    const ago = daysAgo(note.createdAt, now);
    let key: string;
    let label: string;
    if (ago <= 0) {
      key = "today";
      label = "Today";
    } else if (ago === 1) {
      key = "yesterday";
      label = "Yesterday";
    } else if (ago <= 6) {
      key = "week";
      label = "Earlier this week";
    } else {
      const y = note.createdAt.getFullYear();
      const m = note.createdAt.getMonth();
      key = `${y}-${m}`;
      label = y === now.getFullYear() ? MONTHS[m] : `${MONTHS[m]} ${y}`;
    }
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, notes: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.notes.push(note);
  }
  return groups;
}

/** "7:08 pm" today or yesterday, "Mon, 7:08 pm" this week, "Sep 3" before that. */
export function noteTimeLabel(createdAt: Date, now: Date = new Date()): string {
  const ago = daysAgo(createdAt, now);
  if (ago <= 1) return formatClockTime(createdAt);
  if (ago <= 6) return `${WEEKDAYS[createdAt.getDay()].slice(0, 3)}, ${formatClockTime(createdAt)}`;
  const month = MONTHS[createdAt.getMonth()].slice(0, 3);
  return createdAt.getFullYear() === now.getFullYear()
    ? `${month} ${createdAt.getDate()}`
    : `${month} ${createdAt.getDate()}, ${createdAt.getFullYear()}`;
}

export type DateRange = { start: Date; end: Date; label: string };

// Rolling windows, not calendar weeks: whether a week starts on Sunday or
// Monday varies by place, and "last week" from a Monday should still reach
// last Thursday.
const DATE_PHRASES: Array<{ re: RegExp; range: (today: Date) => [number, number]; label: string }> = [
  { re: /\btoday\b/i, range: () => [0, 1], label: "today" },
  { re: /\byesterday\b/i, range: () => [-1, 0], label: "yesterday" },
  { re: /\bthis week\b/i, range: () => [-6, 1], label: "this week" },
  { re: /\blast week\b/i, range: () => [-13, -6], label: "last week" },
  { re: /\bthis month\b/i, range: () => [-29, 1], label: "this month" },
  { re: /\blast month\b/i, range: () => [-59, -29], label: "last month" },
];

/**
 * Split a search into words for the server and a date range for the client:
 * "receipts last week" → text "receipts", range = seven to thirteen days ago.
 * The server search is plain text, so the dates are applied here.
 */
export function parseNoteSearch(query: string, now: Date = new Date()): { text: string; range: DateRange | null } {
  let text = query;
  let range: DateRange | null = null;
  for (const phrase of DATE_PHRASES) {
    if (!phrase.re.test(text)) continue;
    text = text.replace(phrase.re, " ");
    if (!range) {
      const today = startOfDay(now);
      const [from, to] = phrase.range(today);
      range = {
        start: new Date(today.getFullYear(), today.getMonth(), today.getDate() + from),
        end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + to),
        label: phrase.label,
      };
    }
  }
  // Tidy the joins a removed phrase leaves behind ("receipts from last week").
  text = text.replace(/\b(from|in|during|on)\s*$/i, "").replace(/\s+/g, " ").trim();
  return { text, range };
}

export function inRange(date: Date, range: DateRange | null): boolean {
  if (!range) return true;
  const t = date.getTime();
  return t >= range.start.getTime() && t < range.end.getTime();
}

export type StripDay = { key: string; date: Date; letter: string; day: number };

/** The last seven days, oldest first, ending today. */
export function weekStrip(now: Date = new Date()): StripDay[] {
  const today = startOfDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      date,
      letter: WEEKDAYS[date.getDay()].charAt(0),
      day: date.getDate(),
    };
  });
}

/** A day's notes, newest first. */
export function notesOnDay<T extends NoteLike>(notes: T[], day: Date): T[] {
  return notes
    .filter((note) => isSameDay(note.createdAt, day))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** "Today", "Yesterday", or the weekday's name. */
export function dayHeading(day: Date, now: Date = new Date()): string {
  const ago = daysAgo(day, now);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  return WEEKDAYS[day.getDay()];
}
