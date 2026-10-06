import React, { useEffect, useState } from "react";
import { RefreshControl, StyleSheet, View, type RefreshControlProps } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useDataMode, useSageStatus } from "../data/sage";
import { breathe, duration } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, pad, radius, space } from "../theme/tokens";
import { Button } from "./Button";
import { Txt } from "./Txt";

/**
 * Your notes on their way: card-shaped placeholders in the place the cards
 * will take, so nothing jumps when they arrive. They breathe slowly; under
 * Reduce Motion they rest.
 */
export function SkeletonCards({ cards = 2, rows = 3, label = "Loading your notes" }: { cards?: number; rows?: number; label?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const glow = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    glow.value = withRepeat(withTiming(0.55, { duration: duration.breath, easing: breathe }), -1, true);
    return () => cancelAnimation(glow);
  }, [glow, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: glow.value }));
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.stack}>
      {Array.from({ length: cards }, (_, card) => (
        <Animated.View key={card} style={[styles.card, { backgroundColor: colors.card }, pulse]}>
          {Array.from({ length: rows }, (_, row) => (
            <View key={row} style={styles.row}>
              <View style={[styles.bar, { backgroundColor: colors.sunken, width: row === 0 ? "62%" : row % 2 ? "84%" : "48%" }]} />
              <View style={[styles.bar, styles.short, { backgroundColor: colors.sunken }]} />
            </View>
          ))}
        </Animated.View>
      ))}
    </View>
  );
}

/** The lists couldn't be fetched and nothing is kept on the phone: said in place, with a way to try again. */
export function LoadProblem() {
  const { problem, refresh } = useSageStatus();
  const [state, setState] = useState<"idle" | "busy">("idle");
  if (!problem) return null;
  return (
    <View style={[styles.card, styles.problem]} accessibilityLiveRegion="polite">
      <Txt variant="subhead" tone="ink2" center>
        {problem}
      </Txt>
      <Button
        label="Try again"
        variant="secondary"
        size="sm"
        state={state}
        onPress={() => {
          setState("busy");
          void refresh().finally(() => setState("idle"));
        }}
      />
    </View>
  );
}

/** Pull to refresh, for your account's lists only: the samples have nowhere to come from. */
export function usePullToRefresh(): React.ReactElement<RefreshControlProps> | undefined {
  const { colors } = useTheme();
  const account = useDataMode((state) => state.mode) === "account";
  const { refresh } = useSageStatus();
  const [refreshing, setRefreshing] = useState(false);
  if (!account) return undefined;
  return (
    <RefreshControl
      refreshing={refreshing}
      tintColor={colors.ink3}
      colors={[colors.ink3]}
      onRefresh={() => {
        setRefreshing(true);
        void refresh().finally(() => setTimeout(() => setRefreshing(false), duration.quick));
      }}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3], paddingHorizontal: edge },
  card: { borderRadius: radius.card, borderCurve: "continuous", padding: pad, gap: space[4] },
  row: { gap: space[2] },
  bar: { height: 12, borderRadius: 6 },
  short: { width: "30%", height: 10 },
  problem: { marginHorizontal: edge, marginTop: space[4], alignItems: "center", gap: space[3] },
});
