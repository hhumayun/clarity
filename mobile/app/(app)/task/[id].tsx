import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { ClippingScrollView } from "react-native-keyboard-controller";
import Animated, { useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getNotesPage } from "../../../src/api/notes";
import { useAfterExit } from "../../../src/hooks/useAfterExit";
import { useCaretFollow } from "../../../src/hooks/useCaretFollow";
import { useFocusSummary } from "../../../src/hooks/useFocus";
import { useTaskNotes, useTaskSummary, useTasks } from "../../../src/hooks/useTasks";
import { atNoon, dateChipLabel, formatPlannedDate, isSameDay } from "../../../src/lib/dates";
import { focusMetaLabel } from "../../../src/lib/focus";
import { hapticDone, hapticUndone } from "../../../src/lib/haptics";
import { areaTag } from "../../../src/lib/lifeCenter";
import { useMovedFrom } from "../../../src/lib/movedFrom";
import { dueTimeLabel, reminderLabel, REPEAT_LABELS, type TaskChange } from "../../../src/lib/reminderRules";
import { linkedNoteIds } from "../../../src/lib/taskLinks";
import { sortProjects } from "../../../src/lib/taskSort";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { useOnline } from "../../../src/sync/network";
import { useIsPending } from "../../../src/sync/SyncProvider";
import { outbox } from "../../../src/sync/store";
import { fonts, radius, spacing, textSize, type Colors } from "../../../src/theme";
import type { NoteRecord, TaskRecord } from "../../../src/types";
import { GentleKeyboardAvoidingView } from "../../../src/ui/GentleKeyboardAvoidingView";
import { Input } from "../../../src/ui/Input";
import { fadeInFast } from "../../../src/ui/motion";
import { PomodoroBadge } from "../../../src/ui/PomodoroBadge";
import { Skeleton } from "../../../src/ui/Skeleton";
import { TaskSheet, type TaskField } from "../../../src/ui/TaskSheet";

// Enough recent notes to find one by scrolling; the search finds the rest.
const PICKER_LIMIT = 40;
const SEARCH_DEBOUNCE_MS = 250;
const SLOW_SUMMARY_MS = 5_000;
// The task's words are saved once the writing pauses, as a note's are.
const SAVE_DELAY_MS = 700;
const DETAILS_LINE_HEIGHT = 24;

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

