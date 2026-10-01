import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { randomUUID } from "expo-crypto";
import { getFocusSummary, postFocusRecord, postTaskFirstSteps } from "../api/focus";
import { outbox } from "../sync/store";
import { DEFAULT_FOCUS_MINUTES, localMidnight } from "../lib/focus";
import { localIsoDay } from "../lib/dates";

export const FOCUS_QUERY_KEY = ["focus"] as const;

/** Focus so far today, and each task's sessions and latest "where you left off". */
export function useFocusSummary(enabled = true) {
  const day = localIsoDay(new Date());
  return useQuery({
    // Keyed on the local day, so crossing midnight starts a fresh "today".
    queryKey: [...FOCUS_QUERY_KEY, "summary", day],
    queryFn: () => getFocusSummary({ since: localMidnight() }),
    enabled,
    placeholderData: (previous) => previous,
  });
}

type FocusSummary = Awaited<ReturnType<typeof getFocusSummary>>;

/**
 * A finished session, kept here and queued, so it counts at once and is
 * recorded on the server whenever there is a connection (with the time it
 * really ended).
 */
export function useRecordFocus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: Omit<Parameters<typeof postFocusRecord>[0], "id" | "endedAt">) => {
      const endedAt = new Date();
      const id = randomUUID();
      outbox.enqueue({
        kind: "focus.record",
        body: { ...body, id, endedAt, firstStep: body.firstStep ?? "", leftOff: body.leftOff ?? "" },
      });
      // Today's minutes and the task's sessions and "where you left off".
      queryClient.setQueryData<FocusSummary>([...FOCUS_QUERY_KEY, "summary", localIsoDay(endedAt)], (old) => {
        if (!old) return old;
        const previous = old.tasks.find((item) => item.taskId === body.taskId);
        const entry = {
          taskId: body.taskId,
          sessions: (previous?.sessions ?? 0) + 1,
          totalSeconds: (previous?.totalSeconds ?? 0) + body.focusedSeconds,
          lastLeftOff: (body.leftOff ?? "").trim(),
          lastOutcome: body.outcome,
          lastPlannedMinutes: body.plannedMinutes,
          lastEndedAt: endedAt,
        };
        return {
          todaySeconds: old.todaySeconds + body.focusedSeconds,
          tasks: [entry, ...old.tasks.filter((item) => item.taskId !== body.taskId)],
        };
      });
      return { recorded: true as const, id };
    },
  });
}

/** First small step suggestions. One fetch per task; a failure just means none. */
export function useFirstSteps(taskId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: [...FOCUS_QUERY_KEY, "first-steps", taskId],
    queryFn: () => postTaskFirstSteps({ taskId: taskId as string }),
    enabled: enabled && Boolean(taskId),
    staleTime: Infinity,
    retry: false,
  });
}

const PREFS_KEY = "clarity:focus-prefs";
type FocusPrefs = { minutes: number; breakAfter: boolean };
const DEFAULT_PREFS: FocusPrefs = { minutes: DEFAULT_FOCUS_MINUTES, breakAfter: true };

/** The last length and break choice, remembered on the device. */
export function useFocusPrefs() {
  const [prefs, setPrefs] = useState<FocusPrefs>(DEFAULT_PREFS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(PREFS_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as Partial<FocusPrefs>;
        setPrefs({
          minutes: typeof parsed.minutes === "number" ? parsed.minutes : DEFAULT_PREFS.minutes,
          breakAfter: typeof parsed.breakAfter === "boolean" ? parsed.breakAfter : DEFAULT_PREFS.breakAfter,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const save = useCallback((next: FocusPrefs) => {
    setPrefs(next);
    void AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);
  return { prefs, ready, save };
}
