type ParsedTask = {
  text: string;
  projectName: string;
  completeBy: string | null;
};

/** A model-supplied YYYY-MM-DD, or null if it is malformed or not a real day. */
export function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * "2026-09-23 (Wednesday)" — the writer's current date as a model prompt
 * line. The weekday is spelled out so the model never has to work it out
 * before resolving "Friday" or "next Tuesday".
 */
export function describeDay(isoDay: string): string {
  if (!validDate(isoDay)) return isoDay;
  const weekday = WEEKDAYS[new Date(`${isoDay}T12:00:00.000Z`).getUTCDay()];
  return `${isoDay} (${weekday})`;
}

/**
 * A YYYY-MM-DD due day as a Date at noon UTC. The UTC calendar day is the
 * due day, and noon keeps it on that day in most timezones even for a
 * reader that takes it as-is; clients re-pin it to their own local noon.
 */
export function dueDayAsDate(isoDay: string): Date {
  return new Date(`${isoDay}T12:00:00.000Z`);
}

/** Validate and normalize the model's JSON before any database write. */
export function parseExtractedTasks(value: Record<string, unknown>): ParsedTask[] {
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : [];
  const seen = new Set<string>();
  const tasks: ParsedTask[] = [];
  for (const raw of rawTasks) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.text !== "string") continue;
    const text = item.text.trim().replace(/\s+/g, " ").slice(0, 500);
    if (!text) continue;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const proposedProject =
      typeof item.projectName === "string" ? item.projectName : "General";
    const projectName =
      proposedProject.trim().replace(/\s+/g, " ").slice(0, 120) || "General";
    tasks.push({ text, projectName, completeBy: validDate(item.completeBy) });
    if (tasks.length >= 30) break;
  }
  return tasks;
}
