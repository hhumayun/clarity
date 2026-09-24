import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Minus, Plus, X } from "lucide-react-native";
import { radius, spacing, type Colors, type Fonts } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";
import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_CATEGORY_LABELS,
  type BubbleSuggestion,
  type CompletionSuggestion,
  type Suggestion,
  type SuggestionCategory,
} from "../types";

const COLLAPSED_COUNT = 4;
const LAYOUT_MS = 180;
// Dimmed while a new set is being fetched, restored as it lands — one fade for
// the whole block instead of every chip animating against its neighbours.
const DIM_OPACITY = 0.35;
const DIM_MS = 140;
const RESTORE_MS = 220;

type Props = {
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  loading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onAccept: (suggestion: BubbleSuggestion) => void;
  onDismiss: (suggestion: BubbleSuggestion) => void;
};

function categoryColor(colors: Colors, suggestion: BubbleSuggestion): string {
  if ("kind" in suggestion) return colors.mutedForeground;
  if (suggestion.category === "deeper") return colors.suggestionDeeper;
  if (suggestion.category === "continue") return colors.suggestionContinue;
  return colors.suggestionForward;
}

type ChipProps = {
  suggestion: BubbleSuggestion;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
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
        <Text style={[styles.chipText, { color }]}>{suggestion.text}</Text>
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

export function InlineSuggestions({
  suggestions,
  completionSuggestions,
  loading,
  expanded,
  onToggleExpanded,
  onAccept,
  onDismiss,
}: Props) {
  const { colors, fonts, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);

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

  const inlineRow = suggestions.slice(0, COLLAPSED_COUNT);
  const hiddenCount = suggestions.length - inlineRow.length;

  return (
    <Animated.View
      style={[styles.container, fade]}
      entering={FadeIn.duration(150)}
      layout={LinearTransition.duration(LAYOUT_MS)}
    >
      {completionSuggestions.length > 0 ? (
        <View>
          <Text style={styles.sectionLabel}>FINISH THIS SENTENCE</Text>
          <View style={styles.row}>
            {completionSuggestions.map((suggestion) => (
              <Chip
                key={suggestion.text}
                suggestion={suggestion}
                colors={colors}
                styles={styles}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
          </View>
        </View>
      ) : null}

      {!expanded ? (
        <View>
          <Text style={styles.sectionLabel}>START THE NEXT SENTENCE</Text>
          <View style={styles.row}>
            {inlineRow.map((suggestion) => (
              <Chip
                key={suggestion.text}
                suggestion={suggestion}
                colors={colors}
                styles={styles}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
            {hiddenCount > 0 ? (
              <Pressable style={styles.expander} onPress={onToggleExpanded}>
                <Plus size={14} color={colors.mutedForeground} />
                <Text style={styles.expanderText}>{hiddenCount} more</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : (
        <View>
          {SUGGESTION_CATEGORIES.map((category: SuggestionCategory) => {
            const group = suggestions.filter((item) => item.category === category);
            if (group.length === 0) return null;
            return (
              <View key={category} style={styles.group}>
                <Text style={[styles.groupLabel, { color: categoryColor(colors, group[0]) }]}>
                  {SUGGESTION_CATEGORY_LABELS[category]}
                </Text>
                <View style={styles.row}>
                  {group.map((suggestion) => (
                    <Chip
                key={suggestion.text}
                suggestion={suggestion}
                colors={colors}
                styles={styles}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
                  ))}
                </View>
              </View>
            );
          })}
          <Pressable style={styles.expander} onPress={onToggleExpanded}>
            <Minus size={14} color={colors.mutedForeground} />
            <Text style={styles.expanderText}>Show less</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    container: { gap: spacing[3] },
    status: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    statusText: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
    sectionLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 11 * scale,
      letterSpacing: 0.8,
      color: colors.mutedForeground,
      marginBottom: spacing[2],
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
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
    expander: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing[3],
      paddingVertical: 8,
    },
    expanderText: {
      fontFamily: fonts.baseSemi,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
    group: { marginBottom: spacing[3] },
    groupLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 11 * scale,
      letterSpacing: 0.8,
      marginBottom: spacing[2],
    },
  });
}
