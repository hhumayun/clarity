import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { calm, duration, easeOut, fadeTiming, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const CHECK = "M8.2 14.4l3.6 3.6 7.6-8";
const CHECK_LENGTH = 17;

/**
 * The check that stands for "done", after Rosebud's: open, it is a ring
 * with a faint check inside, so it reads as "tap to finish"; ticked, the
 * accent fills it from the middle, a white check draws itself, the circle
 * pops and a soft halo leaves it. Clearing it eases back. It animates only
 * on a change, never on first sight. `pressed` shows the finger is on it.
 */
export function CircleCheck({ on, pressed = false, size = 28 }: { on: boolean; pressed?: boolean; size?: number }) {
  // Still until a finger is on it or it changes: a list draws dozens of these,
  // and the moving one is several layers and two drawings each. It takes over
  // in the same frame, starting from what the still one showed.
  const shown = useRef(on);
  const [live, setLive] = useState(false);
  const goLive = live || pressed || on !== shown.current;
  useEffect(() => {
    if (goLive && !live) setLive(true);
  }, [goLive, live]);
  if (!goLive) return <StillCheck on={on} size={size} />;
  return <MovingCheck on={on} pressed={pressed} size={size} from={shown.current} />;
}

/** The check at rest: a ring with a faint check, or the accent with a white one. */
function StillCheck({ on, size }: { on: boolean; size: number }) {
  const { colors, accent } = useTheme();
  const r = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: r }, on ? { backgroundColor: accent.solid } : { borderWidth: 1.75, borderColor: colors.ink2 }]} />
      <Svg width={size} height={size} viewBox="0 0 28 28" style={StyleSheet.absoluteFill}>
        {on ? (
          <Path d={CHECK} stroke={accent.on} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ) : (
          <Path d={CHECK} stroke={colors.ink3} strokeOpacity={0.55} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        )}
      </Svg>
    </View>
  );
}

function MovingCheck({ on, pressed, size, from }: { on: boolean; pressed: boolean; size: number; from: boolean }) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const fill = useSharedValue(from ? 1 : 0);
  const pop = useSharedValue(1);
  const halo = useSharedValue(0);
  const down = useSharedValue(0);
  const before = useRef(from);

  useEffect(() => {
    down.value = withTiming(pressed ? 1 : 0, fadeTiming(pressed ? duration.press : duration.base));
  }, [pressed, down]);

  useEffect(() => {
    if (before.current === on) return;
    before.current = on;
    fill.value = withTiming(on ? 1 : 0, fadeTiming(on ? duration.base : duration.quick));
    if (on && !reduced) {
      pop.value = withSequence(withTiming(0.82, { duration: duration.press, easing: easeOut }), withSpring(1, spring.pop));
      halo.value = 0;
      halo.value = withDelay(60, withTiming(1, { duration: duration.halo, easing: easeOut }));
    } else {
      pop.value = withSpring(1, reduced ? calm : spring.settle);
    }
  }, [on, fill, pop, halo, reduced]);

  const box = useAnimatedStyle(() => ({ transform: [{ scale: pop.value * (1 - 0.1 * down.value) }] }));
  const disc = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.3 + 0.7 * fill.value }] }));
  const well = useAnimatedStyle(() => ({ opacity: down.value * (1 - fill.value) }));
  const ring = useAnimatedStyle(() => ({ opacity: (1 - halo.value) * (halo.value > 0 ? 0.55 : 0), transform: [{ scale: 1 + halo.value * 0.75 }] }));
  const hint = useAnimatedStyle(() => ({ opacity: 1 - fill.value }));
  const stroke = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - fill.value) }));
  const r = size / 2;

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: 2, borderColor: accent.solid }, ring]} />
      <Animated.View style={[styles.box, { width: size, height: size, borderRadius: r }, box]}>
        <View style={[StyleSheet.absoluteFill, { borderRadius: r, borderWidth: 1.75, borderColor: colors.ink2 }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: accent.soft }, well]} />
        <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: r, backgroundColor: accent.solid }, disc]} />
        <Animated.View style={[StyleSheet.absoluteFill, hint]}>
          <Svg width={size} height={size} viewBox="0 0 28 28">
            <Path d={CHECK} stroke={colors.ink3} strokeOpacity={0.55} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Animated.View>
        <Svg width={size} height={size} viewBox="0 0 28 28" style={StyleSheet.absoluteFill}>
          <AnimatedPath d={CHECK} stroke={accent.on} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={CHECK_LENGTH} animatedProps={stroke} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden" },
});
