import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, Plus, Sparkles, X } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNotesPage } from "../../../src/api/notes";
import { useTaskNotes, useTaskSummary, useTasks } from "../../../src/hooks/useTasks";
import { atNoon, formatPlannedDate } from "../../../src/lib/dates";
import { linkedNoteIds } from "../../../src/lib/taskLinks";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useOnline } from "../../../src/sync/network";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, spacing, textSize, type Colors } from "../../../src/theme";
import type { NoteRecord } from "../../../src/types";
import { Input } from "../../../src/ui/Input";
import { fadeInFast } from "../../../src/ui/motion";
import { Skeleton } from "../../../src/ui/Skeleton";

// Enough recent notes to find one by scrolling; the search finds the rest.
const PICKER_LIMIT = 40;
const SEARCH_DEBOUNCE_MS = 250;
const SLOW_SUMMARY_MS = 5_000;

/** "2026-09-24" as "Thu, Sep 24". */
function stepDate(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return formatPlannedDate(atNoon(y, m - 1, d));
}

function noteLabel(note: { title: string; preview?: string; content?: string }): string {
  const title = note.title.trim();
  if (title) return title;
  const text = (note.preview ?? note.content ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : "Untitled";
}

/**
 * A task's notes, in a dialog that slides up over whatever opened it: an AI
 * summary of how the task is going (from its notes and focus time), the
 * steps it has gone through, and every note linked to it. "Link a note"
 * turns the dialog into a picker of your notes; tapping one links or
 * unlinks it.
 *
 * Opened with ?link=1 it starts on the picker.
 */
export default function TaskNotesScreen() {
  const { id, link: startOnLink } = useLocalSearchParams<{ id: string; link?: string }>();
  const taskId = String(id);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors, scale, aiSuggestions } = useAppTheme();
  const online = useOnline();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const tasks = useTasks();
  const task = tasks.query.data?.tasks.find((candidate) => candidate.id === taskId) ?? null;
  const linked = useMemo(() => new Set(task ? linkedNoteIds(task) : []), [task]);
  const notes = useTaskNotes(taskId);

  // With AI suggestions on, the summary comes as the dialog opens (the server
  // reuses it until the notes or focus time change); with them off, only
  // when asked.
  const [wantSummary, setWantSummary] = useState(aiSuggestions);
  const summary = useTaskSummary(taskId, wantSummary && task !== null);
  // Usually about a second; past a few, say it is still coming.
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!summary.isFetching) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_SUMMARY_MS);
    return () => clearTimeout(timer);
  }, [summary.isFetching]);

  const [page, setPage] = useState<"overview" | "link">(startOnLink ? "link" : "overview");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const picker = useQuery({
    queryKey: ["note-picker", query],
    queryFn: () => getNotesPage({ limit: PICKER_LIMIT, ...(query ? { q: query } : {}) }),
    enabled: page === "link",
    placeholderData: (previous) => previous,
  });

  const toggleLink = (note: NoteRecord) => {
    const isLinked = linked.has(note.id);
    tasks.link.mutate(
      { taskId, noteId: note.id, linked: !isLinked },
      { onError: () => toast.show(isLinked ? "That note could not be unlinked." : "That note could not be linked.") },
    );
  };

  const openNote = (noteId: string) => {
    // In the dialog's place, so going back from the note returns to where
    // the dialog was opened.
    router.replace(`/note/${noteId}`);
  };

  if (!task) {
    return (
      <View style={[styles.page, styles.center]}>
        {tasks.query.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Text style={styles.muted}>This task could not be found.</Text>
            <Pressable onPress={() => router.back()} style={styles.textButton} accessibilityRole="button">
              <Text style={styles.textButtonText}>Close</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const noteCount = linked.size;
  const empty = summary.data && summary.data.summary === null;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <X size={22} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Animated.Text key={page} entering={fadeInFast} style={styles.title} numberOfLines={3}>
            {page === "link" ? "Link a note" : task.text}
          </Animated.Text>
        </View>
        {page === "link" ? (
          <Pressable
            onPress={() => setPage("overview")}
            hitSlop={8}
            style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <Text style={styles.textButtonText}>Done</Text>
          </Pressable>
        ) : null}
      </View>

      {page === "overview" ? (
        <Animated.View key="overview" entering={fadeInFast} style={styles.flex}>
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing[6] }]}>
            {/* How it is going. */}
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Sparkles size={13} color={colors.mutedForeground} />
                <Text style={styles.label}>SUMMARY</Text>
                {summary.isFetching && summary.data ? <Text style={styles.updating}>Updating…</Text> : null}
              </View>
              {!online && !summary.data ? (
                <Text style={styles.muted}>The summary needs a connection. It will be here when you're online.</Text>
              ) : !wantSummary ? (
                <Pressable
                  onPress={() => setWantSummary(true)}
                  style={({ pressed }) => [styles.summarise, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityHint="Reads this task's notes and focus time with AI"
                >
                  <Sparkles size={16} color={colors.accentForeground} />
                  <Text style={styles.summariseText}>Summarise how this task is going</Text>
                </Pressable>
              ) : summary.isLoading ? (
                <View style={styles.loading}>
                  <Skeleton style={styles.lineLong} />
                  <Skeleton style={styles.lineLong} />
                  <Skeleton style={styles.lineShort} />
                  <Text style={styles.muted}>
                    {slow ? "Still reading — this is taking longer than usual…" : "Reading your notes…"}
                  </Text>
                </View>
              ) : summary.isError && !summary.data ? (
                <View style={styles.loading}>
                  <Text style={styles.muted}>The summary could not be made just now.</Text>
                  <Pressable onPress={() => void summary.refetch()} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.link}>Try again</Text>
                  </Pressable>
                </View>
              ) : empty ? (
                <Text style={styles.muted}>
                  Link a note to this task, or spend some focus time on it, and a summary of how it is going will
                  show here.
                </Text>
              ) : summary.data?.summary ? (
                <>
                  <Text style={styles.summary}>{summary.data.summary}</Text>
                  {summary.data.progress.length > 0 ? (
                    <View style={styles.steps}>
                      {summary.data.progress.map((step, index) => (
                        <View key={`${step.date}-${index}`} style={styles.step}>
                          <Text style={styles.stepDate}>{stepDate(step.date)}</Text>
                          <Text style={styles.stepText}>{step.text}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>

            {/* Every note linked to the task. */}
            <View style={styles.section}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, styles.flex]}>NOTES · {noteCount}</Text>
                <Pressable
                  onPress={() => setPage("link")}
                  hitSlop={8}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Plus size={16} color={colors.primary} />
                  <Text style={styles.link}>Link a note</Text>
                </Pressable>
              </View>
              {!online && !notes.data ? (
                <Text style={styles.muted}>This task's notes show here when you're online.</Text>
              ) : notes.isLoading ? (
                <ActivityIndicator color={colors.primary} style={styles.spinner} />
              ) : notes.isError && !notes.data ? (
                <View style={styles.loading}>
                  <Text style={styles.muted}>This task's notes could not be loaded.</Text>
                  <Pressable onPress={() => void notes.refetch()} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.link}>Try again</Text>
                  </Pressable>
                </View>
              ) : (notes.data?.notes ?? []).length === 0 ? (
                <Text style={styles.muted}>No notes are linked to this task yet.</Text>
              ) : (
                <View>
                  {(notes.data?.notes ?? []).map((note) => (
                    <Pressable
                      key={note.id}
                      onPress={() => openNote(note.id)}
                      style={({ pressed }) => [styles.noteRow, pressed && styles.pressed]}
                      accessibilityRole="button"
                      accessibilityLabel={`${noteLabel(note)}, ${formatPlannedDate(note.createdAt)}. Open note`}
                    >
                      <Text style={styles.noteTitle} numberOfLines={2}>
                        {noteLabel(note)}
                      </Text>
                      <Text style={styles.noteMeta}>
                        {formatPlannedDate(note.createdAt)}
                        {note.source === "focus" ? " · Parked during focus" : ""}
                      </Text>
                      {note.title.trim() && note.preview ? (
                        <Text style={styles.notePreview} numberOfLines={2}>
                          {note.preview}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View key="link" entering={fadeInFast} style={styles.flex}>
          <View style={styles.searchWrap}>
            <Input
              value={search}
              onChangeText={setSearch}
              placeholder="Search your notes"
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search your notes"
            />
          </View>
          <ScrollView
            contentContainerStyle={[styles.pickerBody, { paddingBottom: insets.bottom + spacing[6] }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {!online && !picker.data ? (
              <Text style={styles.muted}>Finding notes to link needs a connection.</Text>
            ) : picker.isLoading ? (
              <ActivityIndicator color={colors.primary} style={styles.spinner} />
            ) : (picker.data?.notes ?? []).length === 0 ? (
              <Text style={styles.muted}>{query ? "No notes match." : "You have no notes yet."}</Text>
            ) : (
              (picker.data?.notes ?? []).map((note) => {
                const isLinked = linked.has(note.id);
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => toggleLink(note)}
                    style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isLinked }}
                    accessibilityLabel={`${noteLabel(note)}, ${formatPlannedDate(note.createdAt)}`}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.noteTitle} numberOfLines={2}>
                        {noteLabel(note)}
                      </Text>
                      <Text style={styles.noteMeta}>{formatPlannedDate(note.createdAt)}</Text>
                    </View>
                    <View style={[styles.mark, isLinked && styles.markOn]}>
                      {isLinked ? (
                        <Check size={15} color={colors.primaryForeground} strokeWidth={2.6} />
                      ) : (
                        <Plus size={15} color={colors.mutedForeground} />
                      )}
                    </View>
                  </Pressable>
                );
              })
            )}
            {(picker.data?.notes ?? []).length === PICKER_LIMIT ? (
              <Text style={styles.more}>Search to find older notes.</Text>
            ) : null}
          </ScrollView>
        </Animated.View>
      )}
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    center: { alignItems: "center", justifyContent: "center", gap: spacing[3] },
    flex: { flex: 1 },
    pressed: { opacity: 0.7 },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingTop: spacing[4],
      paddingBottom: spacing[3],
    },
    close: { width: 40, height: 40, marginLeft: -spacing[2], alignItems: "center", justifyContent: "center" },
    headerText: { flex: 1, paddingTop: 6 },
    title: {
      fontFamily: fonts.display,
      fontSize: textSize.title * scale,
      lineHeight: 28 * scale,
      color: colors.foreground,
    },
    textButton: { paddingHorizontal: spacing[2], paddingVertical: spacing[2] },
    textButtonText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.primary },
    body: { paddingHorizontal: spacing[4], gap: spacing[6] },
    section: { gap: spacing[3] },
    labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    label: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1.2,
      color: colors.mutedForeground,
    },
    updating: { fontFamily: fonts.base, fontSize: textSize.label * scale, color: colors.mutedForeground, marginLeft: 4 },
    summary: { fontFamily: fonts.base, fontSize: textSize.body * scale, lineHeight: 24 * scale, color: colors.foreground },
    summarise: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      alignSelf: "flex-start",
      borderRadius: 999,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    summariseText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.accentForeground },
    loading: { gap: spacing[2] },
    lineLong: { height: 14, borderRadius: 7 },
    lineShort: { height: 14, borderRadius: 7, width: "60%" },
    steps: { gap: spacing[2], marginTop: spacing[1] },
    step: { flexDirection: "row", gap: spacing[3] },
    stepDate: {
      width: 84 * scale,
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 20 * scale,
      color: colors.mutedForeground,
    },
    stepText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.small * scale, lineHeight: 20 * scale, color: colors.foreground },
    linkButton: { flexDirection: "row", alignItems: "center", gap: 4 },
    link: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
    muted: { fontFamily: fonts.base, fontSize: textSize.small * scale, lineHeight: 20 * scale, color: colors.mutedForeground },
    spinner: { paddingVertical: spacing[4] },
    noteRow: {
      gap: 3,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    noteTitle: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, lineHeight: 22 * scale, color: colors.foreground },
    noteMeta: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    notePreview: { fontFamily: fonts.base, fontSize: textSize.small * scale, lineHeight: 20 * scale, color: colors.mutedForeground },
    searchWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
    pickerBody: { paddingHorizontal: spacing[4] },
    pickRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    mark: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    markOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    more: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground, paddingVertical: spacing[3] },
  });
}
