import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { getFocusSummary, postFocusRecord, postTaskFirstSteps } from "../api/focus";
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

export function useRecordFocus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof postFocusRecord>[0]) => postFocusRecord(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: FOCUS_QUERY_KEY }),
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
