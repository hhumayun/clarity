import { useCallback, useEffect, useRef, useState } from "react";
import { postTaskParse } from "../api/tasks";
import { localIsoDay } from "../lib/dates";

export type ParsedLine = {
  text: string;
  completeBy: string | null;
  datePhrase: string | null;
};

// Wait for a pause before asking the model, and never for a fragment.
const PARSE_DEBOUNCE_MS = 600;
const PARSE_MIN_CHARS = 4;
// On submit the parse for the final text is awaited, but only this long: a
// slow model must not hold the task hostage, it just goes in without a date.
const SETTLE_TIMEOUT_MS = 4_000;

const nothing = (text: string): ParsedLine => ({ text, completeBy: null, datePhrase: null });

/**
 * Reads a due date out of the task line as it is typed. Failures are silent:
 * the line is still a perfectly good task without one.
 */
export function useTaskLineParse(text: string, opts: { enabled: boolean }) {
  const { enabled } = opts;
  const [result, setResult] = useState<{ forText: string; parsed: ParsedLine } | null>(null);
  const [pending, setPending] = useState(false);
  const resultRef = useRef(result);
  resultRef.current = result;
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const run = useCallback(async (input: string): Promise<ParsedLine | null> => {
    const trimmed = input.trim();
    if (trimmed.length < PARSE_MIN_CHARS) return null;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const seq = ++seqRef.current;
    setPending(true);
    try {
      const parsed = await postTaskParse(
        { text: trimmed, currentDate: localIsoDay(new Date()) },
        { signal: controller.signal },
      );
      if (seq !== seqRef.current) return null;
      setResult({ forText: trimmed, parsed });
      return parsed;
    } catch {
      // Superseded or failed: either way, no date to show for this text.
      if (seq === seqRef.current) setResult({ forText: trimmed, parsed: nothing(trimmed) });
      return null;
    } finally {
      if (seq === seqRef.current) setPending(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const trimmed = text.trim();
    if (trimmed.length < PARSE_MIN_CHARS) {
      controllerRef.current?.abort();
      seqRef.current += 1;
      setPending(false);
      setResult(null);
      return;
    }
    if (resultRef.current?.forText === trimmed) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void run(trimmed);
    }, PARSE_DEBOUNCE_MS);
    return clearTimer;
  }, [text, enabled, run]);

  useEffect(() => {
    if (enabled) return;
    controllerRef.current?.abort();
    seqRef.current += 1;
    clearTimer();
    setPending(false);
    setResult(null);
  }, [enabled]);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
      seqRef.current += 1;
      clearTimer();
    },
    [],
  );

  /** The parse for exactly this text, for submit. Bounded by a timeout. */
  const settle = useCallback(
    async (input: string): Promise<ParsedLine> => {
      const trimmed = input.trim();
      const current = resultRef.current;
      if (current && current.forText === trimmed) return current.parsed;
      clearTimer();
      const parsed = await Promise.race([
        run(trimmed),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), SETTLE_TIMEOUT_MS)),
      ]);
      return parsed ?? nothing(trimmed);
    },
    [run],
  );

  const parsed = result && result.forText === text.trim() ? result.parsed : null;
  return { parsed, pending, settle };
}
