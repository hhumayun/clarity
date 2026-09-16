import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { fonts, radius, spacing, type Colors } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import {
  type BubbleSuggestion,
  type CompletionSuggestion,
  type Suggestion,
} from "../types";

const LAYOUT_MS = 180;
// Dimmed while a new set is being fetched, restored as it lands — one fade for
// the whole block instead of every chip animating against its neighbours.
const DIM_OPACITY = 0.35;
const DIM_MS = 140;
const RESTORE_MS = 220;

// Each row holds one line of chips and scrolls sideways, so the block occupies
// the same height whatever comes back: no reflow when a set is replaced, and
// long suggestions no longer push the note around by wrapping onto new lines.
const ROW_HEIGHT = 46;

type Props = {
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  loading: boolean;
  onAccept: (suggestion: BubbleSuggestion) => void;
  onDismiss: (suggestion: BubbleSuggestion) => void;
};

function categoryColor(colors: Colors, suggestion: BubbleSuggestion): string {
  if ("kind" in suggestion) return colors.mutedForeground;
  if (suggestion.category === "deeper") return colors.suggestionDeeper;
  if (suggestion.category === "continue") return colors.suggestionContinue;
  return colors.suggestionForward;
}

type Styles = ReturnType<typeof makeStyles>;

type ChipProps = {
  suggestion: BubbleSuggestion;
  colors: Colors;
  styles: Styles;
  onAccept: (suggestion: BubbleSuggestion) => void;
  onDismiss: (suggestion: BubbleSuggestion) => void;
};

/**
 * Module scope on purpose: declared inside InlineSuggestions this was a new
 * component type on every render, which remounted every chip rather than
 * updating it.
 */
const Chip = React.memo(function Chip({
  suggestion,
  colors,
  styles,
  onAccept,
  onDismiss,
}: ChipProps) {
  const color = categoryColor(colors, suggestion);
  return (
    <Animated.View
      style={[styles.chipWrap, { borderColor: color }]}
      layout={LinearTransition.duration(LAYOUT_MS)}
    >
      <Pressable
        onPress={() => onAccept(suggestion)}
        accessibilityLabel={`Insert: ${suggestion.text}`}
        style={styles.chip}
      >
        <Text numberOfLines={1} style={[styles.chipText, { color }]}>
          {suggestion.text}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onDismiss(suggestion)}
        accessibilityLabel={`Hide the suggestion: ${suggestion.text}`}
        style={styles.dismiss}
      >
        <X size={14} color={colors.mutedForeground} />
      </Pressable>
    </Animated.View>
  );
});

type RowProps = {
  label: string;
  items: BubbleSuggestion[];
  colors: Colors;
  styles: Styles;
  onAccept: (suggestion: BubbleSuggestion) => void;
  onDismiss: (suggestion: BubbleSuggestion) => void;
};

function SuggestionRow({
  label,
  items,
  colors,
  styles,
  onAccept,
  onDismiss,
}: RowProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>{label}</Text>
        <Text style={styles.sectionCount}>{items.length}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={styles.row}
        contentContainerStyle={styles.rowContent}
      >
        {items.map((suggestion) => (
          <Chip
            key={suggestion.text}
            suggestion={suggestion}
            colors={colors}
            styles={styles}
            onAccept={onAccept}
            onDismiss={onDismiss}
          />
        ))}
      </ScrollView>
    </View>
  );
}

export function InlineSuggestions({
  suggestions,
  completionSuggestions,
  loading,
  onAccept,
  onDismiss,
}: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const dim = useSharedValue(1);
  useEffect(() => {
    dim.value = withTiming(loading ? DIM_OPACITY : 1, {
      duration: loading ? DIM_MS : RESTORE_MS,
    });
  }, [loading, dim]);
  const fade = useAnimatedStyle(() => ({ opacity: dim.value }));

  if (suggestions.length === 0 && completionSuggestions.length === 0) {
    if (!loading) return null;
    return (
      <Animated.View
        style={styles.status}
        entering={FadeIn.duration(150)}
        exiting={FadeOut.duration(120)}
        layout={LinearTransition.duration(LAYOUT_MS)}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.statusText}>Finding words…</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.container, fade]}
      entering={FadeIn.duration(150)}
      layout={LinearTransition.duration(LAYOUT_MS)}
    >
      {completionSuggestions.length > 0 ? (
        <SuggestionRow
          label="FINISH THIS SENTENCE"
          items={completionSuggestions}
          colors={colors}
          styles={styles}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      ) : null}

      {suggestions.length > 0 ? (
        <SuggestionRow
          label="START THE NEXT SENTENCE"
          items={suggestions}
          colors={colors}
          styles={styles}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      ) : null}
    </Animated.View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    container: { gap: spacing[3] },
    status: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      height: ROW_HEIGHT,
    },
    statusText: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
    section: { gap: spacing[2] },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sectionLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 11 * scale,
      letterSpacing: 0.8,
      color: colors.mutedForeground,
    },
    sectionCount: {
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      color: colors.mutedForeground,
    },
    // Fixed height: the row scrolls sideways rather than growing downwards.
    row: { height: ROW_HEIGHT },
    rowContent: { alignItems: "center", gap: spacing[2], paddingRight: spacing[4] },
    chipWrap: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderRadius: radius.full,
      backgroundColor: colors.card,
    },
    chip: { paddingVertical: 8, paddingLeft: spacing[3], paddingRight: spacing[1] },
    chipText: { fontFamily: fonts.base, fontSize: 15 * scale, maxWidth: 240 },
    dismiss: { paddingHorizontal: spacing[2], paddingVertical: 8 },
  });
}
