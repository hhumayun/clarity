/**
 * Timing for the development build, written to the dev server's log, to see
 * where the note editor's time goes on the phone. Both sides use it: the app
 * ("[perf:app]") and the editor's web page ("[perf:editor]", shown as
 * "DOM LOG").
 *
 * - Each kind of work adds to a tally, logged every ten seconds while there
 *   is any: how many, the average and the longest, and their size.
 * - Anything that holds its side up for 50 ms or more (three frames, where a
 *   delay starts to show) is also logged at once, stamped.
 * - A few moments get a line of their own, stamped with the phone's clock so
 *   the app's and the editor's lines can be put side by side.
 *
 * Release builds skip all of it.
 */

const ON = typeof __DEV__ !== "undefined" && __DEV__;
const SUMMARY_MS = 10_000;
const SLOW_MS = 50;

type Tally = { count: number; totalMs: number; maxMs: number; kb: number };
const tallies = new Map<string, Tally>();
let summaryTimer: ReturnType<typeof setTimeout> | null = null;
let side = "app";

/** Which side this is, for the log: "app" (the default) or "editor". */
export function perfSide(name: string): void {
  side = name;
}

/** Milliseconds, for timing work on one side. */
export function perfNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

/** The phone's clock, the same on both sides: for timing what crosses between them. */
export function perfClock(): number {
  return Date.now();
}

/** One piece of work: how long it took, and how much it handled in KB. */
export function perfRecord(label: string, ms: number, kb = 0): void {
  if (!ON) return;
  const tally = tallies.get(label) ?? { count: 0, totalMs: 0, maxMs: 0, kb: 0 };
  tally.count += 1;
  tally.totalMs += ms;
  tally.maxMs = Math.max(tally.maxMs, ms);
  tally.kb += kb;
  tallies.set(label, tally);
  if (ms >= SLOW_MS)
    console.log(`[perf:${side}] slow: ${label} ${Math.round(ms)} ms${kb ? ` (${Math.round(kb)} KB)` : ""} @${perfClock() % 100_000}`);
  if (!summaryTimer) summaryTimer = setTimeout(logSummary, SUMMARY_MS);
}

/** Something that happened, counted (a render, props sent), with no time of its own. */
export function perfCount(label: string): void {
  perfRecord(label, 0);
}

/** Times work done right here, and what it handled. */
export function perfTime<T>(label: string, work: () => T, kbOf?: (result: T) => number): T {
  if (!ON) return work();
  const started = perfNow();
  const result = work();
  perfRecord(label, perfNow() - started, kbOf ? kbOf(result) : 0);
  return result;
}

/** A moment worth its own line, stamped with the phone's clock (milliseconds, last five digits). */
export function perfMark(message: string): void {
  if (ON) console.log(`[perf:${side}] ${message} @${perfClock() % 100_000}`);
}

/** Size of some text in KB, for the tallies. */
export function kbOf(text: string): number {
  return text.length / 1024;
}

function logSummary(): void {
  summaryTimer = null;
  const round = (ms: number) => (ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms));
  const parts = [...tallies].map(([label, tally]) => {
    const size = tally.kb ? `, ${Math.round(tally.kb / tally.count)} KB each` : "";
    if (tally.totalMs === 0) return `${label} ×${tally.count}${size}`;
    return `${label} ×${tally.count} avg ${round(tally.totalMs / tally.count)} max ${round(tally.maxMs)} ms${size}`;
  });
  tallies.clear();
  if (parts.length) console.log(`[perf:${side}] last 10 s: ${parts.join(" | ")}`);
}
