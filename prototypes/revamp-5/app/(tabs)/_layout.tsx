import { Tabs, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { useDayRollover } from "../../src/data/dayRollover";
import { useTheme } from "../../src/theme/ThemeProvider";
import { TabBar } from "../../src/ui/TabBar";

/*
 * Moving between places: the navigator itself switches at once (no
 * animation), and the new page fades in over the page colour, from the tab
 * bar (TabBar's veil). Nothing slides.
 *
 * The navigator's own fade (on 2026-10-06 until the same day's evening) left
 * Life or Notes blank now and then: expo-router 57 ships its own copy of
 * React Navigation's tab view, which decides whether each page is attached
 * from the fade's animated value on the native driver, and a switch can
 * leave the chosen page detached, showing only the tab bar. React Navigation
 * fixed this in July 2026 (bottom-tabs 7.18.8); expo-router hasn't yet
 * (expo/expo#49681). With no animation the navigator never takes that path.
 * Bring the navigator's fade back only once expo-router has the fix.
 */

// Drawn ahead, once the app has a quiet moment, one at a time: a place's first
// visit is then as quick as any other.
const AHEAD = ["/notes", "/life", "/search"] as const;
type IdleWindow = { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number };
const whenIdle = (run: () => void) => {
  const idle = (globalThis as IdleWindow).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else setTimeout(run, 600);
};

/**
 * Four places and the + between them: Today and Notes, then Life and Search.
 * Places stay as they were when you leave them; none is frozen out of sight
 * (freezeOnBlur), since coming back to a frozen one redraws all of it.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const router = useRouter();
  // Today follows the clock past midnight.
  useDayRollover();

  useEffect(() => {
    let cancelled = false;
    const next = (i: number) => {
      if (cancelled || i >= AHEAD.length) return;
      whenIdle(() => {
        if (cancelled) return;
        router.prefetch(AHEAD[i]);
        next(i + 1);
      });
    };
    // After Today has settled in.
    const start = setTimeout(() => next(0), 1500);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [router]);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        animation: "none",
        sceneStyle: { backgroundColor: colors.page },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="notes" options={{ title: "Notes" }} />
      <Tabs.Screen name="life" options={{ title: "Life" }} />
      <Tabs.Screen name="search" options={{ title: "Search" }} />
    </Tabs>
  );
}
