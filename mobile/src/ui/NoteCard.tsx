import { CircleCheck, Timer } from "lucide-react-native";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { displayTitle, noteTimeLabel } from "../lib/notesList";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";
import type { NoteRecord } from "../types";

type Props = {
  note: NoteRecord;
  /** Open tasks in Life Center that came from this note. */
  taskCount?: number;
  onPress: () => void;
  /** "card" is the list; "timeline" is the journal, drawn without a box. */
  variant?: "card" | "timeline";
};

/** The two small tags a note can carry, shared by both views. */
export function NoteTags({ note, taskCount = 0, compact = false }: { note: NoteRecord; taskCount?: number; compact?: boolean }) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  if (taskCount <= 0 && note.source !== "focus") return null;
  return (
    <View style={styles.tags}>
      {taskCount > 0 ? (
        <View style={[styles.tag, styles.tagTask]}>
          {compact ? null : <CircleCheck size={14} color={colors.accentForeground} />}
          <Text style={[styles.tagText, styles.tagTaskText]}>
            {taskCount} {taskCount === 1 ? "task" : "tasks"} in Life Center
          </Text>
        </View>
      ) : null}
      {note.source === "focus" ? (
        <View style={[styles.tag, styles.tagParked]}>
          {compact ? null : <Timer size={14} color={colors.rest} />}
          <Text style={[styles.tagText, styles.tagParkedText]}>Parked during focus</Text>
        </View>
      ) : null}
    </View>
  );
}

export function NoteCard({ note, taskCount = 0, onPress, variant = "card" }: Props) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { title, preview } = displayTitle(note);
  const when = noteTimeLabel(note.createdAt);

  if (variant === "timeline") {
    return (
      <Pressable onPress={onPress} style={styles.timelineBody} accessibilityRole="button" accessibilityLabel={`Open note: ${title}`}>
        <Text style={styles.title}>{title}</Text>
        {preview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {preview}
          </Text>
        ) : null}
        <NoteTags note={note} taskCount={taskCount} compact />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open note: ${title}`}
    >
      <Text style={styles.title}>{title}</Text>
      {preview ? (
        <Text style={styles.preview} numberOfLines={2}>
          {preview}
        </Text>
      ) : null}
      <View style={styles.footer}>
        <Text style={styles.when}>{when}</Text>
        <NoteTags note={note} taskCount={taskCount} />
      </View>
    </Pressable>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      gap: spacing[2],
    },
    pressed: { opacity: 0.85 },
    title: { fontFamily: fonts.baseSemi, fontSize: 18 * scale, color: colors.foreground },
    preview: { fontFamily: fonts.base, fontSize: 15 * scale, lineHeight: 21 * scale, color: colors.mutedForeground },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing[2],
      marginTop: spacing[1],
    },
    when: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    tag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radius.full,
      paddingHorizontal: spacing[3],
      paddingVertical: 6,
    },
    tagTask: { backgroundColor: colors.accent },
    tagParked: { backgroundColor: colors.restSurface },
    tagText: { fontFamily: fonts.baseSemi, fontSize: 13 * scale },
    tagTaskText: { color: colors.accentForeground },
    tagParkedText: { color: colors.rest },
    timelineBody: { gap: spacing[1], paddingBottom: spacing[6] },
  });
}
