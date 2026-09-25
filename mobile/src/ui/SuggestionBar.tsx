import { Eye, EyeOff, Sparkles, X } from "lucide-react-native";
import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";
import type { BubbleSuggestion, CompletionSuggestion, Suggestion } from "../types";
import { Button } from "./Button";

const LAYOUT_MS = 180;
// Dimmed while a new set is being fetched, restored as it lands: one fade for
// the whole row instead of every chip animating against its neighbours.
const DIM_OPACITY = 0.35;
const DIM_MS = 140;
const RESTORE_MS = 220;

type Props = {
  /** AI suggestions switched on in the editor. */
  aiOn: boolean;
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  loading: boolean;
  /** The sentence starters belong to the sentence the cursor is in. */
  startersHere: boolean;
  /** The completions belong to exactly where the cursor is. */
  completionsHere: boolean;
  onAccept: (suggestion: BubbleSuggestion) => void;
  onDismiss: (suggestion: BubbleSuggestion) => void;
  onRefresh: () => void;
  onToggleAi: () => void;
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
 * Module scope on purpose: declared inside the bar this was a new component
 * type on every render, which remounted every chip rather than updating it.
 */
const Chip = React.memo(function Chip({ suggestion, colors, styles, onAccept, onDismiss }: ChipProps) {
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
        <Text style={[styles.chipText, { color }]} numberOfLines={1}>
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

/**
 * Writing suggestions in one row pinned above the keyboard, like the phone's
 * own predictive bar, so they are in view wherever in the note the writer is
 * working, not only after its last line.
 *
 * A set belongs to the spot it was made for: completions to the exact place,
 * sentence starters to that sentence. Elsewhere in the note the bar says so,
 * and writing there (or ✦) brings suggestions for the new spot.
 */
export function SuggestionBar({
  aiOn,
  suggestions,
  completionSuggestions,
  loading,
  startersHere,
  completionsHere,
  onAccept,
  onDismiss,
  onRefresh,
  onToggleAi,
}: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const dim = useSharedValue(1);
  useEffect(() => {
    dim.value = withTiming(loading ? DIM_OPACITY : 1, { duration: loading ? DIM_MS : RESTORE_MS });
  }, [loading, dim]);
  const fade = useAnimatedStyle(() => ({ opacity: dim.value }));

  const completions = completionsHere ? completionSuggestions : [];
  const starters = startersHere ? suggestions : [];
  const hasChips = completions.length + starters.length > 0;
  // A set exists, but for another part of the note.
  const elsewhere = !hasChips && suggestions.length + completionSuggestions.length > 0;

  const toggle = (
    <Button
      variant="ghost"
      size="icon"
      style={styles.toolButton}
      onPress={onToggleAi}
      accessibilityLabel={aiOn ? "Hide AI suggestions" : "Show AI suggestions"}
    >
      {aiOn ? <EyeOff size={18} color={colors.foreground} /> : <Eye size={18} color={colors.foreground} />}
    </Button>
  );

  if (!aiOn) {
    return (
      <View style={styles.bar}>
        <Text style={styles.caption}>AI suggestions off</Text>
        {toggle}
      </View>
    );
  }

  return (
    <View style={styles.bar}>
      {hasChips ? (
        <Animated.View style={[styles.flex, fade]}>
          {/* "always": a tap inserts the chip without the keyboard going away. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="always"
            contentContainerStyle={styles.row}
          >
            {completions.map((suggestion) => (
              <Chip
                key={`c-${suggestion.text}`}
                suggestion={suggestion}
                colors={colors}
                styles={styles}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
            {completions.length > 0 && starters.length > 0 ? <View style={styles.divider} /> : null}
            {starters.map((suggestion) => (
              <Chip
                key={`s-${suggestion.text}`}
                suggestion={suggestion}
                colors={colors}
                styles={styles}
                onAccept={onAccept}
                onDismiss={onDismiss}
              />
            ))}
          </ScrollView>
        </Animated.View>
      ) : loading ? (
        <View style={[styles.flex, styles.status]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.caption}>Finding words…</Text>
        </View>
      ) : (
        <Text style={styles.caption} numberOfLines={1}>
          {elsewhere ? "Keep writing for suggestions here" : "AI suggestions"}
        </Text>
      )}
      <Button
        variant="ghost"
        size="icon"
        style={styles.toolButton}
        onPress={onRefresh}
        loading={loading}
        accessibilityLabel="Get suggestions for where you are writing"
      >
        <Sparkles size={18} color={colors.foreground} />
      </Button>
      {toggle}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    bar: { flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: 40 },
    flex: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingRight: spacing[2] },
    status: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    caption: {
      flex: 1,
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      letterSpacing: 0.4,
      color: colors.mutedForeground,
    },
    divider: { width: 1, height: 20, backgroundColor: colors.border },
    chipWrap: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderRadius: radius.full,
      backgroundColor: colors.card,
    },
    chip: { paddingVertical: 7, paddingLeft: spacing[3], paddingRight: spacing[1] },
    chipText: { fontFamily: fonts.base, fontSize: 15 * scale, maxWidth: 240 },
    dismiss: { paddingHorizontal: spacing[2], paddingVertical: 7 },
    toolButton: { width: 36, height: 36 },
  });
}
