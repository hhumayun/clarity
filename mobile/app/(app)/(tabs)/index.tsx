import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Archive,
  CalendarDays,
  ChevronDown,
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
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
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
import { Collapse } from "../../../src/ui/Collapse";
import { DayTasks } from "../../../src/ui/DayTasks";
import { QuickAddTask, type QuickAddDraft } from "../../../src/ui/QuickAddTask";
import { TASK_ADDED_MS, TaskAddedOverlay } from "../../../src/ui/TaskAddedOverlay";
import { SyncBar } from "../../../src/ui/SyncBar";
import { UnsyncedMark } from "../../../src/ui/UnsyncedMark";
import { TaskMenu } from "../../../src/ui/TaskMenu";
import { EASE_IN, EASE_OUT, fadeOut, MOTION } from "../../../src/ui/motion";
import { SafeAreaView } from "react-native-safe-area-context";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import {
  NOTES_QUERY_KEY,
  flattenPages,
  useNoteCounts,
  useNotes,
  useNotesPages,
  useReindexNotes,
} from "../../../src/hooks/useNotes";
import { useAfterExit } from "../../../src/hooks/useAfterExit";
import { useTasks } from "../../../src/hooks/useTasks";
import { useToast } from "../../../src/providers/ToastProvider";
import { atNoon, dateChipLabel, formatClockTime, formatLongDate, isSameDay } from "../../../src/lib/dates";
import {
  dayHeading,
  displayTitle,
  groupNotesByDay,
  notesOnDay,
  parseNoteSearch,
  stripRange,
  weeksBackFor,
  weekStrip,
} from "../../../src/lib/notesList";
import { taskCountByNote } from "../../../src/lib/taskSort";
import { areaTag } from "../../../src/lib/lifeCenter";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../../../src/theme";
import type { NoteRecord, TaskRecord, TaskStatus } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { NoteCard } from "../../../src/ui/NoteCard";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Sheet } from "../../../src/ui/Sheet";

