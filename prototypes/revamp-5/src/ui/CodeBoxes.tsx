import * as Haptics from "expo-haptics";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { duration, easeOut, fadeTiming, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { radius, space } from "../theme/tokens";
import { done as doneHaptic } from "./haptics";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

export type CodeState = "idle" | "busy" | "wrong" | "done";

const LENGTH = 6;
const nativeHaptics = process.env.EXPO_OS === "ios" || process.env.EXPO_OS === "android";

/**
 * Six boxes for the emailed code. One field takes the typing, and the
 * keyboard's offer of the code from Mail, while the boxes show it, the next
 * one ringed in your colour. The sixth digit sends it. A wrong code shakes
 * the row once; a right one folds the boxes away into a check that pops.
 */
export function CodeBoxes({ value, onChange, onFilled, state }: { value: string; onChange: (code: string) => void; onFilled: (code: string) => void; state: CodeState }) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const shake = useSharedValue(0);
  const fold = useSharedValue(0);
  const dim = useSharedValue(1);

  useEffect(() => {
    dim.value = withTiming(state === "busy" ? 0.55 : 1, fadeTiming(duration.base));
    if (state === "wrong") {
      if (nativeHaptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (!reduced) shake.value = withSequence(withTiming(-10, { duration: 50 }), withTiming(10, { duration: 70 }), withTiming(-6, { duration: 70 }), withTiming(6, { duration: 70 }), withSpring(0, spring.settle));
    }
    if (state === "done") {
      doneHaptic();
      fold.value = reduced ? withTiming(1, fadeTiming(duration.base)) : withSequence(withTiming(0.55, { duration: duration.quick, easing: easeOut }), withSpring(1, spring.pop));
    } else {
      fold.value = withTiming(0, fadeTiming(duration.quick));
    }
  }, [state, reduced, shake, fold, dim]);

  const row = useAnimatedStyle(() => ({ opacity: dim.value * (1 - Math.min(1, fold.value * 1.8)), transform: [{ translateX: shake.value }, { scale: reduced ? 1 : 1 - 0.08 * fold.value }] }));
  const check = useAnimatedStyle(() => ({ opacity: Math.min(1, fold.value * 1.6), transform: [{ scale: reduced ? 1 : 0.4 + 0.6 * fold.value }] }));

  const active = Math.min(value.length, LENGTH - 1);
  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.row, row]}>
        {Array.from({ length: LENGTH }, (_, index) => {
          const ringed = focused && state === "idle" && index === active && value.length < LENGTH;
          return (
            <View key={index} style={[styles.box, { backgroundColor: colors.card, borderColor: state === "wrong" ? colors.danger : ringed ? accent.solid : "transparent" }]}>
              <Txt variant="title2">{value[index] ?? ""}</Txt>
            </View>
          );
        })}
        <TextInput
          ref={input}
          value={value}
          onChangeText={(text) => {
            if (state === "busy" || state === "done") return;
            const next = text.replace(/\D/g, "").slice(0, LENGTH);
            onChange(next);
            if (next.length === LENGTH) onFilled(next);
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          autoFocus
          caretHidden
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="The code from the email"
          style={[StyleSheet.absoluteFill, styles.hidden]}
        />
      </Animated.View>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center, check]}>
        <View style={[styles.disc, { backgroundColor: accent.solid }]}>
          <Icon name="check" size={30} color={accent.on} weight="bold" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: space[2] },
  row: { flexDirection: "row", justifyContent: "center", gap: space[2] },
  box: { width: 46, height: 56, borderRadius: radius.sm, borderCurve: "continuous", borderWidth: 2, alignItems: "center", justifyContent: "center" },
  hidden: { opacity: 0.02, color: "transparent", fontSize: 1, outlineWidth: 0 },
  center: { alignItems: "center", justifyContent: "center" },
  disc: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
});
