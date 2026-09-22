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
