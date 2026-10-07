import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import type { Strip, WordIdea } from "../editor/useWritingHelp";
import { arrive, leave, settle } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, space } from "../theme/tokens";
import { Chip } from "./Chip";
import { Icon } from "./Icon";
import { ThinkingDots } from "./Thinking";

/** A row of the strip: a chip, and a little room above and below it. */
export const WORD_ROW_HEIGHT = 36 + 2 * 4;
/** The most the strip takes, both rows: what the room for it holds. */
export const WORD_STRIP_MAX_HEIGHT = 2 * WORD_ROW_HEIGHT;

/**
 * Word help, over the bottom of the words, above the tools, after a pause:
 * ways to finish the sentence (they start with "…") on top, and ways to
 * start the next one in the row nearest the tools. A tap puts the words in
 * at the cursor. Each row holds its place: a chip that stops fitting what's
 * typed fades and the others close up, new words fade in, and three soft
 * dots say more are coming. Nothing else about it asks for attention.
 * Drawn into a room `WORD_STRIP_MAX_HEIGHT` high, from its bottom.
 */
export function WordStrip({ finishes, starts, loading, onTake }: Strip & { onTake: (word: WordIdea) => void }) {
  // Both kinds: ways to finish above, ways to start below. One kind: in the row nearest the tools.
  const both = finishes.length > 0 && starts.length > 0;
  const lower = starts.length ? starts : finishes;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" accessibilityLabel="Words you could use">
      {both ? <Row key="upper" ideas={finishes} bottom={WORD_ROW_HEIGHT} mark onTake={onTake} /> : null}
      <Row key="lower" ideas={lower} bottom={0} mark={!both} loading={loading} onTake={onTake} />
    </View>
  );
}

function Row({ ideas, bottom, mark, loading, onTake }: { ideas: WordIdea[]; bottom: number; mark: boolean; loading?: boolean; onTake: (word: WordIdea) => void }) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={arrive} exiting={leave} style={[styles.row, { bottom, backgroundColor: colors.card, borderTopColor: colors.hairline }]}>
      <View style={styles.mark} accessible={false}>
        {mark ? <Icon name="sparkles" size={14} color={colors.ink3} weight="semibold" /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.words}>
        {ideas.map((idea) => (
          <Animated.View key={`${idea.kind}:${idea.text}`} entering={arrive} exiting={leave} layout={settle}>
            <Chip onCard label={idea.kind === "finish" ? `…${idea.text}` : idea.text} accessibilityLabel={`Add “${idea.text}”`} onPress={() => onTake(idea)} />
          </Animated.View>
        ))}
        {loading ? (
          <Animated.View key="more" entering={arrive} exiting={leave} layout={settle} style={styles.more} accessibilityLabel="More words coming">
            <ThinkingDots size={6} />
          </Animated.View>
        ) : null}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { position: "absolute", left: 0, right: 0, height: WORD_ROW_HEIGHT, flexDirection: "row", alignItems: "center", borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: edge - 4 },
  mark: { width: 22, alignItems: "center" },
  words: { alignItems: "center", gap: space[2], paddingLeft: 4, paddingRight: edge },
  more: { height: 36, justifyContent: "center", paddingHorizontal: space[2] },
});
