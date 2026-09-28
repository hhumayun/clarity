import { dayAtNoon, readDueDate, type DueDateReading } from "./dueDate";

export type ParsedTaskLine = DueDateReading;

/**
 * Read a due date out of one typed task line, against the writer's own day
 * so "tomorrow" is their tomorrow. The phone now does this itself; this stays
 * for any client still asking the server.
 */
export async function parseTaskLine(input: {
  text: string;
  /** The writer's local date as YYYY-MM-DD. */
  currentDate: string;
}): Promise<ParsedTaskLine> {
  return readDueDate(input.text.slice(0, 500), dayAtNoon(input.currentDate));
}
