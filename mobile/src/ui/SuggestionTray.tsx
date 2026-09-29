import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, textSize, type Colors } from "../theme";
import { isCompletionSuggestion, type BubbleSuggestion, type CompletionSuggestion, type Suggestion } from "../types";
import { KEYBOARD_GLIDE_MS, useKeyboardRoom } from "./GentleKeyboardAvoidingView";
import { EASE_OUT } from "./motion";
import { Segmented } from "./Segmented";

// Until the keyboard has been seen, the tray is about as tall as one.
const DEFAULT_HEIGHT = 300;
// If the keyboard has not started moving by now, it is not going to: finish
// on a plain ease instead of following it.
const KEYBOARD_START_MS = 450;
const DIM_OPACITY = 0.45;

type Tab = "continue" | "questions";

type Props = {
  open: boolean;
  /**
   * Closing because the keyboard is coming back: the tray goes down as the
   * keyboard comes up, and the note above does not move.
   */
  keyboardComing: boolean;
  completions: CompletionSuggestion[];
  stems: Suggestion[];
  questions: string[];
  loading: boolean;
  onPick: (suggestion: BubbleSuggestion) => void;
  onPickQuestion: (question: string) => void;
};

/**
 * Word help in the keyboard's place, like a custom keyboard: Continue (ways
 * to finish this sentence, then ways to start the next) and Questions (to
 * write more about). It swaps with the keyboard: as the keyboard goes down the
 * tray comes up by the same amount, and the other way round, so the note
 * above it stays still. With no keyboard up it simply slides in.
 */
export function SuggestionTray({
  open,
  keyboardComing,
  completions,
  stems,
  questions,
  loading,
  onPick,
  onPickQuestion,
}: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>("continue");

  // Mounted while open or on its way out.
  const [visible, setVisible] = useState(open);
  const finishHide = useCallback(() => setVisible(false), []);

  const room = useKeyboardRoom();
  const noRoom = useSharedValue(0);
  const padding = room ?? noRoom;
  const { height: keyboardHeight, progress: keyboard } = useReanimatedKeyboardAnimation();
  const full = useSharedValue(DEFAULT_HEIGHT);
  const shown = useSharedValue(0);
  // While tied, the tray is whatever the keyboard's room is not.
  const tied = useSharedValue(false);
  const wanted = useSharedValue(false);

  useAnimatedReaction(
    () => [keyboard.value, keyboardHeight.value] as const,
    ([p, h]) => {
      if (p > 0.99 && -h > 120) full.value = -h;
    },
  );

  useAnimatedReaction(
    () => padding.value,
    (pad) => {
      if (!tied.value) return;
      if (wanted.value && pad <= 0.5) {
        tied.value = false;
        shown.value = 1;
      } else if (!wanted.value && pad >= full.value - 0.5) {
        tied.value = false;
        shown.value = 0;
        runOnJS(finishHide)();
      }
    },
  );

  const settleTo = useCallback(
    (to: 0 | 1) => {
      // From wherever it is now, on a plain ease.
      if (tied.value) shown.value = Math.max(0, full.value - padding.value) / Math.max(1, full.value);
      tied.value = false;
      shown.value = withTiming(to, { duration: KEYBOARD_GLIDE_MS, easing: EASE_OUT }, (finished) => {
        if (finished && to === 0) runOnJS(finishHide)();
      });
    },
    [finishHide, full, padding, shown, tied],
  );

  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (guardTimer.current) clearTimeout(guardTimer.current);
    wanted.value = open;
    if (open) {
      setVisible(true);
      if (padding.value > 1) tied.value = true;
      else settleTo(1);
    } else if (keyboardComing) {
      tied.value = true;
    } else {
      settleTo(0);
    }
    if (tied.value) {
      const from = padding.value;
      guardTimer.current = setTimeout(() => {
        if (tied.value && Math.abs(padding.value - from) < 2) settleTo(open ? 1 : 0);
      }, KEYBOARD_START_MS);
    }
    return () => {
      if (guardTimer.current) clearTimeout(guardTimer.current);
    };
    // Only a change of open starts a swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const slotStyle = useAnimatedStyle(() => ({
    height: tied.value ? Math.max(0, full.value - padding.value) : full.value * shown.value,
  }));
  // Laid out at full height from the start and uncovered as the slot grows.
  const innerStyle = useAnimatedStyle(() => ({ height: full.value }));

  const continueCount = completions.length + stems.length;
  const empty = tab === "continue" ? continueCount === 0 : questions.length === 0;

  return (
    <Animated.View style={[styles.slot, slotStyle]}>
      {visible ? (
        <Animated.View style={[styles.inner, innerStyle, { paddingBottom: insets.bottom }]}>
          <View style={styles.tabs}>
            <Segmented
              size="sm"
              accessibilityLabel="Kinds of suggestion"
              value={tab}
              onChange={setTab}
              options={[
                { label: "Continue", value: "continue", count: continueCount },
                { label: "Questions", value: "questions", count: questions.length },
              ]}
            />
          </View>
          {empty ? (
            <View style={styles.status}>
              {loading ? <ActivityIndicator color={colors.primary} /> : null}
              <Text style={styles.statusText}>
                {loading
                  ? "Finding words…"
                  : tab === "continue"
                    ? "Write a little, and words to keep going will show here."
                    : "Write a little, and questions to write about will show here."}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={[styles.flex, loading && styles.dim]}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="always"
            >
              {tab === "continue"
                ? [...completions, ...stems].map((suggestion) => (
                    <Pressable
                      key={`${isCompletionSuggestion(suggestion) ? "c" : "s"}-${suggestion.text}`}
                      onPress={() => onPick(suggestion)}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add: ${suggestion.text}`}
                    >
                      {/* Finishing the sentence you are in reads on from it. */}
                      <Text style={styles.rowText}>
                        {isCompletionSuggestion(suggestion) ? `…${suggestion.text}` : suggestion.text}
                      </Text>
                    </Pressable>
                  ))
                : questions.map((question) => (
                    <Pressable
                      key={question}
                      onPress={() => onPickQuestion(question)}
                      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`Add the question: ${question}`}
                    >
                      <Text style={styles.rowText}>{question}</Text>
                    </Pressable>
                  ))}
            </ScrollView>
          )}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1 },
    slot: { overflow: "hidden", backgroundColor: colors.card },
    inner: { paddingTop: spacing[3] },
    tabs: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
    list: { paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
    dim: { opacity: DIM_OPACITY },
    row: {
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pressed: { opacity: 0.6 },
    rowText: {
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      lineHeight: 22 * scale,
      color: colors.foreground,
    },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[4],
    },
    statusText: {
      flex: 1,
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 20 * scale,
      color: colors.mutedForeground,
    },
  });
}
