import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { breathe, duration, easeOut } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { useType } from "./Txt";

/**
 * Three dots that rise and fall in a wave while Clarity reads something
 * (Rosebud shows the same before a reflection arrives). Under Reduce
 * Motion they glow in turn instead of moving.
 */
export function ThinkingDots({ color, size = 7 }: { color?: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dots} accessibilityRole="progressbar" accessibilityLabel="Reading">
      {[0, 1, 2].map((i) => (
        <Dot key={i} delay={i * 150} color={color ?? colors.ink3} size={size} />
      ))}
    </View>
  );
}

function Dot({ delay, color, size }: { delay: number; color: string; size: number }) {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: 360, easing: breathe }), withTiming(0, { duration: 360, easing: breathe }), withTiming(0, { duration: 260 })), -1));
  }, [delay, v]);
  const style = useAnimatedStyle(() => (reduced ? { opacity: 0.35 + 0.65 * v.value } : { opacity: 0.45 + 0.55 * v.value, transform: [{ translateY: -5 * v.value }] }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/**
 * Words that arrive one after another, each fading up into place, the way
 * Rosebud's reflections appear. The whole text is laid out from the start
 * (later words are only invisible), so nothing reflows as it streams.
 * `onDone` is called when the last word has landed.
 */
export function StreamText({ text, variant = "body", tone, style, onDone, speed = duration.stream }: { text: string; variant?: "body" | "callout" | "subhead"; tone?: string; style?: StyleProp<TextStyle>; onDone?: () => void; speed?: number }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const sized = useType(variant);
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const [shown, setShown] = useState(reduced ? words.length : 0);
  useEffect(() => {
    if (reduced) {
      setShown(words.length);
      onDone?.();
      return;
    }
    setShown(0);
    let n = 0;
    const timer = setInterval(() => {
      n += 2; // a word and the space after it
      setShown(n);
      if (n >= words.length) {
        clearInterval(timer);
        onDone?.();
      }
    }, speed);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, reduced, speed]);
  const color = tone ?? colors.ink;
  return (
    <Text style={[sized, { color }, style]} accessibilityLabel={text}>
      {words.map((word, i) => (
        <Text key={i} style={{ opacity: i < shown ? 1 : 0 }}>
          {word}
        </Text>
      ))}
    </Text>
  );
}

/** A block that arrives after a reflection: it fades up from a little below. */
export function Arriving({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return <Animated.View entering={FadeIn.duration(duration.enter).delay(delay).easing(easeOut)}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  dots: { flexDirection: "row", alignItems: "center", gap: 6, height: 18 },
});
