import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarDays, Link2 } from "lucide-react-native";
import { useTasks } from "../hooks/useTasks";
import { areaTag } from "../lib/lifeCenter";
import { formatDue } from "../lib/taskDates";
import { sortTasks } from "../lib/taskSort";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";
import type { TaskRecord } from "../types";
import { Input } from "./Input";
import { Sheet } from "./Sheet";

// Enough to find something by scrolling; the search narrows the rest.
const MAX_SHOWN = 60;

type Props = {
  open: boolean;
  /** The note the chosen task will be linked to. */
  noteId: string;
  /** Tasks already showing in the note (e.g. the one a parked thought came from). */
  excludeIds?: string[];
  onClose: () => void;
  /** Links the task; the sheet closes once it has. */
  onLink: (task: TaskRecord) => Promise<void>;
};

/**
 * Pick one of your open tasks to keep with this note. Tasks already in this
 * note are left out; one linked to another note moves here.
 */
export function LinkTaskSheet({ open, noteId, excludeIds = [], onClose, onLink }: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const { query } = useTasks(undefined, open);
  const [search, setSearch] = useState("");
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setLinking(null);
  }, [open]);

  const exclude = useMemo(() => new Set(excludeIds), [excludeIds]);
  const candidates = useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return sortTasks(
      (query.data?.tasks ?? []).filter(
        (task) =>
          task.status !== "done" &&
          task.noteId !== noteId &&
          !exclude.has(task.id) &&
          words.every((word) =>
            `${task.text} ${task.projectName}`.toLowerCase().includes(word),
          ),
      ),
    );
  }, [query.data?.tasks, noteId, search, exclude]);
  const shown = candidates.slice(0, MAX_SHOWN);

  const choose = async (task: TaskRecord) => {
    if (linking) return;
    setLinking(task.id);
    try {
      await onLink(task);
    } finally {
      setLinking(null);
    }
  };

  return (
    <Sheet
      open={open}
      title="Link a task"
      description="Keep one of your tasks with this note."
      onClose={onClose}
    >
      <Input
        value={search}
        onChangeText={setSearch}
        placeholder="Search your tasks"
        returnKeyType="search"
        autoCorrect={false}
        accessibilityLabel="Search your tasks"
      />
      {query.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : shown.length === 0 ? (
        <Text style={styles.empty}>
          {search.trim() ? "No open tasks match." : "No other open tasks to link."}
        </Text>
      ) : (
        <View>
          {shown.map((task, index) => (
            <Pressable
              key={task.id}
              onPress={() => void choose(task)}
              disabled={linking !== null}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.divider,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Link: ${task.text}`}
            >
              <View style={styles.flex}>
                <Text style={styles.text} numberOfLines={2}>
                  {task.text}
                </Text>
                <View style={styles.meta}>
                  <Text style={styles.metaText}>{areaTag(task.projectName)}</Text>
                  {task.completeBy ? (
                    <>
                      <CalendarDays size={12} color={colors.mutedForeground} />
                      <Text style={styles.metaText}>{formatDue(task.completeBy)}</Text>
                    </>
                  ) : null}
                  {task.noteId ? <Text style={styles.metaText}>· In another note</Text> : null}
                </View>
              </View>
              {linking === task.id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Link2 size={18} color={colors.mutedForeground} />
              )}
            </Pressable>
          ))}
          {candidates.length > MAX_SHOWN ? (
            <Text style={styles.more}>Search to find the rest.</Text>
          ) : null}
        </View>
      )}
    </Sheet>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1 },
    loading: { paddingVertical: spacing[6] },
    empty: {
      fontFamily: fonts.base,
      fontSize: 15 * scale,
      color: colors.mutedForeground,
      paddingVertical: spacing[4],
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      paddingVertical: spacing[3],
    },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    pressed: { opacity: 0.6 },
    text: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
    dot: { width: 8, height: 8, borderRadius: radius.full },
    metaText: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    more: {
      fontFamily: fonts.base,
      fontSize: 13 * scale,
      color: colors.mutedForeground,
      paddingTop: spacing[3],
    },
  });
}
