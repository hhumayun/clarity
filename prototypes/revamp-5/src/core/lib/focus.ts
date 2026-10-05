/**
 * Focus time, the parts that are just arithmetic and words. No React Native
 * imports, so they can be checked on their own.
 */

export const FOCUS_DURATIONS = [
  { minutes: 10, label: "Easy start" },
  { minutes: 15, label: "Steady" },
  { minutes: 25, label: "Classic" },
] as const;
export const DEFAULT_FOCUS_MINUTES = 15;
export const BREAK_MINUTES = 5;
export const KEEP_GOING_MINUTES = 10;

export type FocusOutcome = "finished" | "progress" | "stuck";

/**
 * "12 minutes left", never ticking seconds: the designer's point is that a
 * whole number of minutes feels less rushed. Rounded up, so a fresh 15-minute
 * session reads 15 and the last stretch reads 1 until it is under a minute.
 */
export function minutesLeftLabel(ms: number): { value: string; unit: string } {
  if (ms <= 0) return { value: "0", unit: "minutes left" };
  if (ms < 60_000) return { value: "<1", unit: "minute left" };
  const minutes = Math.ceil(ms / 60_000);
  return { value: String(minutes), unit: minutes === 1 ? "minute left" : "minutes left" };
}

/** The same for the break ring: "4 minutes of rest". */
export function restLeftLabel(ms: number): { value: string; unit: string } {
  if (ms <= 0) return { value: "0", unit: "minutes of rest" };
  if (ms < 60_000) return { value: "<1", unit: "minute of rest" };
  const minutes = Math.ceil(ms / 60_000);
  return { value: String(minutes), unit: minutes === 1 ? "minute of rest" : "minutes of rest" };
}

/** Whole minutes focused, for "15 minutes on …": at least 1 once anything was done. */
export function focusedMinutes(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

export function minutesPhrase(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** "15 minutes of focus today", or null when there has been none. */
export function todayFocusLabel(seconds: number): string | null {
  const minutes = focusedMinutes(seconds);
  return minutes === 0 ? null : `${minutesPhrase(minutes)} of focus today`;
}

/** "1 session · 15 min" for a task's meta line. */
export function focusMetaLabel(summary: { sessions: number; totalSeconds: number }): string | null {
  if (summary.sessions <= 0) return null;
  const minutes = focusedMinutes(summary.totalSeconds);
  return `${summary.sessions} ${summary.sessions === 1 ? "session" : "sessions"} · ${minutes} min`;
}

/** The check-in's follow-up question, which changes with the answer. */
export function checkInQuestion(outcome: FocusOutcome | null): string | null {
  if (outcome === "progress") return "Where did you leave off?";
  if (outcome === "stuck") return "Where did you get stuck?";
  return null;
}

export function checkInHeading(stoppedEarly: boolean): string {
  return stoppedEarly ? "Stopped early. That still counts." : "Time's up. Nice focus.";
}

/** The start of the device's local day, sent so "today" is the person's today. */
export function localMidnight(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * The left-off note as a first step for next time: its first line, and if it
 * says "Next: …", just the part after that, since that is the step.
 */
export function stepFromLeftOff(leftOff: string): string {
  const firstLine = leftOff.trim().split("\n")[0]?.trim() ?? "";
  const next = /\bnext\s*:\s*(.+)$/i.exec(firstLine);
  const step = (next ? next[1] : firstLine).trim().replace(/[.]+$/, "");
  return step.length > 120 ? `${step.slice(0, 117)}…` : step;
}
