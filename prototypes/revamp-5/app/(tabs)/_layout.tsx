import { Tabs, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Easing, type Animated } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useDayRollover } from "../../src/data/dayRollover";
import { useTheme } from "../../src/theme/ThemeProvider";
import { TabBar } from "../../src/ui/TabBar";

/**
 * Moving between places: a short fade-through on the page only (the bar just
 * changes which place is chosen). The old page is gone in the first third,
 * the new one fades in over the rest, from very nearly its full size, as
 * iOS's own tab bar has done since iOS 18. Nothing slides; with Reduce Motion
 * the switch is instant. The tab bar's own JS animation (React Native's
 * Animated, on the native driver) runs it.
 */
const fadeThrough = {
  animation: "fade" as const, // anything but "none", or the timing below is ignored
  transitionSpec: { animation: "timing" as const, config: { duration: 200, easing: Easing.out(Easing.quad) } },
  sceneStyleInterpolator: ({ current }: { current: { progress: Animated.AnimatedInterpolation<number> } }) => ({
    sceneStyle: {
      opacity: current.progress.interpolate({ inputRange: [-1, -0.35, 0, 0.35, 1], outputRange: [0, 0, 1, 0, 0] }),
      transform: [{ scale: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.985, 1, 0.985] }) }],
    },
  }),
};

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
  const reduced = useReducedMotion();
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
        ...(reduced ? { animation: "none" as const } : fadeThrough),
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
