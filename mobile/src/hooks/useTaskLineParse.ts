import { useCallback, useMemo } from "react";
import { readDueDate, type DueDateReading } from "../lib/dueDate";

export type ParsedLine = DueDateReading;

// Too short to be worth reading yet.
const PARSE_MIN_CHARS = 4;

/** Today at noon, so a date read against it never slips a day. */
function todayAtNoon(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
}

function read(input: string): ParsedLine {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (trimmed.length < PARSE_MIN_CHARS) return { text: trimmed, completeBy: null, datePhrase: null };
  return readDueDate(trimmed, todayAtNoon());
}

/**
 * Reads a due date out of the task line as it is typed, on the phone with
 * chrono-node: no wait and no network, so the date chip keeps up with every
 * keystroke.
 */
export function useTaskLineParse(text: string, opts: { enabled: boolean }) {
  const { enabled } = opts;
  const parsed = useMemo(() => (enabled ? read(text) : null), [text, enabled]);
  const settle = useCallback(async (input: string): Promise<ParsedLine> => read(input), []);
  return { parsed, settle };
}
