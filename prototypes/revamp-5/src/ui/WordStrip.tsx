import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import type { WordIdea } from "../editor/useWritingHelp";
import { arrive, leave } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, space } from "../theme/tokens";
import { Chip } from "./Chip";
import { Icon } from "./Icon";

/**
 * Word help, on the keyboard, above the tools: after a pause, a few words to
 * finish the sentence (they start with "…") or to start the next. A tap puts
 * them in at the cursor; typing on lets them go. Nothing else about it asks
 * for attention: it fades in, and out.
 */
export function WordStrip({ words, onTake }: { words: WordIdea[]; onTake: (word: WordIdea) => void }) {
  const { colors } = useTheme();
  return (
    <Animated.View
      entering={arrive}
      exiting={leave}
      style={[styles.strip, { borderTopColor: colors.hairline }]}
      accessibilityLabel="Words you could use"
    >
      <View style={styles.mark} accessible={false}>
        <Icon name="sparkles" size={14} color={colors.ink3} weight="semibold" />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.words}>
        {words.map((word) => (
          <Chip
            key={`${word.kind}:${word.text}`}
            onCard
            label={word.kind === "finish" ? `…${word.text}` : word.text}
            accessibilityLabel={`Add “${word.text}”`}
            onPress={() => onTake(word)}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: edge - 4, paddingVertical: 6 },
  mark: { width: 22, alignItems: "center" },
  words: { alignItems: "center", gap: space[2], paddingLeft: 4, paddingRight: edge },
});
