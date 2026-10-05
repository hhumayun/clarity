import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedProps, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from "react-native-svg";
import { useTheme } from "../theme/ThemeProvider";
import type { Palette } from "../theme/tokens";
import { useCycle, useOnce, useSwing } from "./motion";
import { sparkle } from "./TimeOfDay";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * The rest of Clarity's small pictures, in the same hand as the day's
 * picture: flat colour inside a dark outline, each with one quiet motion.
 * They mark moments (focus, a clear list, a finished Catch up, an empty
 * search), never decorate a screen that has content to show.
 */

type Grid = { w: number; h: number; scale: number };

/** One drawing on a picture's grid. `origin` is the static point its animated transform turns or grows around. */
function Part({ grid, children, style, origin }: { grid: Grid; children: React.ReactNode; style?: object; origin?: string }) {
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, origin ? { transformOrigin: origin } : null, style]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${grid.w} ${grid.h}`}>
        {children}
      </Svg>
    </Animated.View>
  );
}

function Frame({ grid, children, label }: { grid: Grid; children: React.ReactNode; label?: string }) {
  return (
    <View style={{ width: grid.w * grid.scale, height: grid.h * grid.scale }} accessible={!!label} accessibilityLabel={label} accessibilityRole={label ? "image" : undefined}>
      {children}
    </View>
  );
}

/** px on screen for a point on a picture's grid, for transform origins. */
const at = (grid: Grid, x: number, y: number) => `${x * grid.scale}px ${y * grid.scale}px`;

/**
 * An hourglass for focus: the sand runs from the top bulb to the bottom
 * one, and when it has run out the glass turns over and starts again.
 * `run` false (or Reduce Motion) leaves it still, half run.
 */
export function Hourglass({ size = 64, run = true }: { size?: number; run?: boolean }) {
  const { colors } = useTheme();
  const a = colors.art;
  const grid = { w: 64, h: 64, scale: size / 64 };
  const c = useCycle(7200, run);
  const SAND = 0.84;
  const turn = useAnimatedStyle(() => {
    const f = c.value < SAND ? 0 : (c.value - SAND) / (1 - SAND);
    const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
    return { transform: [{ rotate: `${e * 180}deg` }] };
  });
  const top = useAnimatedStyle(() => {
    const p = run ? Math.min(1, c.value / SAND) : 0.5;
    return { transform: [{ scaleY: Math.max(0.04, 1 - p) }] };
  });
  const bottom = useAnimatedStyle(() => {
    const p = run ? Math.min(1, c.value / SAND) : 0.5;
    return { transform: [{ scaleY: 0.12 + 0.88 * p }] };
  });
  const stream = useAnimatedStyle(() => ({
    opacity: run && c.value < SAND - 0.02 ? 1 : 0,
    transform: [{ translateY: (((c.value * 7200) / 260) % 1) * 4.5 * grid.scale }],
  }));
  return (
    <Frame grid={grid}>
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: at(grid, 32, 32) }, turn]}>
        <Part grid={grid}>
          <Path d="M21 13 C21 22 29 26 30.5 32 C29 38 21 42 21 51 H43 C43 42 35 38 33.5 32 C35 26 43 22 43 13 Z" fill={a.paper} />
        </Part>
        <Part grid={grid} style={top} origin={at(grid, 32, 30.5)}>
          <Path d="M24 18.5 C25 24 30 27 31.3 30.5 H32.7 C34 27 39 24 40 18.5 Z" fill={a.sand} />
        </Part>
        <Part grid={grid} style={bottom} origin={at(grid, 32, 50)}>
          <Path d="M22.6 50 C24.5 43.5 29 40.5 32 40 C35 40.5 39.5 43.5 41.4 50 Z" fill={a.sand} />
        </Part>
        {/* The falling grains: a dotted line that slides down, seen only through the neck and the lower bulb. */}
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 31 * grid.scale, height: 18 * grid.scale, overflow: "hidden" }}>
          <Animated.View style={[{ position: "absolute", left: 0, right: 0, top: -5 * grid.scale, height: 28 * grid.scale }, stream]}>
            <Svg width="100%" height="100%" viewBox={`0 0 64 28`}>
              <Line x1={32} y1={0} x2={32} y2={28} stroke={a.sand} strokeWidth={1.8} strokeDasharray="1.6 2.9" strokeLinecap="round" />
            </Svg>
          </Animated.View>
        </View>
        <Part grid={grid}>
          <Path d="M21 13 C21 22 29 26 30.5 32 C29 38 21 42 21 51 H43 C43 42 35 38 33.5 32 C35 26 43 22 43 13 Z" fill="none" stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
          <Rect x={17} y={7} width={30} height={6} rx={3} fill={a.soil} stroke={a.line} strokeWidth={2} />
          <Rect x={17} y={51} width={30} height={6} rx={3} fill={a.soil} stroke={a.line} strokeWidth={2} />
        </Part>
      </Animated.View>
    </Frame>
  );
}

/**
 * A sprout, for a list that's clear: the stem draws itself up out of the
 * soil, two leaves unfurl from it one after the other, a few sparkles
 * appear, and then it sways a little in no wind at all.
 */
export function Sprout({ size = 96 }: { size?: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const grid = { w: 96, h: 96, scale: size / 96 };
  const stem = useOnce(700, 150);
  const left = useOnce(520, 650);
  const right = useOnce(520, 820);
  const shine = useOnce(500, 1100);
  const sway = useSwing(3600);
  const STEM = 36;
  const stemProps = useAnimatedProps(() => ({ strokeDashoffset: STEM * (1 - stem.value) }));
  const swayStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${(sway.value - 0.5) * 5 * stem.value}deg` }] }));
  const leafL = useAnimatedStyle(() => ({ opacity: left.value > 0 ? 1 : 0, transform: [{ scale: left.value }] }));
  const leafR = useAnimatedStyle(() => ({ opacity: right.value > 0 ? 1 : 0, transform: [{ scale: right.value }] }));
  const sparkles = useAnimatedStyle(() => ({ opacity: shine.value, transform: [{ scale: 0.6 + 0.4 * shine.value }] }));
  return (
    <Frame grid={grid}>
      <Part grid={grid} style={sparkles} origin={at(grid, 48, 40)}>
        <Path d={sparkle(24, 34, 4.5)} fill={a.sun} stroke={a.line} strokeWidth={1.5} strokeLinejoin="round" />
        <Path d={sparkle(73, 24, 3.6)} fill={a.sun} stroke={a.line} strokeWidth={1.4} strokeLinejoin="round" />
        <Path d={sparkle(76, 56, 3)} fill={a.sun} stroke={a.line} strokeWidth={1.3} strokeLinejoin="round" />
      </Part>
      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: at(grid, 48, 78) }, swayStyle]}>
        <Part grid={grid}>
          <AnimatedPath d="M48 77 C48 66 46.5 57 48 42" stroke={a.leafDeep} strokeWidth={3} strokeLinecap="round" fill="none" strokeDasharray={STEM} animatedProps={stemProps} />
        </Part>
        <Part grid={grid} style={leafL} origin={at(grid, 48, 58)}>
          <Path d="M48 58 C40 58 32.5 52 30.5 43.5 C39 42.5 46 48.5 48 58 Z" fill={a.leaf} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
        </Part>
        <Part grid={grid} style={leafR} origin={at(grid, 48, 49)}>
          <Path d="M48 49 C55.5 48 63 42 65 33.5 C56.5 32.5 49.5 39.5 48 49 Z" fill={a.leafDeep} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
        </Part>
      </Animated.View>
      <Part grid={grid}>
        <Ellipse cx={48} cy={79} rx={25} ry={7.5} fill={a.soil} stroke={a.line} strokeWidth={2} />
      </Part>
    </Frame>
  );
}

