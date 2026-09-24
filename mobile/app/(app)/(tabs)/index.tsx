import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useFocusedMotion } from "../../../src/hooks/useFocusedMotion";
import { FadeSwitch } from "../../../src/ui/FadeSwitch";
import { EASE_IN, EASE_OUT, fadeOut, MOTION } from "../../../src/ui/motion";
import { SafeAreaView } from "react-native-safe-area-context";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { NOTES_QUERY_KEY, useNotes, useReindexNotes } from "../../../src/hooks/useNotes";
import { useTasks } from "../../../src/hooks/useTasks";
import { formatClockTime, formatLongDate, isSameDay } from "../../../src/lib/dates";
import {
  dayHeading,
  groupNotesByDay,
  inRange,
  notesOnDay,
  parseNoteSearch,
  stripRange,
  stripRangeLabel,
  weeksBackFor,
  weekStrip,
} from "../../../src/lib/notesList";
import { taskCountByNote } from "../../../src/lib/taskSort";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../../../src/theme";
import type { NoteRecord } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { NoteCard } from "../../../src/ui/NoteCard";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Sheet } from "../../../src/ui/Sheet";

const BACKFILL_FLAG = "clarity:backfilled";
const VIEW_KEY = "clarity:notes-view";

type NotesView = "list" | "days";

