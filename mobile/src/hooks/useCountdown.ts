import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export type CountdownStatus = "idle" | "running" | "paused" | "done";

type State = {
  status: CountdownStatus;
  durationMs: number;
  /** When it ends, while running. */
  endAt: number;
  /** What is left, frozen while paused. */
  remainingMs: number;
};

const IDLE: State = { status: "idle", durationMs: 0, endAt: 0, remainingMs: 0 };

/**
 * A countdown driven by an end time rather than a running tally. iOS
 * suspends JavaScript timers in the background, so a tally would lose that
 * time; an end time does not, and the display is simply recomputed on the
 * next tick or when the app comes back to the foreground.
 */
export function useCountdown(opts: { onDone: () => void; tickMs?: number }) {
  const { tickMs = 1_000 } = opts;
  const [state, setState] = useState<State>(IDLE);
  const [now, setNow] = useState(() => Date.now());
  const stateRef = useRef(state);
  stateRef.current = state;
  const onDoneRef = useRef(opts.onDone);
  onDoneRef.current = opts.onDone;

  const check = useCallback(() => {
    const current = stateRef.current;
    const t = Date.now();
    setNow(t);
    if (current.status === "running" && t >= current.endAt) {
      const done: State = { ...current, status: "done", remainingMs: 0 };
      stateRef.current = done;
      setState(done);
      onDoneRef.current();
    }
  }, []);

  useEffect(() => {
    if (state.status !== "running") return;
    const id = setInterval(check, tickMs);
    return () => clearInterval(id);
  }, [state.status, tickMs, check]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => sub.remove();
  }, [check]);

  const start = useCallback((durationMs: number) => {
    const t = Date.now();
    const next: State = { status: "running", durationMs, endAt: t + durationMs, remainingMs: durationMs };
    stateRef.current = next;
    setNow(t);
    setState(next);
  }, []);

  const pause = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== "running") return;
    const next: State = { ...current, status: "paused", remainingMs: Math.max(0, current.endAt - Date.now()) };
    stateRef.current = next;
    setState(next);
  }, []);

  const resume = useCallback(() => {
    const current = stateRef.current;
    if (current.status !== "paused") return;
    const t = Date.now();
    const next: State = { ...current, status: "running", endAt: t + current.remainingMs };
    stateRef.current = next;
    setNow(t);
    setState(next);
  }, []);

  /** Stops, and returns how much of the duration was actually used. */
  const stop = useCallback((): number => {
    const current = stateRef.current;
    const remaining =
      current.status === "running" ? Math.max(0, current.endAt - Date.now()) : current.remainingMs;
    const next: State = { ...current, status: "done", remainingMs: remaining };
    stateRef.current = next;
    setState(next);
    return Math.max(0, current.durationMs - remaining);
  }, []);

  const reset = useCallback(() => {
    stateRef.current = IDLE;
    setState(IDLE);
  }, []);

  const remainingMs =
    state.status === "running" ? Math.max(0, state.endAt - now) : state.remainingMs;
  const progress = state.durationMs > 0 ? 1 - remainingMs / state.durationMs : 0;

  return {
    status: state.status,
    durationMs: state.durationMs,
    endAt: state.status === "running" ? state.endAt : null,
    remainingMs,
    progress,
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
