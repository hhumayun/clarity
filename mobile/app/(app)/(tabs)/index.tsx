import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  Pencil,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { fadeIn, fadeInFast, fadeOut, layoutTransition } from "../../../src/ui/motion";
import { SafeAreaView } from "react-native-safe-area-context";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { useNotes, useReindexNotes } from "../../../src/hooks/useNotes";
import { useTasks } from "../../../src/hooks/useTasks";
import { formatClockTime, formatLongDate, isSameDay } from "../../../src/lib/dates";
import {
  dayHeading,
  groupNotesByDay,
  inRange,
  notesOnDay,
  parseNoteSearch,
  weekStrip,
} from "../../../src/lib/notesList";
import { taskCountByNote } from "../../../src/lib/taskSort";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../../../src/theme";
import type { NoteRecord } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { NoteCard } from "../../../src/ui/NoteCard";
import { Skeleton } from "../../../src/ui/Skeleton";

const BACKFILL_FLAG = "clarity:backfilled";
const VIEW_KEY = "clarity:notes-view";

type NotesView = "list" | "days";

export default function NotesListScreen() {
  const router = useRouter();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [view, setView] = useState<NotesView>("list");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const scrollRef = useRef<ScrollView>(null);
  const toTop = () => scrollRef.current?.scrollTo({ y: 0, animated: false });

  // The chosen view is remembered, so the journal people prefer stays theirs.
  useEffect(() => {
    void AsyncStorage.getItem(VIEW_KEY)
      .then((saved) => {
        if (saved === "list" || saved === "days") setView(saved);
      })
      .catch(() => {});
  }, []);
  const switchView = (next: NotesView) => {
    toTop();
    setView(next);
    setSearchOpen(false);
    void AsyncStorage.setItem(VIEW_KEY, next).catch(() => {});
  };

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // "receipts last week": the words go to the server, the dates stay here.
  const parsed = useMemo(() => parseNoteSearch(debouncedSearch), [debouncedSearch]);
  const searching = debouncedSearch.length > 0;
  const params = useMemo(
    () => ({
      ...(parsed.text ? { q: parsed.text } : {}),
      ...(showArchived ? { archived: true } : {}),
    }),
    [parsed.text, showArchived],
  );
  const { data, isFetching, isError, refetch } = useNotes(params);
  const archivedList = useNotes({ archived: true });
  const tasks = useTasks(undefined, TASKS_ENABLED);

  const reindex = useReindexNotes();
  const reindexRef = useRef(reindex.mutate);
  reindexRef.current = reindex.mutate;
  useEffect(() => {
    void (async () => {
      try {
        if ((await AsyncStorage.getItem(BACKFILL_FLAG)) === "true") return;
        await AsyncStorage.setItem(BACKFILL_FLAG, "true");
        reindexRef.current({});
      } catch {
        // Best effort.
      }
    })();
  }, []);

  const notes = useMemo(
    () => (data?.notes ?? []).filter((note) => inRange(note.createdAt, parsed.range)),
    [data?.notes, parsed.range],
  );
  const counts = useMemo(
    () => (TASKS_ENABLED ? taskCountByNote(tasks.query.data?.tasks ?? []) : new Map<string, number>()),
    [tasks.query.data?.tasks],
  );
  const projectNames = useMemo(
    () => new Map((tasks.query.data?.projects ?? []).map((project) => [project.id, project.name])),
    [tasks.query.data?.projects],
  );
  // A tag whose area was since deleted has already gone from the note on the
  // server; filtering here only covers the moment before the list refetches.
  const areasOf = (note: NoteRecord) =>
    (note.projectIds ?? []).flatMap((id) => {
      const name = projectNames.get(id);
      return name ? [{ id, name }] : [];
    });
  const archivedCount = archivedList.data?.notes.length ?? 0;
  const loading = isFetching && !data;

  const openNote = (note: NoteRecord) => router.push(`/note/${note.id}`);
  // Cards fade in and out as a search narrows the list, and the rest slide
  // into the gaps instead of jumping.
  const card = (note: NoteRecord) => (
    <Animated.View key={note.id} entering={fadeIn} exiting={fadeOut} layout={layoutTransition}>
      <NoteCard
        note={note}
        taskCount={counts.get(note.id)}
        areas={areasOf(note)}
        onPress={() => openNote(note)}
      />
    </Animated.View>
  );

  const groups = useMemo(() => groupNotesByDay(notes), [notes]);
  const strip = useMemo(() => weekStrip(), []);
  const dayNotes = useMemo(() => notesOnDay(notes, selectedDay), [notes, selectedDay]);

  const showSearchField = showArchived || view === "list" || searchOpen;

  const header = showArchived ? (
    <View style={styles.header}>
      <Pressable
        onPress={() => {
          toTop();
          setShowArchived(false);
        }}
        style={styles.iconButton}
        accessibilityLabel="Back to your notes"
      >
        <ChevronLeft size={20} color={colors.foreground} />
      </Pressable>
      <Text style={[styles.title, styles.flex]}>Archived</Text>
    </View>
  ) : (
    <View style={styles.header}>
      <Text style={[styles.title, styles.flex]}>Your notes</Text>
      {view === "days" ? (
        <Pressable
          onPress={() => {
            setSearchOpen((open) => !open);
            if (searchOpen) setSearch("");
          }}
          style={[styles.iconButton, searchOpen && styles.iconButtonOn]}
          accessibilityLabel={searchOpen ? "Close search" : "Search your notes"}
        >
          <Search size={20} color={colors.foreground} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => switchView(view === "list" ? "days" : "list")}
        style={styles.iconButton}
        accessibilityLabel={view === "list" ? "Show notes day by day" : "Show notes as a list"}
      >
        {view === "list" ? (
          <CalendarDays size={20} color={colors.foreground} />
        ) : (
          <List size={20} color={colors.foreground} />
        )}
      </Pressable>
      <Pressable onPress={() => router.push("/settings")} style={styles.iconButton} accessibilityLabel="Settings">
        <SlidersHorizontal size={20} color={colors.foreground} />
      </Pressable>
    </View>
  );

  // Search matches words, dates ("last week") and an area's name: "Business"
  // finds the notes tagged with it.
  const searchField = showSearchField ? (
    <Animated.View entering={FadeInDown.duration(180)} exiting={fadeOut} style={styles.searchRow}>
      <Search size={18} color={colors.mutedForeground} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={'Search, like "receipts" or "last week"'}
        placeholderTextColor={colors.mutedForeground}
        style={styles.searchInput}
        autoFocus={searchOpen && view === "days"}
        returnKeyType="search"
        accessibilityLabel="Search your notes"
      />
      {search ? (
        <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search" hitSlop={8}>
          <X size={18} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </Animated.View>
  ) : null;

  const groupedList = (
    <>
      {groups.map((group) => (
        <Animated.View
          key={group.key}
          style={styles.group}
          entering={fadeIn}
          exiting={fadeOut}
          layout={layoutTransition}
        >
          <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
          {group.notes.map(card)}
        </Animated.View>
      ))}
    </>
  );

  let body: React.ReactNode;
  if (loading) {
    body = (
      <View style={styles.group}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} style={styles.cardSkeleton} />
        ))}
      </View>
    );
  } else if (isError) {
    body = (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>We could not load your notes.</Text>
        <Button variant="secondary" onPress={() => void refetch()}>
          Try again
        </Button>
      </View>
    );
  } else if (searching || showArchived) {
    body =
      notes.length > 0 ? (
        groupedList
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {showArchived && !searching
              ? "No archived notes."
              : parsed.range && !parsed.text
                ? `No notes from ${parsed.range.label}.`
                : `No notes match "${debouncedSearch}".`}
          </Text>
        </View>
      );
  } else if (view === "list") {
    body =
      notes.length > 0 || archivedCount > 0 ? (
        <>
          {groupedList}
          {archivedCount > 0 ? (
            <Animated.View layout={layoutTransition}>
            <Pressable
              onPress={() => {
                toTop();
                setShowArchived(true);
              }}
              style={({ pressed }) => [styles.archivedRow, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Archive size={18} color={colors.mutedForeground} />
              <Text style={styles.archivedText}>Archived notes · {archivedCount}</Text>
              <ChevronRight size={18} color={colors.mutedForeground} />
            </Pressable>
            </Animated.View>
          ) : null}
        </>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No notes yet. Tap "Write a note…" below to start.</Text>
        </View>
      );
  } else {
    const hasNote = (day: Date) => notes.some((note) => isSameDay(note.createdAt, day));
    body = (
      <>
        <View style={styles.strip}>
          {strip.map((day) => {
            const active = isSameDay(day.date, selectedDay);
            const dot = hasNote(day.date);
            return (
              <Pressable
                key={day.key}
                onPress={() => setSelectedDay(day.date)}
                style={[styles.stripDay, active && styles.stripDayActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${formatLongDate(day.date)}${dot ? ", has notes" : ""}`}
              >
                <Text style={[styles.stripLetter, active && styles.stripTextActive]}>{day.letter}</Text>
                <Text style={[styles.stripNumber, active && styles.stripTextActive]}>{day.day}</Text>
                <View style={[styles.stripDot, dot && (active ? styles.stripDotActive : styles.stripDotOn)]} />
              </Pressable>
            );
          })}
        </View>
        <Animated.View key={selectedDay.toDateString()} entering={FadeIn.duration(200)} style={styles.dayBlock}>
          <View>
            <Text style={styles.dayTitle}>{dayHeading(selectedDay)}</Text>
            <Text style={styles.daySub}>
              {formatLongDate(selectedDay)} · {dayNotes.length} {dayNotes.length === 1 ? "note" : "notes"}
            </Text>
          </View>
          {dayNotes.length === 0 ? (
            <Text style={styles.emptyText}>No notes on this day.</Text>
          ) : (
            <View>
              {dayNotes.map((note, i) => (
                <View key={note.id} style={styles.timelineRow}>
                  <View style={styles.rail}>
                    <View
                      style={[
                        styles.railDot,
                        { backgroundColor: note.source === "focus" ? colors.rest : colors.primary },
                      ]}
                    />
                    {i < dayNotes.length - 1 ? <View style={styles.railLine} /> : null}
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.timelineTime}>{formatClockTime(note.createdAt)}</Text>
                    <NoteCard
                      note={note}
                      variant="timeline"
                      taskCount={counts.get(note.id)}
                      areas={areasOf(note)}
                      onPress={() => openNote(note)}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Animated.View key={showArchived ? "archived" : "notes"} entering={fadeInFast}>
          {header}
        </Animated.View>
        {searchField}
        {/* The body fades in whenever what it shows changes kind: list, days,
            archive, or search results. The search field stays out of this, so
            typing never loses focus. */}
        <Animated.View
          key={`${showArchived ? "archived" : view}-${searching ? "search" : "browse"}`}
          entering={fadeIn}
          style={styles.body}
        >
          {body}
        </Animated.View>
      </ScrollView>

      {!showArchived ? (
        <View style={styles.writeWrap}>
          {/* The microphone joins this bar with voice writing (N3). */}
          <Pressable
            style={({ pressed }) => [styles.writeBar, pressed && styles.pressed]}
            onPress={() => router.push("/note/new")}
            accessibilityRole="button"
            accessibilityLabel="Write a note"
          >
            <Pencil size={18} color={colors.mutedForeground} />
            <Text style={styles.writeText}>Write a note…</Text>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    pressed: { opacity: 0.85 },
    content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[8] },
    header: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    body: { gap: spacing[4] },
    title: { fontFamily: fonts.display, fontSize: 32 * scale, color: colors.foreground },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButtonOn: { borderColor: colors.primary },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
    },
    searchInput: {
      flex: 1,
      minHeight: 48,
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.foreground,
    },
    group: { gap: spacing[2] },
    groupLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      letterSpacing: 1,
      color: colors.mutedForeground,
      marginTop: spacing[1],
    },
    cardSkeleton: { height: 110, borderRadius: radius.lg },
    archivedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      marginTop: spacing[2],
    },
    archivedText: { flex: 1, fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[12] },
    emptyText: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.mutedForeground, textAlign: "center" },
    strip: { flexDirection: "row", gap: 6 },
    stripDay: {
      flex: 1,
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing[2],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    stripDayActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    stripLetter: { fontFamily: fonts.base, fontSize: 12 * scale, color: colors.mutedForeground },
    stripNumber: { fontFamily: fonts.baseSemi, fontSize: 18 * scale, color: colors.foreground },
    stripTextActive: { color: colors.primaryForeground },
    stripDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "transparent", marginTop: 2 },
    stripDotOn: { backgroundColor: colors.primary },
    stripDotActive: { backgroundColor: colors.primaryForeground },
    dayBlock: { gap: spacing[4] },
    dayTitle: { fontFamily: fonts.display, fontSize: 26 * scale, color: colors.foreground },
    daySub: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground, marginTop: 2 },
    timelineRow: { flexDirection: "row", gap: spacing[3] },
    rail: { width: 12, alignItems: "center" },
    railDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
    railLine: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 4 },
    timelineTime: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground, marginBottom: 2 },
    writeWrap: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
      paddingBottom: spacing[3],
      backgroundColor: colors.background,
    },
    writeBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      minHeight: 54,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: spacing[4],
    },
    writeText: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.mutedForeground },
  });
}