/** A cup of tea for a quiet moment (nothing planned, a break): steam rises from it in three slow wisps. `art` draws it for a room of its own (the break is always dark). */
export function Tea({ size = 72, art }: { size?: number; art?: Palette["art"] }) {
  const { colors } = useTheme();
  const a = art ?? colors.art;
  const grid = { w: 72, h: 72, scale: size / 72 };
  const w1 = useSwing(2600, 0);
  const w2 = useSwing(2600, 860);
  const w3 = useSwing(2600, 1720);
  return (
    <Frame grid={grid}>
      <Wisp grid={grid} swing={w1} line={a.line} d="M27 30 C24 26 30 23 27 18" />
      <Wisp grid={grid} swing={w2} line={a.line} d="M35 29 C32 25 38 22 35 17" />
      <Wisp grid={grid} swing={w3} line={a.line} d="M43 30 C40 26 46 23 43 18" />
      <Part grid={grid}>
        <Ellipse cx={35} cy={58} rx={23} ry={4.5} fill={a.paper} stroke={a.line} strokeWidth={2} />
        <Path d="M51 39 C58.5 38 60 47.5 50.5 49" stroke={a.line} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Path d="M18 34 H52 V42 C52 51 44.5 56 35 56 C25.5 56 18 51 18 42 Z" fill={a.paper} stroke={a.line} strokeWidth={2} strokeLinejoin="round" />
        <Path d="M18 38 H52" stroke={a.sunDeep} strokeWidth={3} opacity={0.55} />
      </Part>
    </Frame>
  );
}

