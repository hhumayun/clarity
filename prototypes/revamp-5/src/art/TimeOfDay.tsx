import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, G, Line, Path } from "react-native-svg";
import { useTheme } from "../theme/ThemeProvider";
import type { Phase } from "../theme/tokens";
import { useCycle, useOnce, useSwing } from "./motion";

const W = 84;
const H = 64;

/** A small cloud of three bumps, sitting on y = `base`. */
function cloud(x: number, base: number, s = 1) {
  const p = (dx: number, dy: number) => `${(x + dx * s).toFixed(2)} ${(base + dy * s).toFixed(2)}`;
  return `M${p(0, 0)} H${(x + 18 * s).toFixed(2)} A${5 * s} ${5 * s} 0 0 0 ${p(17.6, -9.8)} A${7 * s} ${7 * s} 0 0 0 ${p(4.6, -9.4)} A${4.8 * s} ${4.8 * s} 0 0 0 ${p(0, 0)} Z`;
}

/** A four-pointed sparkle centred on (x, y). */
export function sparkle(x: number, y: number, r: number) {
  return `M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`;
}

/**
 * The day's picture, drawn for Clarity in Rosebud's manner (flat colour
 * inside a dark outline) and alive in a quiet way: at dawn the sun rises a
 * little and its rays breathe; by day it turns slowly behind a drifting
 * cloud; at dusk it sets over water while two birds cross; at night a
 * crescent moon rocks and the stars twinkle. Everything stops under
 * Reduce Motion.
 */
export function TimeOfDay({ phase, size = 84 }: { phase: Phase; size?: number }) {
  const scale = size / W;
  return (
    <View style={{ width: size, height: H * scale }} accessible={false}>
      {phase === "dawn" ? <Dawn scale={scale} /> : phase === "day" ? <Day scale={scale} /> : phase === "dusk" ? <Dusk scale={scale} /> : <Night scale={scale} />}
    </View>
  );
}

/**
 * One moving part of a picture: its own drawing on the shared grid. With
 * `clip` (a y on the grid, and the picture's scale) the part is hidden below
 * that line, as the sun is by the horizon.
 */
function Layer({ children, style, clip, scale = 1, origin }: { children: React.ReactNode; style?: object; clip?: number; scale?: number; origin?: string }) {
  const part = (
    <Animated.View pointerEvents="none" style={[clip !== undefined ? { position: "absolute", top: 0, left: 0, right: 0, height: H * scale } : StyleSheet.absoluteFill, origin ? { transformOrigin: origin } : null, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        {children}
      </Svg>
    </Animated.View>
  );
  if (clip === undefined) return part;
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, height: clip * scale, overflow: "hidden" }}>
      {part}
    </View>
  );
}

function Water({ y = 44 }: { y?: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  return (
    <G stroke={a.line} strokeWidth={2} strokeLinecap="round">
      <Line x1={12} y1={y} x2={72} y2={y} />
      <Line x1={29} y1={y + 6} x2={55} y2={y + 6} />
      <Line x1={36} y1={y + 11} x2={48} y2={y + 11} />
    </G>
  );
}

function Dawn({ scale }: { scale: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const rise = useOnce(1400, 150);
  const rays = useSwing(3200);
  const drift = useSwing(6000);
  const sun = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - rise.value) * 10 * scale }] }));
  const glow = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: (1 - rise.value) * 10 * scale }, { scale: 0.94 + 0.1 * rays.value }],
  }));
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (drift.value - 0.5) * 6 * scale }] }));
  const angles = [-150, -120, -90, -60, -30];
  return (
    <>
      <Layer style={glow} origin={`${42 * scale}px ${44 * scale}px`}>
        <G stroke={a.line} strokeWidth={2} strokeLinecap="round">
          {angles.map((deg) => {
            const r = (deg * Math.PI) / 180;
            return <Line key={deg} x1={42 + Math.cos(r) * 19} y1={44 + Math.sin(r) * 19} x2={42 + Math.cos(r) * 24} y2={44 + Math.sin(r) * 24} />;
          })}
        </G>
      </Layer>
      {/* The sun is clipped by the horizon: drawn as a half disc that rises behind it. */}
      <Layer style={sun} clip={44} scale={scale}>
        <Path d="M28 44 A14 14 0 0 1 56 44 Z" fill={a.sun} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
      </Layer>
      <Layer style={cloudStyle}>
        <Path d={cloud(9, 28, 0.95)} fill={a.cloud} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
      </Layer>
      <Layer>
        <Water />
      </Layer>
    </>
  );
}

