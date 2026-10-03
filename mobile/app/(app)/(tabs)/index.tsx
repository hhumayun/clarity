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
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useFocusedMotion } from "../../../src/hooks/useFocusedMotion";
import { FadeSwitch } from "../../../src/ui/FadeSwitch";
import { DayTasks } from "../../../src/ui/DayTasks";
import { DayCalendar } from "../../../src/ui/DayCalendar";
import { QuickAddTask, type QuickAddDraft } from "../../../src/ui/QuickAddTask";
import { TASK_ADDED_MS, TaskAddedOverlay } from "../../../src/ui/TaskAddedOverlay";
import { SyncBar } from "../../../src/ui/SyncBar";
import { UnsyncedMark } from "../../../src/ui/UnsyncedMark";
import { TaskQuickMenu } from "../../../src/ui/TaskQuickMenu";
import { EASE_IN, EASE_OUT, fadeOut, MOTION } from "../../../src/ui/motion";
import { SafeAreaView } from "react-native-safe-area-context";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import {
  NOTES_QUERY_KEY,
  flattenPages,
  prefetchNotes,
  useNoteCounts,
  useNotes,
  useNotesPages,
  useReindexNotes,
} from "../../../src/hooks/useNotes";
import { useTasks } from "../../../src/hooks/useTasks";
import { useToast } from "../../../src/providers/ToastProvider";
import { atNoon, dateChipLabel, formatClockTime, formatLongDate, isSameDay } from "../../../src/lib/dates";
import {
  addDays,
  calendarWeek,
  dayHeading,
  dayKey,
  daysAgo,
  displayTitle,
  groupNotesByDay,
  mondayOf,
  monthTitle,
  notesOnDay,
  parseNoteSearch,
  stripRange,
  weeksBetween,
} from "../../../src/lib/notesList";
import { taskCountByNote } from "../../../src/lib/taskSort";
import { areaTag } from "../../../src/lib/lifeCenter";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../../../src/theme";
import type { NoteRecord, TaskRecord, TaskStatus } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { NoteCard } from "../../../src/ui/NoteCard";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Sheet } from "../../../src/ui/Sheet";