function Wisp({ grid, swing, d, line }: { grid: Grid; swing: SharedValue<number>; d: string; line: string }) {
  const style = useAnimatedStyle(() => ({ opacity: Math.sin(swing.value * Math.PI) * 0.95, transform: [{ translateY: (0.5 - swing.value) * 7 * grid.scale }] }));
  return (
    <Part grid={grid} style={style}>
      <Path d={d} stroke={line} strokeWidth={1.9} strokeLinecap="round" fill="none" opacity={0.7} />
    </Part>
  );
}

/** A magnifier drifting over a page, for search with nothing typed yet. */
export function Magnifier({ size = 80 }: { size?: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const grid = { w: 80, h: 72, scale: size / 80 };
  const x = useSwing(4200);
  const y = useSwing(2900, 400);
  const glass = useAnimatedStyle(() => ({ transform: [{ translateX: (x.value - 0.6) * 12 * grid.scale }, { translateY: (y.value - 0.5) * 6 * grid.scale }] }));
  return (
    <Frame grid={grid}>
      <Part grid={grid}>
        <Rect x={14} y={8} width={40} height={52} rx={5} fill={a.paper} stroke={a.line} strokeWidth={2} />
        <G stroke={a.line} strokeWidth={2} strokeLinecap="round" opacity={0.45}>
          <Line x1={22} y1={20} x2={46} y2={20} />
          <Line x1={22} y1={28} x2={46} y2={28} />
          <Line x1={22} y1={36} x2={42} y2={36} />
          <Line x1={22} y1={44} x2={36} y2={44} />
        </G>
      </Part>
      <Part grid={grid} style={glass}>
        <Line x1={58} y1={47} x2={66} y2={55} stroke={a.line} strokeWidth={4.5} strokeLinecap="round" />
        <Circle cx={50} cy={39} r={11} fill={a.sky} fillOpacity={0.55} stroke={a.line} strokeWidth={2.4} />
        <Path d="M44.5 35 A6.5 6.5 0 0 1 49 32.5" stroke={a.cloud} strokeWidth={2} strokeLinecap="round" fill="none" />
      </Part>
    </Frame>
  );
}

/** A notebook with a pencil that keeps writing the same small line, for a day with no notes yet. */
export function Notebook({ size = 72 }: { size?: number }) {
  const { colors } = useTheme();
  const a = colors.art;
  const grid = { w: 72, h: 72, scale: size / 72 };
  const write = useCycle(3200);
  const LINE = 34;
  const ink = useAnimatedProps(() => {
    const p = Math.min(1, write.value / 0.7);
    return { strokeDashoffset: LINE * (1 - p), opacity: write.value < 0.9 ? 1 : 1 - (write.value - 0.9) / 0.1 };
  });
  const pencil = useAnimatedStyle(() => {
    const p = Math.min(1, write.value / 0.7);
    return { transform: [{ translateX: p * 22 * grid.scale }, { translateY: Math.sin(p * Math.PI * 4) * 1.6 * grid.scale }] };
  });
  return (
    <Frame grid={grid}>
      <Part grid={grid}>
        <Rect x={16} y={9} width={38} height={52} rx={5} fill={a.paper} stroke={a.line} strokeWidth={2} />
        <G stroke={a.line} strokeWidth={2} strokeLinecap="round" opacity={0.45}>
          <Line x1={24} y1={22} x2={46} y2={22} />
          <Line x1={24} y1={30} x2={46} y2={30} />
        </G>
        <G fill={a.paper} stroke={a.line} strokeWidth={1.8}>
          {[16, 26, 36, 46].map((y) => (
            <Circle key={y} cx={16} cy={y} r={2.6} />
          ))}
        </G>
        <AnimatedPath d="M24 41 c2.5 -4 4 4 6.5 0 s4 4 6.5 0 s4 4 6.5 0" stroke={a.leafDeep} strokeWidth={2} strokeLinecap="round" fill="none" strokeDasharray={LINE} animatedProps={ink} />
      </Part>
      <Part grid={grid} style={pencil}>
        <G transform="rotate(-38 26 40)">
          <Rect x={24} y={20} width={6} height={18} rx={1.5} fill={a.sun} stroke={a.line} strokeWidth={1.8} />
          <Path d="M24 38 L27 43.5 L30 38 Z" fill={a.paper} stroke={a.line} strokeWidth={1.6} strokeLinejoin="round" />
        </G>
      </Part>
    </Frame>
  );
}