/** A task's line as it is kept: one line, single spaces. */
function oneLine(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/**
 * A task with everything about it, on a screen of its own that every list
 * opens: its words and area, its day, time and reminder, its details, its
 * focus time, how it is going (an AI summary from its notes and focus time)
 * and its notes. Everything is changed in place and saved as it is made,
 * offline too, like a note: no Save button. The day, time, reminder and area
 * each open their page of choices in a sheet.
 *
 * Opened with ?link=1 it starts on linking a note.
 */
export default function TaskScreen() {
  const { id, link: startOnLink } = useLocalSearchParams<{ id: string; link?: string }>();
  const taskId = String(id);
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors, scale, aiSuggestions } = useAppTheme();
  const online = useOnline();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const tasks = useTasks();
  const found = tasks.query.data?.tasks.find((candidate) => candidate.id === taskId) ?? null;
  // Deleted from here: the screen keeps showing it while it goes.
  const deletedRef = useRef(false);
  const lastTask = useRef<TaskRecord | null>(null);
  if (found) lastTask.current = found;
  const task = found ?? (deletedRef.current ? lastTask.current : null);
  const projects = useMemo(() => sortProjects(tasks.query.data?.projects ?? []), [tasks.query.data?.projects]);
  const linked = useMemo(() => new Set(task ? linkedNoteIds(task) : []), [task]);
  const notes = useTaskNotes(taskId);
  const focusSummary = useFocusSummary();
  const focus = focusSummary.data?.tasks.find((row) => row.taskId === taskId) ?? null;
  const movedFrom = useMovedFrom()(taskId);
  const pending = useIsPending(`task:${taskId}`);

  const updateRef = useRef(tasks.update.mutate);
  updateRef.current = tasks.update.mutate;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const taskRef = useRef(task);
  taskRef.current = task;

  // Something was changed on this visit: from then on the header says how
  // the saving is going.
  const [touched, setTouched] = useState(false);
  const failed = () => toastRef.current.show("That change could not be saved. Please try again.");

  // The task's line and details, edited here. Saved once the writing pauses
  // and whenever the screen goes.
  const [text, setText] = useState("");
  const [details, setDetails] = useState("");
  const textRef = useRef(text);
  textRef.current = text;
  const detailsRef = useRef(details);
  detailsRef.current = details;
  // The words as last saved here, or as found on the task: a change made
  // elsewhere is taken in only while nothing here is waiting to be saved or
  // sent (a list fetched just before a save still has the old words).
  const savedWords = useRef<{ text: string; details: string } | null>(null);
  useEffect(() => {
    if (!task) return;
    const theirs = { text: task.text, details: task.description ?? "" };
    const mine = savedWords.current;
    const unsaved =
      mine !== null && (oneLine(textRef.current) !== mine.text || detailsRef.current.trim() !== mine.details);
    const same = mine !== null && theirs.text === mine.text && theirs.details === mine.details;
    if (mine && (unsaved || same || outbox.isPending(`task:${task.id}`))) return;
    savedWords.current = theirs;
    setText(theirs.text);
    setDetails(theirs.details);
    // Only the words matter here, not every new copy of the task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.text, task?.description]);

  const saveWords = useCallback(() => {
    const current = taskRef.current;
    const saved = savedWords.current;
    if (!current || !saved || deletedRef.current) return;
    const nextText = oneLine(textRef.current);
    const nextDetails = detailsRef.current.trim();
    const change: TaskChange = { id: current.id };
    // An emptied line is not saved; leaving the line puts the old one back.
    if (nextText && nextText !== saved.text) change.text = nextText;
    if (nextDetails !== saved.details) change.description = nextDetails;
    if (change.text === undefined && change.description === undefined) return;
    savedWords.current = { text: change.text ?? saved.text, details: change.description ?? saved.details };
    updateRef.current(change, {
      onError: () => toastRef.current.show("That change could not be saved. Please try again."),
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(saveWords, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, details, saveWords]);
  // However the screen goes, its words go with it.
  useEffect(() => navigation.addListener("beforeRemove", saveWords), [navigation, saveWords]);

  // The details grow with their words, as a note's text does, and the page
  // follows their cursor the same way (see the note page).
  const detailsInputRef = useRef<TextInput>(null);
  const keyboardRoom = useSharedValue(0);
  const follow = useCaretFollow({
    textRef: detailsInputRef,
    textLength: () => detailsRef.current.length,
    lineHeight: DETAILS_LINE_HEIGHT * scale,
    keyboardRoom,
  });

  const saved = savedWords.current;
  const unsavedWords =
    saved !== null &&
    ((oneLine(text) !== "" && oneLine(text) !== saved.text) || details.trim() !== saved.details);
  const statusLabel = !touched
    ? ""
    : unsavedWords || pending
      ? online
        ? "Saving…"
        : "Saved on this device"
      : "Saved";

  const toggleDone = () => {
    if (!task) return;
    const next = task.status === "done" ? "todo" : "done";
    if (next === "done") hapticDone();
    else hapticUndone();
    setTouched(true);
    tasks.update.mutate({ id: task.id, status: next }, { onError: failed });
  };

  // The day, time, reminder, area or delete, in the sheet.
  const [field, setField] = useState<TaskField | null>(null);
  const afterSheet = useAfterExit();

  // With AI suggestions on, the summary comes as the screen opens (the server
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

  // On top of the task, so going back from the note comes back here.
  const openNote = (noteId: string) => {
    saveWords();
    router.push(`/note/${noteId}`);
  };

  const startFocus = () => {
    if (!task) return;
    saveWords();
    router.push(`/focus/${task.id}`);
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
              <Text style={styles.textButtonText}>Go back</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const done = task.status === "done";
  const timed = Boolean(task.dueTime);
  const noteCount = linked.size;
  const empty = summary.data && summary.data.summary === null;
  const source = task.noteId ? notes.data?.notes.find((note) => note.id === task.noteId) : undefined;
  const leftOff = focus && focus.lastOutcome !== "finished" ? focus.lastLeftOff.trim() : "";
  const focusLine = focus
    ? [
        focusMetaLabel(focus),
        `last ${isSameDay(focus.lastEndedAt, new Date()) ? "today" : `on ${formatPlannedDate(focus.lastEndedAt)}`}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;
  const reminder =
    task.remindBefore != null
      ? reminderLabel(task.remindBefore, timed) + (task.remindRepeat ? ` · ${REPEAT_LABELS[task.remindRepeat]}` : "")
      : null;
  const madeLine = [
    source ? `Found in “${noteLabel(source)}”` : null,
    `Added ${formatPlannedDate(task.createdAt)}`,
    movedFrom ? `moved here from ${formatPlannedDate(movedFrom)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const fieldRow = (
    key: TaskField,
    Icon: typeof CalendarDays,
    label: string,
    value: string,
    set: boolean,
    first = false,
  ) => (
    <Pressable
      key={key}
      onPress={() => setField(key)}
      style={({ pressed }) => [styles.fieldRow, !first && styles.fieldDivider, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Change`}
    >
      <Icon size={19} color={set ? colors.foreground : colors.mutedForeground} />
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={[styles.fieldValue, !set && styles.fieldValueEmpty]} numberOfLines={1}>
        {value}
      </Text>
      <ChevronRight size={17} color={colors.mutedForeground} />
    </Pressable>
  );

  return (
    <View style={[styles.page, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (page === "link" ? setPage("overview") : router.back())}
          hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={page === "link" ? "Back to the task" : "Back"}
        >
          <ChevronLeft size={26} color={colors.foreground} />
        </Pressable>
        <View style={styles.flex}>
          {page === "link" ? (
            <Animated.Text entering={fadeInFast} style={styles.headerTitle}>
              Link a note
            </Animated.Text>
          ) : null}
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
        ) : (
          <Text style={styles.status} numberOfLines={1}>
            {statusLabel}
          </Text>
        )}
      </View>

      {page === "overview" ? (
        <GentleKeyboardAvoidingView style={styles.flex} room={keyboardRoom}>
          <Animated.View key="overview" entering={fadeInFast} style={styles.flex}>
            {/* iOS's own scrolling to the cursor is switched off, as on the
                note page: it threw the page to the top of the details when a
                line wrapped at the end. The page follows the cursor itself. */}
            <ClippingScrollView style={styles.flex}>
            <Animated.ScrollView
              ref={follow.pageRef}
              style={styles.flex}
              contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing[8] }]}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
            >
              {/* The task itself: done or not, its line, its area. */}
              <View style={styles.top}>
                <View style={styles.titleRow}>
                  <Pressable
                    onPress={toggleDone}
                    hitSlop={10}
                    style={({ pressed }) => [styles.ring, done && styles.ringDone, pressed && styles.pressed]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: done }}
                    accessibilityLabel={done ? "Done. Mark not done" : "Mark done"}
                  >
                    {done ? (
                      <Animated.View entering={fadeInFast}>
                        <Check size={Math.round(17 * scale)} color={colors.primaryForeground} strokeWidth={2.8} />
                      </Animated.View>
                    ) : null}
                  </Pressable>
                  <TextInput
                    value={text}
                    // One line of task: a return finishes it rather than breaking it.
                    onChangeText={(value) => {
                      setTouched(true);
                      setText(value.replace(/\n/g, " "));
                    }}
                    onBlur={() => {
                      if (!oneLine(text) && savedWords.current) setText(savedWords.current.text);
                    }}
                    placeholder="What is the task?"
                    placeholderTextColor={colors.mutedForeground}
                    multiline
                    scrollEnabled={false}
                    // A flick that starts on the words scrolls the page.
                    rejectResponderTermination={false}
                    submitBehavior="blurAndSubmit"
                    returnKeyType="done"
                    maxLength={500}
                    style={[styles.titleInput, done && styles.titleDone]}
                    accessibilityLabel="Task"
                  />
                </View>
                <Pressable
                  onPress={() => setField("area")}
                  style={({ pressed }) => [styles.areaChip, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Area: ${task.projectName}. Change area`}
                >
                  <Text style={styles.areaChipText} numberOfLines={1}>
                    {areaTag(task.projectName)}
                  </Text>
                  <ChevronDown size={14} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {/* When it is due, and when it reminds. */}
              <View style={[styles.card, styles.block]}>
                {fieldRow(
                  "date",
                  CalendarDays,
                  "Date",
                  task.completeBy ? dateChipLabel(task.completeBy) : "No date",
                  task.completeBy !== null,
                  true,
                )}
                {fieldRow("time", Clock, "Time", task.dueTime ? dueTimeLabel(task.dueTime) : "Any time", timed)}
                {fieldRow(
                  "reminder",
                  Bell,
                  "Reminder",
                  reminder ?? "None",
                  reminder !== null,
                )}
              </View>

              {/* Anything more about it, in its own words. Its frame sits
                  directly in the page, for the page to follow its cursor. */}
              <Text style={[styles.label, styles.block]}>DETAILS</Text>
              <View style={styles.detailsFrame} onLayout={follow.onTextFrameLayout}>
                <TextInput
                  ref={detailsInputRef}
                  value={details}
                  onChangeText={(value) => {
                    setTouched(true);
                    setDetails(value);
                  }}
                  onFocus={follow.onTextFocus}
                  onBlur={follow.onTextBlur}
                  onPressIn={(event) => follow.onTextPressIn(event.nativeEvent.locationY)}
                  onLayout={follow.onTextLayout}
                  onSelectionChange={(event) => follow.onSelectionEnd(event.nativeEvent.selection.end)}
                  placeholder="Add details"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  scrollEnabled={false}
                  rejectResponderTermination={false}
                  maxLength={5000}
                  textAlignVertical="top"
                  style={styles.detailsInput}
                  accessibilityLabel="Details"
                />
              </View>

              {/* Focus time on it: a start, what it has had, where it was left. */}
              {!done || focus ? (
                <View style={[styles.section, styles.block]}>
                  <Text style={styles.label}>FOCUS</Text>
                  {!done ? (
                    <Pressable
                      style={({ pressed }) => [styles.focusButton, pressed && styles.focusPressed]}
                      onPress={startFocus}
                      accessibilityRole="button"
                      accessibilityLabel="Start focus time. Set aside a few minutes for just this"
                    >
                      {/* Grows with the text size, so it stays in proportion. */}
                      <PomodoroBadge size={Math.round(40 * scale)} />
                      <View style={styles.flexShrink}>
                        <Text style={styles.focusTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                          Start focus time
                        </Text>
                        <Text style={styles.focusHint} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
                          Set aside a few minutes for just this
                        </Text>
                      </View>
                    </Pressable>
                  ) : null}
                  {focusLine ? <Text style={styles.muted}>{focusLine}</Text> : null}
                  {leftOff ? (
                    <View style={styles.leftOffBox}>
                      <Text style={styles.leftOffLabel}>WHERE YOU LEFT OFF</Text>
                      <Text style={styles.leftOffText}>{leftOff}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* How it is going. */}
              <View style={[styles.section, styles.block]}>
                <View style={styles.labelRow}>
                  <Sparkles size={13} color={colors.mutedForeground} />
                  <Text style={styles.label}>HOW IT&apos;S GOING</Text>
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
              <View style={[styles.section, styles.block]}>
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

              {/* Where it came from, quietly, and the way to remove it. */}
              <View style={[styles.footer, styles.block]}>
                <Text style={styles.made}>{madeLine}</Text>
                <Pressable
                  onPress={() => setField("delete")}
                  hitSlop={8}
                  style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Trash2 size={17} color={colors.error} />
                  <Text style={styles.deleteText}>Delete task</Text>
                </Pressable>
              </View>
            </Animated.ScrollView>
            </ClippingScrollView>
          </Animated.View>
        </GentleKeyboardAvoidingView>
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

      <TaskSheet
        task={task}
        field={field}
        onClose={() => setField(null)}
        projects={projects}
        onSave={async (change) => {
          setTouched(true);
          await tasks.update.mutateAsync({ id: task.id, ...change });
        }}
        onDelete={async () => {
          deletedRef.current = true;
          try {
            await tasks.remove.mutateAsync({ id: task.id });
          } catch (err) {
            deletedRef.current = false;
            throw err;
          }
          // Back to the list once the sheet has gone.
          afterSheet.later(() => router.back());
        }}
        onCreateProject={async (name) => (await tasks.createProject.mutateAsync({ name })).project}
        onExited={afterSheet.run}
      />
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    center: { alignItems: "center", justifyContent: "center", gap: spacing[3] },
    flex: { flex: 1 },
    flexShrink: { flexShrink: 1 },
    pressed: { opacity: 0.7 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[2],
      paddingTop: spacing[1],
      paddingBottom: spacing[1],
      minHeight: 52,
    },
    back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    headerTitle: {
      fontFamily: fonts.display,
      fontSize: textSize.title * scale,
      color: colors.foreground,
    },
    status: {
      fontFamily: fonts.base,
      fontSize: textSize.label * scale,
      color: colors.mutedForeground,
      paddingRight: spacing[3],
    },
    textButton: { paddingHorizontal: spacing[2], paddingVertical: spacing[2] },
    textButtonText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.primary },
    body: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
    // Each part of the page after the first, spaced from the one above.
    block: { marginTop: spacing[8] },
    top: { gap: spacing[3] },
    titleRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
    // The ring sits on the first line of the task, whatever the text size.
    ring: {
      width: Math.round(28 * scale),
      height: Math.round(28 * scale),
      borderRadius: Math.round(14 * scale),
      borderWidth: 1.5,
      borderColor: colors.mutedForeground,
      alignItems: "center",
      justifyContent: "center",
      marginTop: Math.round(2 * scale),
    },
    ringDone: { backgroundColor: colors.primary, borderColor: colors.primary },
    titleInput: {
      flex: 1,
      fontFamily: fonts.display,
      fontSize: textSize.title * scale,
      lineHeight: 30 * scale,
      color: colors.foreground,
      padding: 0,
      paddingTop: 0,
      paddingBottom: 0,
      margin: 0,
    },
    titleDone: { color: colors.mutedForeground },
    areaChip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 4,
      maxWidth: "100%",
      marginLeft: Math.round(28 * scale) + spacing[3],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingLeft: spacing[3],
      paddingRight: spacing[2],
      paddingVertical: 5,
    },
    areaChipText: { flexShrink: 1, fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.foreground },
    // The day, time and reminder: one card of rows, each opening its choices.
    card: {
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
      paddingHorizontal: spacing[4],
    },
    fieldRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minHeight: 52 },
    fieldDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    fieldLabel: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    fieldValue: {
      flex: 1,
      textAlign: "right",
      fontFamily: fonts.baseSemi,
      fontSize: textSize.body * scale,
      color: colors.foreground,
    },
    fieldValueEmpty: { fontFamily: fonts.base, color: colors.mutedForeground },
    section: { gap: spacing[3] },
    labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    label: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1.2,
      color: colors.mutedForeground,
    },
    detailsFrame: { marginTop: spacing[3] },
    // Plain text, no box: the task's own words above it.
    detailsInput: {
      minHeight: DETAILS_LINE_HEIGHT * scale,
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      lineHeight: DETAILS_LINE_HEIGHT * scale,
      color: colors.foreground,
      padding: 0,
      paddingTop: 0,
      paddingBottom: 0,
      margin: 0,
    },
    focusButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderRadius: 19,
      backgroundColor: colors.primary,
      paddingVertical: 16,
      paddingLeft: 16,
      paddingRight: 20,
    },
    focusPressed: { transform: [{ scale: 0.98 }] },
    focusTitle: {
      fontFamily: fonts.baseBold,
      fontSize: textSize.large * scale,
      lineHeight: 23 * scale,
      color: colors.primaryForeground,
    },
    focusHint: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 19 * scale,
      marginTop: 2,
      color: colors.primaryForeground,
      opacity: 0.85,
    },
    leftOffBox: {
      borderRadius: 10,
      backgroundColor: colors.surface,
      padding: spacing[3],
      gap: 4,
    },
    leftOffLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1,
      color: colors.mutedForeground,
    },
    leftOffText: {
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      lineHeight: 22 * scale,
      color: colors.foreground,
    },
    updating: {
      fontFamily: fonts.base,
      fontSize: textSize.label * scale,
      color: colors.mutedForeground,
      marginLeft: 4,
    },
    summary: {
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      lineHeight: 24 * scale,
      color: colors.foreground,
    },
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
    stepText: {
      flex: 1,
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 20 * scale,
      color: colors.foreground,
    },
    linkButton: { flexDirection: "row", alignItems: "center", gap: 4 },
    link: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
    muted: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 20 * scale,
      color: colors.mutedForeground,
    },
    spinner: { paddingVertical: spacing[4] },
    noteRow: {
      gap: 3,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    noteTitle: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.body * scale,
      lineHeight: 22 * scale,
      color: colors.foreground,
    },
    noteMeta: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    notePreview: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 20 * scale,
      color: colors.mutedForeground,
    },
    footer: { gap: spacing[4], alignItems: "flex-start" },
    made: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      lineHeight: 20 * scale,
      color: colors.mutedForeground,
    },
    deleteButton: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    deleteText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.error },
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
    more: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.mutedForeground,
      paddingVertical: spacing[3],
    },
  });
}
