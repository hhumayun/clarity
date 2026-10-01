import { CircleCheck, Timer } from "lucide-react-native";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { areaTag } from "../lib/lifeCenter";
import { displayTitle, noteTimeLabel } from "../lib/notesList";
import { UnsyncedMark } from "./UnsyncedMark";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../theme";
import type { NoteRecord } from "../types";

type Props = {
  note: NoteRecord;
  /** Open tasks in Life Center that came from this note. */
  taskCount?: number;
  /**
   * Area names by id, shared by every card (a new array per card would make
   * every card redraw on every change to the list).
   */
  projectNames?: Map<string, string>;
  /** Opens the note; one function for every card. */
  onOpen: (note: NoteRecord) => void;
  /** "card" is the list; "timeline" is the journal, drawn without a box. */
  variant?: "card" | "timeline";
};

/** The two small tags a note can carry, shared by both views. */
export function NoteTags({ note, taskCount = 0, compact = false }: { note: NoteRecord; taskCount?: number; compact?: boolean }) {
  const { colors, scale } = useAppTheme();
  const styles = stylesFor(colors, scale);
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

/**
 * A note in the Notes list. Memoised: a card redraws only when its note, its
 * task count or the area names change, not when anything else on the screen
 * does (a search letter, a menu opening).
 */
export const NoteCard = React.memo(function NoteCard({
  note,
  taskCount = 0,
  projectNames,
  onOpen,
  variant = "card",
}: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = stylesFor(colors, scale);
  const areas = (note.projectIds ?? []).flatMap((id) => {
    const name = projectNames?.get(id);
    return name ? [{ id, name }] : [];
  });
  const { title, preview } = displayTitle(note);
  const when = noteTimeLabel(note.createdAt);
  const areaLine =
    areas.length > 0 ? (
      <View style={styles.areas}>
        {areas.map((area) => (
          <Text key={area.id} style={styles.areaText}>
            {areaTag(area.name)}
          </Text>
        ))}
      </View>
    ) : null;

  if (variant === "timeline") {
    return (
      <Pressable onPress={() => onOpen(note)} style={styles.timelineBody} accessibilityRole="button" accessibilityLabel={`Open note: ${title}`}>
        <Text style={styles.title}>{title}</Text>
        {preview ? (
          <Text style={styles.preview} numberOfLines={2}>
            {preview}
          </Text>
        ) : null}
        {areaLine}
        <NoteTags note={note} taskCount={taskCount} compact />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => onOpen(note)}
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
      {areaLine}
      <View style={styles.footer}>
        <Text style={styles.when}>{when}</Text>
        <UnsyncedMark subject={`note:${note.id}`} />
        <NoteTags note={note} taskCount={taskCount} />
      </View>
    </Pressable>
  );
});

// One set of styles per theme and text size, shared by every card.
const styleCache = new WeakMap<Colors, Map<number, ReturnType<typeof makeStyles>>>();
function stylesFor(colors: Colors, scale: number) {
  let byScale = styleCache.get(colors);
  if (!byScale) {
    byScale = new Map();
    styleCache.set(colors, byScale);
  }
  let styles = byScale.get(scale);
  if (!styles) {
    styles = makeStyles(colors, scale);
    byScale.set(scale, styles);
  }
  return styles;
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
    title: { fontFamily: fonts.baseSemi, fontSize: textSize.large * scale, color: colors.foreground },
    preview: { fontFamily: fonts.base, fontSize: textSize.body * scale, lineHeight: 22 * scale, color: colors.mutedForeground },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: spacing[2],
      marginTop: spacing[1],
    },
    when: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    areas: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing[3], rowGap: 2 },
    area: { flexDirection: "row", alignItems: "center", gap: 5 },
    areaDot: { width: 7, height: 7, borderRadius: 4 },
    areaText: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
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
    tagText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale },
    tagTaskText: { color: colors.accentForeground },
    tagParkedText: { color: colors.rest },
    timelineBody: { gap: spacing[1], paddingBottom: spacing[6] },
  });
}
