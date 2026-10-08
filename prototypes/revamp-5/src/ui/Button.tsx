import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { calm, duration, easeOut, fadeTiming, keep, spring, squash } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { radius, type TypeName } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = "primary" | "secondary" | "outline" | "soft" | "plain" | "danger" | "quiet";
export type ButtonState = "idle" | "busy" | "done";

const HEIGHTS = { lg: 54, md: 48, sm: 38 } as const;

/**
 * The one button. Primary is the accent, filled; secondary is a white card
 * on the page; outline sits on cards and sheets; soft is the accent's quiet
 * tint. A button answers in place: when its label changes the words roll
 * over, `busy` turns them into a small spinner and `done` into a check that
 * pops, so nothing else on the screen has to move. Disabled primary goes to
 * the accent's tint, never to grey.
 */
export function Button({
  label,
  icon,
  onPress,
  variant = "primary",
  size = "lg",
  state = "idle",
  disabled,
  style,
  accessibilityLabel,
  flex,
  mark,
}: {
  label: string;
  icon?: IconName;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: keyof typeof HEIGHTS;
  state?: ButtonState;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Share a row with another button. */
  flex?: boolean;
  /** A brand mark at the left edge, the words still centred (Google's G). */
  mark?: React.ReactNode;
}) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const off = disabled && state === "idle";
  const palette = {
    primary: { bg: off ? accent.soft : accent.solid, fg: off ? accent.onSoft : accent.on, border: "transparent" },
    secondary: { bg: colors.card, fg: colors.ink, border: "transparent" },
    outline: { bg: colors.card, fg: colors.ink, border: colors.line },
    soft: { bg: accent.soft, fg: accent.onSoft, border: "transparent" },
    plain: { bg: "transparent", fg: colors.ink2, border: "transparent" },
    danger: { bg: colors.card, fg: colors.danger, border: "transparent" },
    // A secondary that steps back (on the quiet surface, grey words): beside something lit (a round-3 look).
    quiet: { bg: colors.quiet, fg: colors.ink2, border: "transparent" },
  }[variant];
  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const height = HEIGHTS[size];
  const textVariant: TypeName = size === "sm" ? "subhead" : "headline";

  return (
    <AnimatedPressable
      onPress={state === "idle" && !disabled ? onPress : undefined}
      onPressIn={() => {
        if (disabled || state !== "idle") return;
        scale.value = withTiming(squash, { duration: duration.press, easing: easeOut, reduceMotion: keep });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { ...(reduced ? calm : spring.pop), reduceMotion: keep });
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled, busy: state === "busy" }}
      style={[
        styles.button,
        { height, backgroundColor: palette.bg, borderColor: palette.border, borderWidth: palette.border === "transparent" ? 0 : 1.5, opacity: off && variant !== "primary" ? 0.45 : 1 },
        size === "sm" && styles.small,
        flex && styles.flex,
        press,
        style,
      ]}
    >
      {mark ? <View style={styles.mark}>{mark}</View> : null}
      <Morph label={label} icon={icon} color={palette.fg} state={state} variant={textVariant} iconSize={size === "sm" ? 15 : 18} />
    </AnimatedPressable>
  );
}

/** Two buttons sharing a row, as Rosebud pairs its actions: equal halves, a small gap. */
export function ButtonPair({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.pair, style]}>{children}</View>;
}

/** The inside of a button: the words, a spinner or a check, one at a time, rolling between them. */
function Morph({ label, icon, color, state, variant, iconSize }: { label: string; icon?: IconName; color: string; state: ButtonState; variant: TypeName; iconSize: number }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState({ current: label, previous: null as string | null, icon, previousIcon: undefined as IconName | undefined });
  const roll = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setShown((old) => (old.current === label && old.icon === icon ? old : { current: label, previous: old.current, icon, previousIcon: old.icon }));
    roll.value = 0;
    roll.value = withTiming(1, fadeTiming(duration.roll));
  }, [label, icon, roll]);

  const words = useSharedValue(state === "idle" ? 1 : 0);
  const busy = useSharedValue(state === "busy" ? 1 : 0);
  const done = useSharedValue(state === "done" ? 1 : 0);
  useEffect(() => {
    const timing = fadeTiming(duration.morph);
    words.value = withTiming(state === "idle" ? 1 : 0, timing);
    busy.value = withTiming(state === "busy" ? 1 : 0, timing);
    if (state === "done") done.value = reduced ? withTiming(1, timing) : withSequence(withTiming(0.6, { duration: 1 }), withSpring(1, spring.pop));
    else done.value = withTiming(0, timing);
  }, [state, words, busy, done, reduced]);

  const travel = 14;
  const incoming = useAnimatedStyle(() => ({ opacity: roll.value * words.value, transform: [{ translateY: reduced ? 0 : (1 - roll.value) * travel }, { scale: 0.9 + 0.1 * words.value }] }));
  const outgoing = useAnimatedStyle(() => ({ opacity: (1 - roll.value) * words.value, transform: [{ translateY: reduced ? 0 : -roll.value * travel }] }));
  const spinner = useAnimatedStyle(() => ({ opacity: busy.value, transform: [{ scale: 0.6 + 0.4 * busy.value }] }));
  const check = useAnimatedStyle(() => ({ opacity: Math.min(1, done.value * 1.6), transform: [{ scale: done.value }] }));

  const content = (text: string, glyph?: IconName) => (
    <View style={styles.content}>
      {glyph ? <Icon name={glyph} size={iconSize} color={color} weight="semibold" /> : null}
      <Txt variant={variant} numberOfLines={1} style={{ color }}>
        {text}
      </Txt>
    </View>
  );
  return (
    <View style={styles.morph}>
      <Animated.View style={incoming}>{content(shown.current, shown.icon)}</Animated.View>
      {shown.previous !== null ? (
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, outgoing]}>
          {content(shown.previous, shown.previousIcon)}
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, spinner]}>
        <Spinner color={color} active={state === "busy"} />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, check]}>
        <Icon name="check" size={iconSize + 4} color={color} weight="bold" />
      </Animated.View>
    </View>
  );
}

/** A short arc that turns while something is being made. Still under Reduce Motion: it breathes instead. */
export function Spinner({ color, size = 20, active = true }: { color: string; size?: number; active?: boolean }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!active) {
      cancelAnimation(turn);
      return;
    }
    turn.value = 0;
    turn.value = withRepeat(withTiming(1, { duration: reduced ? 1400 : 800, easing: Easing.linear, reduceMotion: keep }), -1, false);
    return () => cancelAnimation(turn);
  }, [active, reduced, turn]);
  const style = useAnimatedStyle(() => (reduced ? { opacity: 0.55 + 0.45 * Math.sin(turn.value * Math.PI) } : { transform: [{ rotate: `${turn.value * 360}deg` }] }));
  const r = size / 2 - 2;
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeOpacity={0.25} strokeWidth={2.4} fill="none" />
        <Path d={`M ${size / 2} ${size / 2 - r} A ${r} ${r} 0 0 1 ${size / 2 + r} ${size / 2}`} stroke={color} strokeWidth={2.4} strokeLinecap="round" fill="none" />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: radius.button, borderCurve: "continuous", alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  small: { borderRadius: radius.sm, paddingHorizontal: 14 },
  flex: { flex: 1 },
  pair: { flexDirection: "row", gap: 10 },
  morph: { alignItems: "center", justifyContent: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", gap: 8 },
  mark: { position: "absolute", left: 20, top: 0, bottom: 0, justifyContent: "center" },
});