export default function NotesListScreen() {
  const router = useRouter();
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [view, setView] = useState<NotesView>("list");
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  // Which seven days the journal shows: 0 is the last seven, 1 the seven
  // before that, and so on back.
  const [weeksBack, setWeeksBack] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);
  const autoPick = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const motion = useFocusedMotion();
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
  const queryClient = useQueryClient();
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
    }, [queryClient]),
  );

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
    <Animated.View key={note.id} entering={motion.enter} exiting={motion.exit} layout={motion.layout}>
      <NoteCard
        note={note}
        taskCount={counts.get(note.id)}
        areas={areasOf(note)}
        onPress={() => openNote(note)}
      />
    </Animated.View>
  );

  const groups = useMemo(() => groupNotesByDay(notes), [notes]);
  const strip = useMemo(() => weekStrip(new Date(), weeksBack), [weeksBack]);
  // The journal asks for its own week by date, so any week can be shown, not
  // just those inside the newest-200 the list loads.
  const weekParams = useMemo(() => stripRange(strip), [strip]);
  const weekQuery = useNotes(weekParams, { enabled: view === "days" && !showArchived });
  // While a new week loads, the previous week's notes are still held as a
  // placeholder; they must not paint dots onto the new days.
  const weekNotes = weekQuery.isPlaceholderData ? [] : (weekQuery.data?.notes ?? []);
  const dayNotes = useMemo(() => notesOnDay(weekNotes, selectedDay), [weekNotes, selectedDay]);

  // After paging, land on the most recent day of that week that has notes,
  // rather than an empty last day. Only once per page, when its notes arrive.
  useEffect(() => {
    if (!autoPick.current || weekQuery.isPlaceholderData || !weekQuery.data) return;
    autoPick.current = false;
    if (notesOnDay(weekNotes, selectedDay).length > 0) return;
    const withNotes = [...strip].reverse().find((day) => notesOnDay(weekNotes, day.date).length > 0);
    if (withNotes) setSelectedDay(withNotes.date);
  }, [weekQuery.data, weekQuery.isPlaceholderData, weekNotes, strip, selectedDay]);

  // Changing week slides the strip and the day's notes sideways: earlier
  // dates live to the left, so going back pushes this week off to the right
  // and brings the earlier one in from the left; going forward, the reverse.
  // A plain animated offset, not a layout animation: out, swap, back in.
  const { width: screenWidth } = useWindowDimensions();
  const slideX = useSharedValue(0);
  const slideWidth = useSharedValue(screenWidth);
  useEffect(() => {
    slideWidth.value = screenWidth;
  }, [screenWidth, slideWidth]);
  const weeksBackRef = useRef(weeksBack);
  weeksBackRef.current = weeksBack;
  // Where a slide in progress is heading, so a second quick tap counts from
  // there and moves on a further week rather than repeating the first.
  const pendingWeek = useRef<number | null>(null);
  const slideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (slideTimer.current) clearTimeout(slideTimer.current);
    },
    [],
  );
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slideX.value }],
    opacity: 1 - 0.7 * Math.min(1, Math.abs(slideX.value) / Math.max(1, slideWidth.value)),
  }));

  // The day's notes do not travel with the dates. They fade away as the
  // dates start to move and come back, rising slightly, only when the dates
  // have stopped AND the new week's notes have arrived, so they never show
  // "No notes on this day" for a moment before the real notes land.
  const dayReveal = useSharedValue(1);
  const dayRevealStyle = useAnimatedStyle(() => ({
    opacity: dayReveal.value,
    transform: [{ translateY: (1 - dayReveal.value) * 10 }],
  }));
  const awaitingReveal = useRef(false);
  const [slideSettled, setSlideSettled] = useState(true);

  const SLIDE_OUT_MS = 140;
  const SLIDE_IN_MS = 240;
  const changeWeek = (next: number, day: Date, pickDayWithNotes: boolean) => {
    const target = Math.max(0, next);
    const current = weeksBackRef.current;
    if (target === current) {
      setSelectedDay(day);
      autoPick.current = pickDayWithNotes;
      return;
    }
    // +1 = content moves right (going back to earlier dates).
    const dir = target > current ? 1 : -1;
    const distance = slideWidth.value * 0.6;
    pendingWeek.current = target;
    if (slideTimer.current) clearTimeout(slideTimer.current);
    awaitingReveal.current = true;
    setSlideSettled(false);
    dayReveal.value = withTiming(0, { duration: MOTION.fast, easing: EASE_IN });
    slideX.value = withTiming(dir * distance, { duration: SLIDE_OUT_MS, easing: EASE_IN });
    slideTimer.current = setTimeout(() => {
      slideTimer.current = null;
      pendingWeek.current = null;
      weeksBackRef.current = target;
      setWeeksBack(target);
      setSelectedDay(day);
      autoPick.current = pickDayWithNotes;
      slideX.value = -dir * distance;
      slideX.value = withTiming(0, { duration: SLIDE_IN_MS, easing: EASE_OUT });
      // The dates have stopped once the slide-in has run.
      slideTimer.current = setTimeout(() => {
        slideTimer.current = null;
        setSlideSettled(true);
      }, SLIDE_IN_MS);
    }, SLIDE_OUT_MS);
  };
  const weekReady = weekQuery.isError || (Boolean(weekQuery.data) && !weekQuery.isPlaceholderData);
  useEffect(() => {
    if (!awaitingReveal.current || !slideSettled || !weekReady) return;
    awaitingReveal.current = false;
    dayReveal.value = withTiming(1, { duration: MOTION.slow, easing: EASE_OUT });
  }, [slideSettled, weekReady, selectedDay, dayReveal]);
  // If the journal is left mid-change (another view, the archive), never
  // come back to hidden notes.
  useEffect(() => {
    if (view === "days" && !showArchived) return;
    awaitingReveal.current = false;
    dayReveal.value = 1;
  }, [view, showArchived, dayReveal]);

  const stepWeek = (delta: number) => {
    const target = Math.max(0, (pendingWeek.current ?? weeksBackRef.current) + delta);
    const page = weekStrip(new Date(), target);
    changeWeek(target, page[page.length - 1].date, true);
  };
  const jumpTo = (day: Date) => changeWeek(weeksBackFor(day), day, false);
  const onJumpPicked = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== "ios") setJumpOpen(false);
    if (event.type === "dismissed" || !date) return;
    jumpTo(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
    if (Platform.OS === "ios") setJumpOpen(false);
  };

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
    <Animated.View entering={FadeInDown.duration(180)} style={styles.searchRow}>
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
          entering={motion.enter}
          exiting={motion.exit}
          layout={motion.layout}
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
            <Animated.View layout={motion.layout}>
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
    const hasNote = (day: Date) => weekNotes.some((note) => isSameDay(note.createdAt, day));
    body = (
      <>
        {/* Step back a week at a time, or tap the dates to jump anywhere. */}
        <View style={styles.weekNav}>
          <Pressable
            onPress={() => stepWeek(1)}
            style={styles.weekArrow}
            accessibilityRole="button"
            accessibilityLabel="Previous seven days"
          >
            <ChevronLeft size={20} color={colors.foreground} />
          </Pressable>
          <Pressable
            onPress={() => setJumpOpen(true)}
            style={styles.weekLabelButton}
            accessibilityRole="button"
            accessibilityLabel={`${stripRangeLabel(strip)}. Pick a date`}
          >
            <CalendarDays size={16} color={colors.mutedForeground} />
            <Text style={styles.weekLabel}>{stripRangeLabel(strip)}</Text>
          </Pressable>
          <Pressable
            onPress={() => stepWeek(-1)}
            disabled={weeksBack === 0}
            style={[styles.weekArrow, weeksBack === 0 && styles.weekArrowOff]}
            accessibilityRole="button"
            accessibilityLabel="Next seven days"
            accessibilityState={{ disabled: weeksBack === 0 }}
          >
            <ChevronRight size={20} color={colors.foreground} />
          </Pressable>
        </View>
        {weeksBack > 0 ? (
          <Pressable onPress={() => jumpTo(new Date())} style={styles.backToToday} accessibilityRole="button">
            <Text style={styles.backToTodayText}>Back to today</Text>
          </Pressable>
        ) : null}
        <Animated.View style={slideStyle}>
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
        </Animated.View>
        <Animated.View style={dayRevealStyle}>
        <FadeSwitch switchKey={selectedDay.toDateString()} style={styles.dayBlock}>
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
        </FadeSwitch>
        </Animated.View>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <FadeSwitch switchKey={showArchived ? "archived" : "notes"}>{header}</FadeSwitch>
        {searchField}
        {/* The body fades in whenever what it shows changes kind: list, days,
            archive, or search results. The search field stays out of this, so
            typing never loses focus. */}
        <FadeSwitch
          switchKey={`${showArchived ? "archived" : view}-${searching ? "search" : "browse"}`}
          style={styles.body}
        >
          {body}
        </FadeSwitch>
      </ScrollView>

      {Platform.OS === "ios" ? (
        <Sheet open={jumpOpen} title="Go to a day" onClose={() => setJumpOpen(false)}>
          <DateTimePicker
            value={selectedDay}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            accentColor={colors.primary}
            themeVariant={dark ? "dark" : "light"}
            onChange={onJumpPicked}
          />
        </Sheet>
      ) : jumpOpen ? (
        <DateTimePicker value={selectedDay} mode="date" display="default" maximumDate={new Date()} onChange={onJumpPicked} />
      ) : null}

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
    weekNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
    weekArrow: {
      width: 40,
      height: 40,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    weekArrowOff: { opacity: 0.35 },
    weekLabelButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      borderRadius: radius.full,
    },
    weekLabel: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    backToToday: { alignSelf: "center", marginTop: -spacing[2] },
    backToTodayText: { fontFamily: fonts.baseSemi, fontSize: 14 * scale, color: colors.primary },
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