const BACKFILL_FLAG = "clarity:backfilled";
const VIEW_KEY = "clarity:notes-view";
const STRIP_KEY = "clarity:notes-strip";
// Pulling the day's header down this far brings back dates folded away.
const SWIPE_PULL = 30;
// Start loading older notes this far (in points) before the end of the list,
// so they are usually there by the time you reach it.
// What the virtualized Notes list draws: a day's label, or a note.
type NotesListItem =
  | { type: "label"; key: string; label: string }
  | { type: "note"; key: string; note: NoteRecord };

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
  const [jumpOpen, setJumpOpen] = useState(false);
  // The day view's dates fold away when its title is tapped (4a).
  const [stripOpen, setStripOpen] = useState(true);
  // A task's press-and-hold menu; its Date row picks a new day in place.
  const [menuTask, setMenuTask] = useState<TaskRecord | null>(null);
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
  const scrollRef = useRef<FlashListRef<NotesListItem>>(null);
  const motion = useFocusedMotion();
  const toTop = () => scrollRef.current?.scrollToOffset({ offset: 0, animated: false });

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
  // The list, search results and the archive show notes as a list (and load
  // older pages as it scrolls); the day view shows its own week.
  const listShown = view === "list" || searching || showArchived;
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
      // Only what is out of date: refetching every loaded page on every
      // visit redrew the whole list each time.
      void queryClient.refetchQueries({ queryKey: NOTES_QUERY_KEY, type: "active", stale: true });
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

  const openNote = useCallback((note: NoteRecord) => router.push(`/note/${note.id}`), [router]);
  // Cards get nothing that changes on every render (the open function and the
  // area names are shared), so they only redraw when their note does.
  const renderNotesItem = useCallback(
    ({ item }: { item: NotesListItem }) =>
      item.type === "label" ? (
        <Text style={[styles.groupLabel, styles.listLabel]}>{item.label}</Text>
      ) : (
        <View style={styles.listCard}>
          <NoteCard note={item.note} taskCount={counts.get(item.note.id)} projectNames={projectNames} onOpen={openNote} />
        </View>
      ),
    [styles, counts, projectNames, openNote],
  );
  const groups = useMemo(() => groupNotesByDay(notes), [notes]);
  // The list as rows for FlashList, which only draws those on screen (and a
  // little either side) and reuses them as it scrolls, so a long list costs
  // about the same as a short one.
  const listItems = useMemo<NotesListItem[]>(
    () =>
      listShown && !isError
        ? groups.flatMap((group) => [
            { type: "label" as const, key: `label-${group.key}`, label: group.label.toUpperCase() },
            ...group.notes.map((note) => ({ type: "note" as const, key: note.id, note })),
          ])
        : [],
    [listShown, isError, groups],
  );
  // The day view's week: Monday first, one row of the month it sits in.
  const weekKey = dayKey(mondayOf(selectedDay));
  // The key names the week; selectedDay is a new Date on every change of day.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const week = useMemo(() => calendarWeek(selectedDay), [weekKey]);
  // The journal asks for its own week by date, so any week can be shown, not
  // just those inside the newest-200 the list loads.
  const weekParams = useMemo(() => stripRange(week), [week]);
  const weekQuery = useNotes(weekParams, { enabled: view === "days" && !showArchived });
  // While a new week loads, the previous week's notes are still held as a
  // placeholder; they must not show under the new day.
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
  // Days with open tasks due, for the dates' teal marks.
  const taskDays = useMemo(
    () =>
      new Set(
        (TASKS_ENABLED ? (tasks.query.data?.tasks ?? []) : []).flatMap((task) =>
          task.completeBy && task.status !== "done" ? [dayKey(task.completeBy)] : [],
        ),
      ),
    [tasks.query.data?.tasks],
  );

  // After swiping back to an earlier week, land on its latest day with notes
  // rather than an empty one. Only once per swipe, when its notes arrive.
  useEffect(() => {
    if (!autoPick.current || weekQuery.isPlaceholderData || !weekQuery.data) return;
    autoPick.current = false;
    if (notesOnDay(weekNotes, selectedDay).length > 0) return;
    const withNotes = [...week].reverse().find((day) => notesOnDay(weekNotes, day.date).length > 0);
    if (withNotes) setSelectedDay(withNotes.date);
  }, [weekQuery.data, weekQuery.isPlaceholderData, weekNotes, week, selectedDay]);

  // The day's notes and tasks fade as the day changes and come back, rising
  // slightly, once the new day is built and (from another week) once that
  // week's notes are here, so "No notes" never shows for a moment before the
  // real notes land. The dates themselves move under the finger.
  const dayReveal = useSharedValue(1);
  const dayRevealStyle = useAnimatedStyle(() => ({
    opacity: dayReveal.value,
    transform: [{ translateY: (1 - dayReveal.value) * 10 }],
  }));
  const awaitingReveal = useRef(false);
  const DAY_OUT_MS = 110;
  const [pendingDay, setPendingDay] = useState<Date | null>(null);
  const shownDay = pendingDay ?? selectedDay;
  const revealDay = useRef(false);
  // Once the old day has faded: the new one is built while nothing shows.
  // A day in the same week comes straight back; one from another week waits
  // for that week's notes. The animation callback runs on the UI thread,
  // which cannot carry a Date: the day crosses as a number.
  const commitDay = (dayMs: number, otherWeek: boolean, withNotes: boolean) => {
    if (otherWeek) awaitingReveal.current = true;
    else revealDay.current = true;
    setSelectedDay(new Date(dayMs));
    setPendingDay(null);
    autoPick.current = withNotes;
  };
  useEffect(() => {
    if (!revealDay.current) return;
    revealDay.current = false;
    dayReveal.value = withTiming(1, { duration: MOTION.slow, easing: EASE_OUT });
  }, [selectedDay, dayReveal]);

  /**
   * Show another day. The dates mark it at once; the day's notes and tasks
   * fade, and the new ones come in once built. `withNotes` moves on to the
   * week's latest day with notes if this one has none. Days chosen in quick
   * succession land on the last: a new fade replaces one still running.
   */
  const showDay = (day: Date, withNotes = false) => {
    const target = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    if (isSameDay(target, shownDay)) return;
    setPendingDay(target);
    const dayMs = target.getTime();
    const otherWeek = weeksBetween(selectedDay, target) !== 0;
    dayReveal.value = withTiming(0, { duration: DAY_OUT_MS, easing: EASE_IN }, (finished) => {
      if (finished) runOnJS(commitDay)(dayMs, otherWeek, withNotes);
    });
  };

  const weekReady = weekQuery.isError || (Boolean(weekQuery.data) && !weekQuery.isPlaceholderData);
  useEffect(() => {
    if (!awaitingReveal.current || !weekReady) return;
    awaitingReveal.current = false;
    dayReveal.value = withTiming(1, { duration: MOTION.slow, easing: EASE_OUT });
  }, [weekReady, selectedDay, dayReveal]);
  // The weeks either side are fetched ahead, so swiping to one shows its
  // notes at once.
  const weekLoaded = Boolean(weekQuery.data) && !weekQuery.isPlaceholderData;
  useEffect(() => {
    if (!weekLoaded) return;
    for (const days of [-7, 7]) void prefetchNotes(queryClient, stripRange(calendarWeek(addDays(week[0].date, days))));
  }, [weekLoaded, week, queryClient]);
  // If the journal is left mid-change (another view, the archive), never
  // come back to hidden notes.
  useEffect(() => {
    if (view === "days" && !showArchived) return;
    awaitingReveal.current = false;
    dayReveal.value = 1;
  }, [view, showArchived, dayReveal]);

  // The dates swiped to another week: today in this week, else the same
  // weekday there (an earlier week moves on to a day with notes).
  const onWeekChange = (monday: Date) => {
    const today = new Date();
    if (weeksBetween(today, monday) === 0) {
      showDay(today);
      return;
    }
    showDay(addDays(monday, (selectedDay.getDay() + 6) % 7), monday.getTime() < mondayOf(today).getTime());
  };
  // The month swiped to another month: today in this month, else its 1st.
  const onMonthChange = (first: Date) => {
    const today = new Date();
    showDay(first.getFullYear() === today.getFullYear() && first.getMonth() === today.getMonth() ? today : first);
  };
  const jumpTo = (day: Date) => showDay(day);
  const onJumpPicked = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== "ios") setJumpOpen(false);
    if (event.type === "dismissed" || !date) return;
    jumpTo(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
    if (Platform.OS === "ios") setJumpOpen(false);
  };

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

  // Whether the dates are open on the month, which then names it.
  const [calendarMonth, setCalendarMonth] = useState(false);
  // Pulled down while the dates are folded away: they come back.
  const unfold = useRef(toggleStrip);
  unfold.current = toggleStrip;
  const pullOpen = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => g.dy > 14 && g.dy > Math.abs(g.dx) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (g.dy > SWIPE_PULL) unfold.current();
        },
      }),
    [],
  );

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
  // away, press and hold to go to another day), Today when another day is
  // showing, plain icons on the right, then the dates, and one hairline under
  // it all. It stays put while the day's notes and tasks scroll beneath it.
  const onToday = isSameDay(shownDay, new Date());
  const dayHeader = (
    <View style={styles.dayHeader} {...(stripOpen ? {} : pullOpen.panHandlers)}>
      <View style={styles.dayHeaderRow}>
        <Pressable
          onPress={toggleStrip}
          onLongPress={() => setJumpOpen(true)}
          style={styles.dayTitleButton}
          accessibilityRole="button"
          accessibilityLabel={`${dayHeading(shownDay)}, ${formatLongDate(shownDay)}. ${stripOpen ? "Hide" : "Show"} the dates`}
          accessibilityHint="Press and hold to go to another day"
        >
          <View style={styles.dayTitleRow}>
            <Text style={styles.dayTitle} numberOfLines={1}>
              {dayHeading(shownDay)}
            </Text>
            <Animated.View style={chevronStyle}>
              <ChevronDown size={16} color={colors.mutedForeground} />
            </Animated.View>
          </View>
          {/* With the month open, the month it shows. */}
          <Text style={styles.daySub} numberOfLines={1}>
            {calendarMonth && stripOpen ? monthTitle(shownDay) : formatLongDate(shownDay)}
          </Text>
        </Pressable>
        {onToday ? null : (
          <Pressable
            onPress={() => showDay(new Date())}
            hitSlop={8}
            style={({ pressed }) => [styles.todayLink, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Go to today"
          >
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        )}
        {headerIcons}
      </View>
      <DayCalendar
        open={stripOpen}
        selected={shownDay}
        taskDays={taskDays}
        onPick={showDay}
        onWeekChange={onWeekChange}
        onMonthChange={onMonthChange}
        onMonthOpenChange={setCalendarMonth}
        onPushUp={toggleStrip}
      />
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

  // Under the list: older notes loading, and the way into the archive.
  const listFooter =
    isFetchingNextPage || (view === "list" && !searching && !showArchived && archivedCount > 0) ? (
      <View style={styles.listFooter}>
        {isFetchingNextPage ? <Text style={styles.loadingMore}>Loading older notes…</Text> : null}
        {view === "list" && !searching && !showArchived && archivedCount > 0 ? (
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
        ) : null}
      </View>
    ) : null;

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
      notes.length > 0 ? null : (
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
      notes.length > 0 || archivedCount > 0 ? null : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No notes yet. Tap "Write a note…" below to start.</Text>
        </View>
      );
  } else {
    body = (
      <Animated.View style={dayRevealStyle}>
        <View style={styles.dayBlock}>
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
              onOpen={(task) => router.push(`/task/${task.id}`)}
              onOpenMenu={setMenuTask}
              onAdd={() => setQuickAddOpen(true)}
              emptyText={daysAgo(selectedDay) < 0 ? "Nothing scheduled yet." : "Nothing was scheduled."}
            />
          ) : null}
        </View>
      </Animated.View>
    );
  }

  // Older pages load as the list nears its end.
  const loadMore = () => {
    if (listShown && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  };

  // The day view pins its header above the scrolling notes and tasks; the
  // list and the archive scroll their header away with the notes.
  const dayView = view === "days" && !showArchived;

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      {dayView ? dayHeader : null}
      <SyncBar />
      {/* One list in every mode, so the search field above the rows is never
          rebuilt (and never loses the keyboard) as results come and go. The
          day view lives in its header with no rows. */}
      <FlashList
        ref={scrollRef}
        data={listItems}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderNotesItem}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {dayView ? null : (
              <FadeSwitch switchKey={showArchived ? "archived" : "notes"}>{header}</FadeSwitch>
            )}
            {searchField}
            {/* Loading, empty and error states, and the day view. The search
                field stays out of this, so typing never loses focus. */}
            {body ? (
              <FadeSwitch
                switchKey={`${showArchived ? "archived" : view}-${searching ? "search" : "browse"}`}
                style={styles.body}
              >
                {body}
              </FadeSwitch>
            ) : null}
          </View>
        }
        ListFooterComponent={listFooter}
      />

      {Platform.OS === "ios" ? (
        <Sheet open={jumpOpen} title="Go to a day" onClose={() => setJumpOpen(false)}>
          <DateTimePicker
            value={selectedDay}
            mode="date"
            display="inline"
            accentColor={colors.primary}
            themeVariant={dark ? "dark" : "light"}
            onChange={onJumpPicked}
          />
        </Sheet>
      ) : jumpOpen ? (
        <DateTimePicker value={selectedDay} mode="date" display="default" onChange={onJumpPicked} />
      ) : null}

      <TaskQuickMenu task={menuTask} onClose={() => setMenuTask(null)} />
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
    listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[8] },
    listHeader: { gap: spacing[4], paddingBottom: spacing[2] },
    // A day's label: the space between days above it, the cards close below.
    listLabel: { paddingTop: spacing[3], paddingBottom: spacing[2] },
    listCard: { paddingBottom: spacing[2] },
    listFooter: { gap: spacing[3], paddingTop: spacing[3] },
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
      paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    dayHeaderRow: { flexDirection: "row", alignItems: "center", gap: spacing[1], paddingTop: 6 },
    dayTitleButton: { flex: 1, minWidth: 0, gap: 2 },
    dayTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    dayTitle: { flexShrink: 1, fontFamily: fonts.display, fontSize: textSize.display * scale, color: colors.foreground },
    daySub: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    // Back to today, beside the day's name when another day is showing.
    todayLink: { paddingHorizontal: spacing[2], paddingVertical: spacing[1] },
    todayText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
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