function Day({ scale }: { scale: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const turn = useCycle(24000);
  const drift = useSwing(7000);
  const rays = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (drift.value - 0.5) * 10 * scale }] }));
  return (
    <>
      <Layer style={rays} origin={`${38 * scale}px ${28 * scale}px`}>
        <G stroke={a.line} strokeWidth={2} strokeLinecap="round">
          {Array.from({ length: 8 }, (_, i) => {
            const r = (i * 45 * Math.PI) / 180;
            return <Line key={i} x1={38 + Math.cos(r) * 17} y1={28 + Math.sin(r) * 17} x2={38 + Math.cos(r) * 22} y2={28 + Math.sin(r) * 22} />;
          })}
        </G>
      </Layer>
      <Layer>
        <Circle cx={38} cy={28} r={12} fill={a.sun} stroke={a.line} strokeWidth={2} />
      </Layer>
      <Layer style={cloudStyle}>
        <Path d={cloud(42, 48, 1.25)} fill={a.cloud} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
      </Layer>
    </>
  );
}

function Dusk({ scale }: { scale: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const sink = useOnce(1600, 150);
  const fly = useCycle(9000);
  const shimmer = useSwing(2800);
  const sun = useAnimatedStyle(() => ({ transform: [{ translateY: sink.value * 3 * scale }] }));
  const birds = useAnimatedStyle(() => ({ transform: [{ translateX: (fly.value * 40 - 20) * scale }, { translateY: Math.sin(fly.value * Math.PI * 2) * 2 * scale }], opacity: Math.sin(fly.value * Math.PI) }));
  const water = useAnimatedStyle(() => ({ opacity: 0.65 + 0.35 * shimmer.value }));
  return (
    <>
      <Layer style={sun} clip={44} scale={scale}>
        <Path d="M27 44 A15 15 0 0 1 57 44 Z" fill={a.sunDeep} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
      </Layer>
      <Layer style={birds}>
        <G stroke={a.line} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none">
          <Path d="M50 14 q3 -3 6 0 q3 -3 6 0" />
          <Path d="M60 22 q2.2 -2.2 4.4 0 q2.2 -2.2 4.4 0" />
        </G>
      </Layer>
      <Layer style={water}>
        <Water />
      </Layer>
    </>
  );
}

function Night({ scale }: { scale: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const rock = useSwing(5000);
  const t1 = useSwing(1800, 0);
  const t2 = useSwing(2400, 600);
  const t3 = useSwing(2000, 1100);
  const drift = useSwing(8000);
  const moon = useAnimatedStyle(() => ({ transform: [{ rotate: `${(rock.value - 0.5) * 10}deg` }] }));
  const cloudStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (drift.value - 0.5) * 8 * scale }] }));
  return (
    <>
      <Layer style={moon} origin={`${42 * scale}px ${31 * scale}px`}>
        <Path d="M38.22 16.11 A15 15 0 1 0 54.45 35.04 A12.5 12.5 0 0 1 38.22 16.11 Z" fill={a.moon} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
        <Circle cx={32} cy={34} r={2} fill={a.line} opacity={0.22} />
        <Circle cx={38} cy={41} r={1.4} fill={a.line} opacity={0.22} />
      </Layer>
      <Star swing={t1} x={66} y={14} r={4} scale={scale} />
      <Star swing={t2} x={18} y={20} r={3} scale={scale} />
      <Star swing={t3} x={70} y={40} r={2.6} scale={scale} />
      <Layer style={cloudStyle}>
        <Path d={cloud(14, 54, 0.85)} fill={a.cloud} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
      </Layer>
    </>
  );
}

/** A sparkle that twinkles: it brightens and swells, then fades back, on its own beat. */
function Star({ swing, x, y, r, scale }: { swing: SharedValue<number>; x: number; y: number; r: number; scale: number }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * swing.value, transform: [{ scale: 0.7 + 0.45 * swing.value }] }));
  return (
    <Layer style={style} origin={`${x * scale}px ${y * scale}px`}>
      <Path d={sparkle(x, y, r)} fill={colors.art.sun} stroke={colors.art.line} strokeWidth={1.4} strokeLinejoin="round" />
    </Layer>
  );
}
