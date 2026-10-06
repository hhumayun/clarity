import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import type { Note } from "../store/model";
import { useUnsent } from "../data/sage";
import { noteTime } from "../store/selectors";
import { arrive, leave } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { pad, space } from "../theme/tokens";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/**
 * A note as Rosebud shows an entry: its own card, a small grey line on top
 * (where it belongs and when it was written), the title in bold, then a
 * few lines of what it says. A thought parked during focus says so with a
 * small timer. No colour, and nothing measures it. `match` emphasises a
 * search's words. A title that changes while it's on screen (the AI's, for
 * a note left untitled) fades in, and so does the cloud of a note not sent
 * yet, and out; drawn as the list is, nothing animates.
 */
export function NoteCard({ note, onPress, showArea = true, match, lines = 3 }: { note: Note; onPress?: () => void; showArea?: boolean; match?: string; lines?: number }) {
  const { colors } = useTheme();
  const parked = note.source === "focus";
  const unsent = useUnsent(`note:${note.id}`);
  return (
    <Card
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${note.title}${note.area ? `, ${note.area}` : ""}${parked ? ", parked during focus" : ""}, ${noteTime(note.time)}`}
      style={styles.card}
    >
      <LayoutAnimationConfig skipEntering>
        <View style={styles.top}>
          {showArea && note.area ? (
            <View style={styles.piece}>
              <Icon name="tag" size={12} color={colors.ink3} weight="semibold" />
              <Txt variant="footnote" tone="ink3" numberOfLines={1}>
                {note.area}
              </Txt>
            </View>
          ) : (
            <View style={styles.piece}>
              <Icon name="pen" size={13} color={colors.ink3} weight="medium" />
              <Txt variant="footnote" tone="ink3">
                Note
              </Txt>
            </View>
          )}
          {parked ? (
            <View style={styles.piece}>
              <Icon name="timer" size={13} color={colors.ink3} weight="medium" />
              <Txt variant="footnote" tone="ink3">
                Parked
              </Txt>
            </View>
          ) : null}
          <View style={styles.flex} />
          {unsent ? (
            <Animated.View entering={arrive} exiting={leave} accessible accessibilityLabel="Not sent yet">
              <Icon name="cloudUp" size={13} color={colors.ink3} weight="medium" />
            </Animated.View>
          ) : null}
          <Txt variant="footnote" tone="ink3">
            {noteTime(note.time)}
          </Txt>
        </View>
        <Animated.View key={note.title} entering={arrive}>
          <Txt variant="cardTitle" numberOfLines={2}>
            <Marked text={note.title} match={match} />
          </Txt>
        </Animated.View>
        {note.excerpt ? (
          <Txt variant="subhead" tone="ink2" numberOfLines={lines}>
            <Marked text={note.excerpt} match={match} />
          </Txt>
        ) : null}
      </LayoutAnimationConfig>
    </Card>
  );
}

/** Text with a search's words picked out in the accent, as nested spans. */
export function Marked({ text, match }: { text: string; match?: string }) {
  const { accent } = useTheme();
  const q = match?.trim();
  if (!q) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let at = 0;
  let i = lower.indexOf(needle);
  let key = 0;
  while (i !== -1) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(
      <Text key={key++} style={{ color: accent.text }}>
        {text.slice(i, i + needle.length)}
      </Text>,
    );
    at = i + needle.length;
    i = lower.indexOf(needle, at);
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: pad, paddingTop: 14, paddingBottom: 16, gap: 4 },
  top: { flexDirection: "row", alignItems: "center", gap: space[3], marginBottom: 2 },
  piece: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 1 },
  flex: { flex: 1 },
});