const BACKFILL_FLAG = "clarity:backfilled";
const VIEW_KEY = "clarity:notes-view";
const STRIP_KEY = "clarity:notes-strip";
// A sideways swipe on the dates this long changes the week.
const SWIPE_WEEK = 50;
// Start loading older notes this far (in points) before the end of the list,
// so they are usually there by the time you reach it.
const LOAD_MORE_WITHIN = 600;

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
  // The day view's dates fold away when its title is tapped (4a).
  const [stripOpen, setStripOpen] = useState(true);
  // A task's press-and-hold menu; its Date row picks a new day in place.
  const [menuTask, setMenuTask] = useState<TaskRecord | null>(null);
  // Its Notes and Link a note open the task's notes once the menu has gone.
  const afterMenu = useAfterExit();
  // The day's + opens the task box, dated to the day shown.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [added, setAdded] = useState<TaskRecord | null>(null);
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (addedTimer.current) clearTimeout(addedTimer.current);
    },
    [],
  );
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
    void AsyncStorage.getItem(STRIP_KEY)
      .then((saved) => {
        if (saved === "closed") setStripOpen(false);
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
  // Both go to the server, so a search reaches every note, not just the
  // pages loaded so far.
  const params = useMemo(
    () => ({
      ...(parsed.text ? { q: parsed.text } : {}),
      ...(parsed.range ? { from: parsed.range.start, to: parsed.range.end } : {}),
      ...(showArchived ? { archived: true } : {}),
    }),
    [parsed.text, parsed.range, showArchived],
  );
  // The newest notes first; older pages load as the list scrolls near its end.
  const { data, isFetching, isError, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotesPages(params);
  const noteCounts = useNoteCounts();
  const tasks = useTasks(undefined, TASKS_ENABLED);
  const toast = useToast();
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

  const notes = useMemo(() => flattenPages(data), [data]);
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
  const archivedCount = noteCounts.data?.archived ?? 0;
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
  // The day's tasks: the ones due that day, finished ones included.
  const dayTasks = useMemo(
    () =>
      TASKS_ENABLED
        ? (tasks.query.data?.tasks ?? []).filter(
            (task) => task.completeBy !== null && isSameDay(task.completeBy, selectedDay),
          )
        : [],
    [tasks.query.data?.tasks, selectedDay],
  );
  const addDayTask = async (draft: QuickAddDraft) => {
    const { task } = await tasks.create.mutateAsync({ ...draft, status: "todo" });
    setQuickAddOpen(false);
    // The same confirmation as Life Center and a note's tasks.
    setAdded(task);
    if (addedTimer.current) clearTimeout(addedTimer.current);
    addedTimer.current = setTimeout(() => setAdded(null), TASK_ADDED_MS);
    // A date typed into the line can send the task to another day: say where.
    if (!task.completeBy) toast.show("It has no date, so it is in Life Center.");
    else if (!isSameDay(task.completeBy, selectedDay)) toast.show(`It is due ${dateChipLabel(task.completeBy)}.`);
  };
  // The row has already played its own settle and haptic by the time this runs.
  const setTaskStatus = (task: TaskRecord, status: TaskStatus) => {
    tasks.update.mutate(
      { id: task.id, status },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
    );
  };

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

  // With the week arrows gone (4a), the dates are swiped sideways instead:
  // right for the week before, left for the week after. Captured before the
  // day buttons, so a sideways drag never taps a day.
  const stepWeekRef = useRef(stepWeek);
  stepWeekRef.current = stepWeek;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (g.dx > SWIPE_WEEK) stepWeekRef.current(1);
          else if (g.dx < -SWIPE_WEEK && weeksBackRef.current > 0) stepWeekRef.current(-1);
        },
      }),
    [],
  );
  const chevron = useSharedValue(stripOpen ? 1 : 0);
  useEffect(() => {
    chevron.value = withTiming(stripOpen ? 1 : 0, { duration: MOTION.base, easing: EASE_OUT });
  }, [stripOpen, chevron]);
  const chevronStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${chevron.value * 180}deg` }] }));
  const toggleStrip = () => {
    const next = !stripOpen;
    setStripOpen(next);
    void AsyncStorage.setItem(STRIP_KEY, next ? "open" : "closed").catch(() => {});
  };

  const showSearchField = showArchived || view === "list" || searchOpen;

  // Plain icons, no rings (4a): search (day view), list or days, settings.
  const headerIcons = (
    <>
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
    </>
  );

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
      {/* No heading: the tab bar already says Notes. The spacer keeps the
          buttons on the right. */}
      <View style={styles.flex} />
      {headerIcons}
    </View>
  );

  // The day view's header (4a): the day on the left (tap to fold the dates
  // away, press and hold to go to another day), plain icons on the right,
  // the week's dates below, and one hairline under it all. It stays put
  // while the day's notes and tasks scroll beneath it.
  const dayHeader = (
    <View style={styles.dayHeader}>
      <View style={styles.dayHeaderRow}>
        <Pressable
          onPress={toggleStrip}
          onLongPress={() => setJumpOpen(true)}
          style={styles.dayTitleButton}
          accessibilityRole="button"
          accessibilityLabel={`${dayHeading(selectedDay)}, ${formatLongDate(selectedDay)}. ${stripOpen ? "Hide" : "Show"} the dates`}
          accessibilityHint="Press and hold to go to another day"
        >
          <View style={styles.dayTitleRow}>
            <Text style={styles.dayTitle} numberOfLines={1}>
              {dayHeading(selectedDay)}
            </Text>
            <Animated.View style={chevronStyle}>
              <ChevronDown size={16} color={colors.mutedForeground} />
            </Animated.View>
          </View>
          <Text style={styles.daySub} numberOfLines={1}>
            {formatLongDate(selectedDay)}
          </Text>
        </Pressable>
        {headerIcons}
      </View>
      <Collapse open={stripOpen}>
        <Animated.View style={[styles.stripWrap, slideStyle]} {...swipe.panHandlers}>
          {strip.map((day) => {
            const active = isSameDay(day.date, selectedDay);
            const hasNotes = weekNotes.some((note) => isSameDay(note.createdAt, day.date));
            return (
              <Pressable
                key={day.key}
                onPress={() => setSelectedDay(day.date)}
                style={styles.stripDay}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${formatLongDate(day.date)}${hasNotes ? ", has notes" : ""}`}
              >
                <Text style={styles.stripLetter}>{day.letter}</Text>
                <View style={[styles.stripCircle, active && styles.stripCircleActive]}>
                  <Text
                    style={[
                      styles.stripNumber,
                      !active && !hasNotes && styles.stripNumberQuiet,
                      active && styles.stripNumberActive,
                    ]}
                  >
                    {day.day}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Animated.View>
      </Collapse>
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
      {isFetchingNextPage ? <Text style={styles.loadingMore}>Loading older notes…</Text> : null}
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
    body = (
      <Animated.View style={dayRevealStyle}>
        <FadeSwitch switchKey={selectedDay.toDateString()} style={styles.dayBlock}>
          {dayNotes.length === 0 ? (
            <Text style={styles.noNotes}>No notes this day.</Text>
          ) : (
            <View>
              {dayNotes.map((note) => {
                const { title, preview } = displayTitle(note);
                const areaNames = areasOf(note).map((area) => areaTag(area.name)).join(" ");
                const linked = counts.get(note.id) ?? 0;
                const parked = note.source === "focus";
                return (
                  <Pressable
                    key={note.id}
                    onPress={() => openNote(note)}
                    style={({ pressed }) => [styles.noteRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={`${title}, ${formatClockTime(note.createdAt)}`}
                  >
                    <View style={styles.noteBody}>
                      <View style={styles.noteTimeRow}>
                        <Text style={styles.noteTime}>{formatClockTime(note.createdAt)}</Text>
                        <UnsyncedMark subject={`note:${note.id}`} />
                      </View>
                      <Text style={styles.noteTitle}>{title}</Text>
                      {preview ? (
                        <Text style={styles.notePreview} numberOfLines={2}>
                          {preview}
                        </Text>
                      ) : null}
                      {areaNames || linked > 0 || parked ? (
                        <Text style={styles.noteMeta}>
                          {[
                            areaNames,
                            parked ? "Parked during focus" : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                          {linked > 0 ? (
                            <Text style={styles.noteLinked}>
                              {areaNames || parked ? " · " : ""}
                              {linked} {linked === 1 ? "task" : "tasks"}
                            </Text>
                          ) : null}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {TASKS_ENABLED ? (
            <DayTasks
              tasks={dayTasks}
              onStatusChange={setTaskStatus}
              onOpenMenu={setMenuTask}
              onAdd={() => setQuickAddOpen(true)}
            />
          ) : null}
        </FadeSwitch>
      </Animated.View>
    );
  }

  // The day-by-day view shows its own week, so only the list, search results
  // and the archive load older pages.
  const listShown = view === "list" || searching || showArchived;
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!listShown || !hasNextPage || isFetchingNextPage) return;
    const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - LOAD_MORE_WITHIN) {
      void fetchNextPage();
    }
  };

  // The day view pins its header above the scrolling notes and tasks; the
  // list and the archive scroll their header away with the notes.
  const dayView = view === "days" && !showArchived;

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      {dayView ? dayHeader : null}
      <SyncBar />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={100}
      >
        {dayView ? null : (
          <FadeSwitch switchKey={showArchived ? "archived" : "notes"}>{header}</FadeSwitch>
        )}
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

      <TaskMenu
        task={menuTask}
        dueLabel={menuTask?.completeBy ? dateChipLabel(menuTask.completeBy) : "None"}
        onClose={() => setMenuTask(null)}
        onMove={(task, date) => {
          setMenuTask(null);
          // It leaves this day's list, so say where it went once it has.
          tasks.update.mutate(
            { id: task.id, completeBy: date },
            {
              onSuccess: () => toast.show(date ? `Moved to ${dateChipLabel(date)}.` : "Date removed."),
              onError: () => toast.show("That task could not be moved. Please try again."),
            },
          );
        }}
        onFocus={(task) => {
          setMenuTask(null);
          router.push(`/focus/${task.id}`);
        }}
        onNotes={(task) => {
          setMenuTask(null);
          afterMenu.later(() => router.push(`/task/${task.id}`));
        }}
        onLinkNote={(task) => {
          setMenuTask(null);
          afterMenu.later(() => router.push(`/task/${task.id}?link=1`));
        }}
        onExited={afterMenu.run}
      />
      {TASKS_ENABLED ? (
        <QuickAddTask
          open={quickAddOpen}
          onClose={() => setQuickAddOpen(false)}
          projects={tasks.query.data?.projects ?? []}
          defaultProjectId={tasks.query.data?.projects[0]?.id ?? null}
          defaultDate={atNoon(selectedDay.getFullYear(), selectedDay.getMonth(), selectedDay.getDate())}
          placeholder="e.g., Call Dr. Lee"
          onCreateProject={async (name) => (await tasks.createProject.mutateAsync({ name })).project}
          onSubmit={addDayTask}
        />
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
      <TaskAddedOverlay visible={added !== null} projectName={added?.projectName ?? ""} />
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
    title: { fontFamily: fonts.display, fontSize: textSize.display * scale, color: colors.foreground },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    iconButtonOn: { backgroundColor: colors.muted },
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
      fontSize: textSize.body * scale,
      color: colors.foreground,
    },
    group: { gap: spacing[2] },
    loadingMore: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.mutedForeground,
      textAlign: "center",
      paddingVertical: spacing[3],
    },
    groupLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
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
    archivedText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[12] },
    emptyText: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground, textAlign: "center" },
    // Day view (4a): a pinned header with a hairline under it.
    dayHeader: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[1],
      paddingBottom: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    dayHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], paddingTop: 6 },
    dayTitleButton: { flex: 1, minWidth: 0, gap: 2 },
    dayTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dayTitle: { flexShrink: 1, fontFamily: fonts.display, fontSize: textSize.display * scale, color: colors.foreground },
    daySub: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    stripWrap: { flexDirection: "row", marginTop: spacing[4] },
    stripDay: { flex: 1, alignItems: "center", gap: 6 },
    stripLetter: { fontFamily: fonts.baseSemi, fontSize: textSize.label * scale, color: colors.mutedForeground },
    stripCircle: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
    stripCircleActive: { backgroundColor: colors.primary },
    stripNumber: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.foreground },
    // Days without notes are quieter than days with them.
    stripNumberQuiet: { fontFamily: fonts.base, color: colors.mutedForeground },
    stripNumberActive: { color: colors.primaryForeground },
    dayBlock: { gap: spacing[1] },
    noNotes: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.mutedForeground,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    // A note in the day: its time, title, two lines of it, and its area
    // and linked tasks.
    noteRow: { flexDirection: "row" },
    noteBody: { flex: 1, minWidth: 0, gap: 4, paddingBottom: 22 },
    noteTimeRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    noteTime: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    noteTitle: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, lineHeight: 21 * scale, color: colors.foreground },
    notePreview: { fontFamily: fonts.base, fontSize: textSize.small * scale, lineHeight: 20 * scale, color: colors.mutedForeground },
    noteMeta: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground, marginTop: 2 },
    noteLinked: { color: colors.primary },
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
      minHeight: 46,
      borderRadius: 10,
      backgroundColor: colors.card,
      paddingHorizontal: 14,
    },
    writeText: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground },
  });
}
