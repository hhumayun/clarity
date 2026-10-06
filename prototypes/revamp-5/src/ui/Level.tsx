import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, type SharedValue } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { duration, fadeTiming } from "../theme/motion";

const WAVE = 10;

/**
 * Focus time as a level of ink. It stands as tall as the time left and
 * drains from the top, moved on the UI thread by one long timing, so it
 * never ticks. A slow wave runs along its surface while the clock runs; it
 * stops when paused or under Reduce Motion.
 * The children are drawn inverted and stay put on the screen while the
 * level moves past them.
 */
export function Level({ level, color, running, width, height, children }: { level: SharedValue<number>; color: string; running: boolean; width: number; height: number; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const drift = useSharedValue(0);
  const dim = useSharedValue(1);
  useEffect(() => {
    if (running && !reduced) {
      drift.value = 0;
      drift.value = withRepeat(withTiming(1, { duration: duration.wave, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(drift);
    }
    dim.value = withTiming(running ? 1 : 0.55, fadeTiming(duration.enter));
  }, [running, reduced, drift, dim]);
  const surface = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - level.value) * (height + WAVE) - WAVE }], opacity: dim.value }));
  const hold = useAnimatedStyle(() => ({ transform: [{ translateY: -((1 - level.value) * (height + WAVE) - WAVE) }] }));
  const wave = useAnimatedStyle(() => ({ transform: [{ translateX: -drift.value * width }] }));
  // One wavelength per screen width, drawn twice so it can slide forever.
  const path = wavePath(width, WAVE);
  return (
    <Animated.View pointerEvents="none" style={[styles.levelClip, { height: height + WAVE }, surface]}>
      <Animated.View style={[styles.wave, { width: width * 2 }, wave]}>
        <Svg width={width * 2} height={WAVE} viewBox={`0 0 ${width * 2} ${WAVE}`}>
          <Path d={path} fill={color} />
        </Svg>
      </Animated.View>
      <View style={[styles.levelBody, { top: WAVE - 1, backgroundColor: color }]} />
      <Animated.View style={[styles.words, { height }, hold]}>{children}</Animated.View>
    </Animated.View>
  );
}

function wavePath(width: number, amp: number): string {
  const steps = 48;
  let d = `M0 ${amp}`;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width * 2;
    const y = amp / 2 + (amp / 2 - 1) * Math.sin((x / width) * Math.PI * 2);
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return `${d} L${width * 2} ${amp} Z`;
}


const styles = StyleSheet.create({
  levelClip: { position: "absolute", top: 0, left: 0, right: 0, overflow: "hidden" },
  words: { position: "absolute", top: 0, left: 0, right: 0 },
  wave: { position: "absolute", top: 0, left: 0, height: WAVE },
  levelBody: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
