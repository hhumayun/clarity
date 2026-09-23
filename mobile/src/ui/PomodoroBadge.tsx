import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Ellipse, Path } from "react-native-svg";
import { EASE_IN_OUT, EASE_OUT, keyframe, LINEAR } from "../lib/keyframes";
import * as K from "../lib/pomodoroKeyframes";

/**
 * The tomato kitchen timer in the "Start focus time" button, from the
 * design's PomodoroBadge. One 7-second loop: rest, the tomato winds up like a
 * kitchen timer, the ring fills with a few soft ticks, a small hop and a halo
 * ripple, then rest. Three loops, then it settles, so it invites without
 * nagging. With Reduce Motion on it is a still timer, about three quarters
 * full.
 *
 * CSS rotates SVG groups around points; here each group is a full-size layer
 * whose transform pivots around the same point (translate to it, turn,
 * translate back), and layers nest the way the groups do:
 * bounce > twist > leaves, with the shine inside the bounce only.
 */

const COLORS = {
  badgeBg: "rgba(0, 0, 0, 0.13)",
  ring: "#fff8ee",
  track: "rgba(255, 248, 238, 0.3)",
  tomato: "#ea735b",
  tomatoShade: "#c4523d",
  leaf: "#2d6a55",
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const LEAF = "M32 22.5 C34.6 20 38.9 20.3 41.6 22.8 C38.2 24.3 34.8 24.5 32 22.5 Z";

export function PomodoroBadge({ size = 44 }: { size?: number }) {
  const reduceMotion = useReducedMotion();
  // Progress through the current loop, 0..1. Held at 1 after the last loop,
  // which is the resting frame (CSS fill-mode: both).
  const t = useSharedValue(0);
  const unit = size / 64;

  useEffect(() => {
    if (reduceMotion) {
      t.value = 1;
      return;
    }
    t.value = 0;
    t.value = withDelay(
      K.POMODORO_DELAY_MS,
      withRepeat(withTiming(1, { duration: K.POMODORO_LOOP_MS, easing: Easing.linear }), K.POMODORO_LOOPS, false),
    );
    return () => cancelAnimation(t);
  }, [reduceMotion, t]);

  const ringProps = useAnimatedProps(() => {
    if (reduceMotion) return { strokeDashoffset: K.RING_STATIC_DASHOFFSET, opacity: 1 };
    return {
      strokeDashoffset: keyframe(t.value, K.RING_STOPS, K.RING_DASHOFFSET, LINEAR),
      opacity: keyframe(t.value, K.RING_STOPS, K.RING_OPACITY, LINEAR),
    };
  });

  // Turn a layer around a point given in viewBox units.
  const pivot = (origin: { x: number; y: number }) => ({
    dx: (origin.x - 32) * unit,
    dy: (origin.y - 32) * unit,
  });
  const bounceAt = pivot(K.BOUNCE_ORIGIN);
  const twistAt = pivot(K.TWIST_ORIGIN);
  const leavesAt = pivot(K.LEAVES_ORIGIN);

  const bounceStyle = useAnimatedStyle(() => {
    const y = keyframe(t.value, K.BOUNCE_STOPS, K.BOUNCE_Y, EASE_IN_OUT) * unit;
    return {
      transform: [
        { translateX: bounceAt.dx },
        { translateY: bounceAt.dy + y },
        { scaleX: keyframe(t.value, K.BOUNCE_STOPS, K.BOUNCE_SX, EASE_IN_OUT) },
        { scaleY: keyframe(t.value, K.BOUNCE_STOPS, K.BOUNCE_SY, EASE_IN_OUT) },
        { translateX: -bounceAt.dx },
        { translateY: -bounceAt.dy },
      ],
    };
  });
  const twistStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: twistAt.dx },
      { translateY: twistAt.dy },
      { rotate: `${keyframe(t.value, K.TWIST_STOPS, K.TWIST_DEG, EASE_IN_OUT)}deg` },
      { translateX: -twistAt.dx },
      { translateY: -twistAt.dy },
    ],
  }));
  const leavesStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: leavesAt.dx },
      { translateY: leavesAt.dy },
      { rotate: `${keyframe(t.value, K.LEAVES_STOPS, K.LEAVES_DEG, EASE_IN_OUT)}deg` },
      { translateX: -leavesAt.dx },
      { translateY: -leavesAt.dy },
    ],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: keyframe(t.value, K.HALO_STOPS, K.HALO_OPACITY, EASE_OUT),
    transform: [{ scale: keyframe(t.value, K.HALO_STOPS, K.HALO_SCALE, EASE_OUT) }],
  }));

  const layer = [StyleSheet.absoluteFill, { width: size, height: size }];

  return (
    <View
      style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.halo, { borderRadius: size / 2 }, haloStyle]}
      />
      <Svg width={size} height={size} viewBox="0 0 64 64" style={StyleSheet.absoluteFill}>
        <Circle cx={32} cy={32} r={26} stroke={COLORS.track} strokeWidth={3.5} fill="none" />
        <AnimatedCircle
          cx={32}
          cy={32}
          r={26}
          stroke={COLORS.ring}
          strokeWidth={3.5}
          strokeLinecap="round"
          fill="none"
          strokeDasharray="170 400"
          transform="rotate(-90 32 32)"
          animatedProps={ringProps}
        />
      </Svg>
      <Animated.View style={[layer, bounceStyle]}>
        <Animated.View style={[layer, twistStyle]}>
          <Svg width={size} height={size} viewBox="0 0 64 64">
            <Ellipse cx={32} cy={36.5} rx={16} ry={13.5} fill={COLORS.tomatoShade} />
            <Ellipse cx={32} cy={35.5} rx={15.5} ry={13} fill={COLORS.tomato} />
            <Path d="M26.5 26 Q24 34.5 26 43" fill="none" stroke={COLORS.tomatoShade} strokeWidth={1.4} strokeLinecap="round" opacity={0.45} />
            <Path d="M37.5 26 Q40 34.5 38 43" fill="none" stroke={COLORS.tomatoShade} strokeWidth={1.4} strokeLinecap="round" opacity={0.45} />
          </Svg>
          <Animated.View style={[layer, leavesStyle]}>
            <Svg width={size} height={size} viewBox="0 0 64 64">
              <Path d={LEAF} fill={COLORS.leaf} transform="rotate(14 32 22.5)" />
              <Path d={LEAF} fill={COLORS.leaf} transform="rotate(166 32 22.5)" />
              <Path d={LEAF} fill={COLORS.leaf} transform="rotate(-34 32 22.5)" />
              <Path d={LEAF} fill={COLORS.leaf} transform="rotate(-146 32 22.5)" />
              <Path d="M32 22.5 C32 19.4 33 17.4 35.2 15.9" fill="none" stroke={COLORS.leaf} strokeWidth={2.4} strokeLinecap="round" />
            </Svg>
          </Animated.View>
        </Animated.View>
        {/* The shine hops with the tomato but does not turn with it. */}
        <Svg width={size} height={size} viewBox="0 0 64 64" style={StyleSheet.absoluteFill}>
          <Ellipse cx={24.5} cy={30} rx={3.4} ry={2.1} fill="#ffffff" opacity={0.55} transform="rotate(-35 24.5 30)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: COLORS.badgeBg, overflow: "visible" },
  halo: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: COLORS.ring,
  },
});
