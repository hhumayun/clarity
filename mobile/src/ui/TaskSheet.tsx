import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { CalendarDays, Check, ChevronLeft, Plus } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { fadeInFast } from "./motion";
import { atNoon, dateChipLabel, daysFromToday, dueDayOptions, formatClockTime, isSameDay } from "../lib/dates";
import { ensureNotificationPermission } from "../lib/notifications";
import {
  DAY_MINUTES,
  MAX_REMIND_BEFORE,
  reminderChoices,
  reminderLabel,
  reminderUnits,
  REMINDER_REPEATS,
  REPEAT_LABELS,
  splitBefore,
  timeOf,
  timeToday,
  UNIT_MINUTES,
  upcomingReminder,
  type ReminderUnit,
} from "../lib/reminderRules";
import { areaTag } from "../lib/lifeCenter";
import { useToast } from "../providers/ToastProvider";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, textSize } from "../theme";
import type { ProjectRecord, ReminderRepeat, TaskRecord } from "../types";
import { Button } from "./Button";
import { Input } from "./Input";
import { Sheet } from "./Sheet";

/** The part of a task the sheet changes; each has its own page of choices. */
export type TaskField = "date" | "time" | "reminder" | "area" | "delete";

/** What a choice changes: only the fields it touched. */
export type TaskFieldChange = {
  projectId?: string;
  completeBy?: Date | null;
  /** Its time on its day, "HH:MM"; null for any time that day. */
  dueTime?: string | null;
  /** Minutes before its time (or 9:00 on its day) to remind; null for none. */
  remindBefore?: number | null;
  remindRepeat?: ReminderRepeat | null;
};

type Props = {
  task: TaskRecord | null;
  /** The field being changed; null when the sheet is closed. */
  field: TaskField | null;
  onClose: () => void;
  projects: ProjectRecord[];
  /** Saves a choice; the sheet closes once it is in. */
  onSave: (change: TaskFieldChange) => Promise<void>;
  onDelete: () => Promise<void>;
  onCreateProject: (name: string) => Promise<ProjectRecord>;
  /** Once the sheet has fully gone; anything that presents next waits for it. */
  onExited?: () => void;
};

/** A day in a sentence: "today", "tomorrow", or "Fri 2 Oct". */
function dayWords(date: Date): string {
  const label = dateChipLabel(date);
  return label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label;
}

/** Whether two due days are the same day (or both none). */
function sameDue(a: Date | null, b: Date | null): boolean {
  return a === null || b === null ? a === b : isSameDay(a, b);
}

/**
 * Which face of the sheet is showing. Deliberately one sheet with faces
 * rather than sheets opened on top of each other: on iOS a second Modal
 * presented over a first is fragile, and the failure mode is a screen that
 * still looks right but answers no touches.
 */
type Panel = "date" | "time" | "reminder" | "chooseProject" | "project" | "confirmDelete";

const PANEL_FOR: Record<TaskField, Panel> = {
  date: "date",
  time: "time",
  reminder: "reminder",
  area: "chooseProject",
  delete: "confirmDelete",
};

/** A task's day, time and reminder, as the pages work on them. */
type Schedule = {
  completeBy: Date | null;
  dueTime: string | null;
  remindBefore: number | null;
  remindRepeat: ReminderRepeat | null;
};

function scheduleOf(task: TaskRecord | null): Schedule {
  return {
    completeBy: task?.completeBy ?? null,
    dueTime: task?.completeBy ? (task.dueTime ?? null) : null,
    remindBefore: task?.remindBefore ?? null,
    remindRepeat: task?.remindRepeat ?? null,
  };
}

/**
 * One of a task's fields, changed on a page of its own: its day, its time,
 * its reminder (and how it repeats), its area, or deleting it. A choice is
 * saved as it is made and the sheet goes, back to the task's screen.
 *
 * A reminder needs a day: asked for one with none, the reminder page sends
 * the writer to the day's choices first, and the day goes in with the
 * reminder.
 */
export function TaskSheet({ task, field, onClose, projects, onSave, onDelete, onCreateProject, onExited }: Props) {
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const toast = useToast();
  const open = field !== null && task !== null;
  // The page the sheet opened on; "back" from any other returns to it.
  const [home, setHome] = useState<Panel>("date");
  const [panel, setPanel] = useState<Panel>("date");
  const [schedule, setSchedule] = useState<Schedule>(() => scheduleOf(task));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newProject, setNewProject] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Android's calendar is a dialog of its own, opened from the date page.
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  // The time page's clock, kept apart until "Set time".
  const [timeValue, setTimeValue] = useState(() => new Date());
  // Android's clock is a dialog of its own, like its calendar.
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  // The reminder page's choices, kept apart until "Set reminder".
  const [reminderChoice, setReminderChoice] = useState<number | "custom">(DAY_MINUTES);
  const [customAmount, setCustomAmount] = useState("1");
  const [customUnit, setCustomUnit] = useState<ReminderUnit>("hours");
  const [reminderRepeat, setReminderRepeat] = useState<ReminderRepeat | null>(null);

  // A new time starts at the next whole hour today, or 9:00 on a later day.
  const prepareTime = (current: Schedule) => {
    const now = new Date();
    const later =
      current.completeBy !== null && !isSameDay(current.completeBy, now) && current.completeBy.getTime() > now.getTime();
    setTimeValue(
      current.dueTime
        ? timeToday(current.dueTime, now)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate(), later ? 9 : Math.min(now.getHours() + 1, 23), 0),
    );
    setTimePickerOpen(false);
  };

  // The reminder page opens on what is set, or on the usual choice.
  const prepareReminder = (current: Schedule) => {
    const timed = Boolean(current.dueTime);
    const before = current.remindBefore;
    if (before != null && reminderChoices(timed).includes(before)) {
      setReminderChoice(before);
    } else if (before != null) {
      const { amount, unit } = splitBefore(before, timed);
      setReminderChoice("custom");
      setCustomAmount(String(amount));
      setCustomUnit(unit);
    } else {
      setReminderChoice(timed ? 15 : DAY_MINUTES);
    }
    if (before == null || reminderChoices(timed).includes(before)) {
      setCustomAmount(timed ? "1" : "2");
      setCustomUnit(timed ? "hours" : "days");
    }
    setReminderRepeat(current.remindRepeat ?? null);
  };

  useEffect(() => {
    if (!field || !task) return;
    const current = scheduleOf(task);
    setSchedule(current);
    setError("");
    setNewProject("");
    setDatePickerOpen(false);
    if (field === "time") prepareTime(current);
    if (field === "reminder") prepareReminder(current);
    setHome(PANEL_FOR[field]);
    setPanel(PANEL_FOR[field]);
    // Set up once per opening: later edits to the task must not reset the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, task?.id]);

  const save = async (change: TaskFieldChange) => {
    if (saving) return false;
    setSaving(true);
    setError("");
    try {
      await onSave(change);
      onClose();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "That change could not be saved. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addProject = async () => {
    const name = newProject.trim().replace(/\s+/g, " ");
    if (!name) return;
    setCreatingProject(true);
    try {
      const project = await onCreateProject(name);
      await save({ projectId: project.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That area could not be added.");
    } finally {
      setCreatingProject(false);
    }
  };

  // A day chosen on the date page is saved at once, unless it was asked for
  // on the way to a reminder: then it waits to go in with the reminder.
  const chooseDate = (date: Date | null) => {
    if (home === "reminder") {
      setSchedule((current) => ({ ...current, completeBy: date, dueTime: date ? current.dueTime : null }));
      setPanel("reminder");
      return;
    }
    // A time goes with a day: no day, no time.
    void save(date ? { completeBy: date } : { completeBy: null, dueTime: null });
  };

  const handlePicked = (event: DateTimePickerEvent, date?: Date) => {
    setDatePickerOpen(false);
    if (event.type === "dismissed" || !date) return;
    // Midday, matching the quick options, so a stored day cannot slide
    // backwards across a timezone.
    chooseDate(atNoon(date.getFullYear(), date.getMonth(), date.getDate()));
  };

  const setTime = () => {
    const dueTime = timeOf(timeValue);
    if (schedule.completeBy) {
      void save({ dueTime });
      return;
    }
    // A time with no day: today while it is still to come, else tomorrow.
    const now = new Date();
    const todayAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), timeValue.getHours(), timeValue.getMinutes());
    void save({ completeBy: daysFromToday(todayAt.getTime() > now.getTime() ? 0 : 1, now), dueTime });
  };

  // A reminder counted in minutes from the time becomes whole days before 9:00.
  const clearTime = () => {
    void save({
      dueTime: null,
      remindBefore:
        schedule.remindBefore == null ? null : Math.floor(schedule.remindBefore / DAY_MINUTES) * DAY_MINUTES,
    });
  };

  const handleTimePicked = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS !== "ios") setTimePickerOpen(false);
    if (event.type === "dismissed" || !date) return;
    setTimeValue(date);
  };

  // Reminders count back from the task's time, or from 9:00 on its day.
  const timed = Boolean(schedule.dueTime);
  // The reminder the page describes, in minutes before the task, and when it
  // would next go off.
  const customValue = Number.parseInt(customAmount, 10);
  const chosenBefore =
    reminderChoice !== "custom"
      ? reminderChoice
      : Number.isFinite(customValue) && customValue >= 0
        ? Math.min(customValue * UNIT_MINUTES[customUnit], MAX_REMIND_BEFORE)
        : null;
  const nextReminder =
    chosenBefore !== null && schedule.completeBy
      ? upcomingReminder({
          id: task?.id ?? "new",
          status: "todo",
          completeBy: schedule.completeBy,
          dueTime: schedule.dueTime,
          remindBefore: chosenBefore,
          remindRepeat: reminderRepeat,
        })
      : null;

  const setReminder = async () => {
    if (chosenBefore === null || !task) return;
    const change: TaskFieldChange = { remindBefore: chosenBefore, remindRepeat: reminderRepeat };
    // A day chosen on the way here goes in with the reminder.
    if (!sameDue(task.completeBy, schedule.completeBy)) change.completeBy = schedule.completeBy;
    if (!(await save(change))) return;
    // Asked here, the first time it matters; saved either way.
    if (!(await ensureNotificationPermission())) {
      toast.show("Notifications are off, so this reminder will not sound. You can turn them on in Settings.");
    }
  };

  const clearReminder = () => void save({ remindBefore: null, remindRepeat: null });

  const titles: Record<Panel, { title: string; description?: string }> = {
    date: { title: "Due date" },
    time: { title: "Time" },
    reminder: { title: "Reminder" },
    chooseProject: { title: "Area" },
    project: {
      title: "New area",
      description: "A short name is easiest to recognise later.",
    },
    confirmDelete: {
      title: "Delete this task?",
      description: "It will stay hidden even if you refresh tasks from the note it came from.",
    },
  };

  return (
    <Sheet
      open={open}
      title={titles[panel].title}
      description={titles[panel].description}
      // The ×, a drag down or a tap outside closes the sheet. Android's back
      // button steps back a page: to the areas from a new one, and to the
      // reminder from the day it needed.
      onClose={onClose}
      onBack={panel === home ? onClose : () => setPanel(panel === "project" ? "chooseProject" : home)}
      onExited={onExited}
    >
      {/* Each face fades in as it replaces the last, while the sheet's
          height glides between them. */}
      <Animated.View key={panel} entering={fadeInFast} style={styles.face}>
        {panel === "chooseProject" ? (
          <View>
            {projects.map((project, index) => {
              const active = task?.projectId === project.id;
              return (
                <Pressable
                  key={project.id}
                  onPress={() => void save({ projectId: project.id })}
                  disabled={saving}
                  style={({ pressed }) => [styles.optionRow, index > 0 && styles.divider, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={project.name}
                >
                  <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
                    {areaTag(project.name)}
                  </Text>
                  {active ? <Check size={20} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => {
                setNewProject("");
                setPanel("project");
              }}
              style={({ pressed }) => [styles.optionRow, projects.length > 0 && styles.divider, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Add a new area"
            >
              <Plus size={20} color={colors.mutedForeground} />
              <Text style={[styles.optionText, styles.optionTextMuted]}>New area</Text>
            </Pressable>
          </View>
        ) : panel === "project" ? (
          <>
            <Input
              value={newProject}
              onChangeText={setNewProject}
              placeholder="For example, Health"
              autoFocus
              maxLength={100}
              returnKeyType="done"
              onSubmitEditing={() => void addProject()}
            />
            <Button
              size="lg"
              loading={creatingProject || saving}
              disabled={!newProject.trim()}
              onPress={() => void addProject()}
            >
              Add area
            </Button>
            <Button variant="ghost" onPress={() => setPanel("chooseProject")}>
              <ChevronLeft size={18} color={colors.foreground} />
              <Text style={styles.backText}>Back</Text>
            </Button>
          </>
        ) : panel === "time" ? (
          <>
            {/* iOS shows the clock in the page; Android's is a dialog of its
                own, opened from the time. */}
            {Platform.OS === "ios" ? (
              <View style={styles.timePicker}>
                <DateTimePicker
                  value={timeValue}
                  mode="time"
                  display="spinner"
                  minuteInterval={5}
                  themeVariant={dark ? "dark" : "light"}
                  textColor={colors.foreground}
                  onChange={handleTimePicked}
                />
              </View>
            ) : (
              <>
                <Pressable
                  onPress={() => setTimePickerOpen(true)}
                  style={({ pressed }) => [styles.timeChip, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Time: ${formatClockTime(timeValue)}. Change time`}
                >
                  <Text style={styles.timeChipText}>{formatClockTime(timeValue)}</Text>
                </Pressable>
                {timePickerOpen ? (
                  <DateTimePicker value={timeValue} mode="time" display="default" onChange={handleTimePicked} />
                ) : null}
              </>
            )}
            {schedule.completeBy ? null : (
              <Text style={styles.reminderWhen}>It has no day yet, so it goes on today, or tomorrow once that time has passed.</Text>
            )}
            <Button size="lg" loading={saving} onPress={setTime}>
              Set time
            </Button>
            {schedule.dueTime ? (
              <Button variant="ghost" onPress={clearTime} disabled={saving}>
                No time
              </Button>
            ) : null}
          </>
        ) : panel === "reminder" ? (
          schedule.completeBy ? (
            <>
              {/* How long before: the usual choices, or any amount. */}
              <View style={styles.chips}>
                {reminderChoices(timed).map((before) => {
                  const active = reminderChoice === before;
                  return (
                    <Pressable
                      key={before}
                      onPress={() => setReminderChoice(before)}
                      style={[styles.chip, active && styles.chipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {reminderLabel(before, timed, true)}
                        {timed ? "" : " (9:00 am)"}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setReminderChoice("custom")}
                  style={[styles.chip, reminderChoice === "custom" && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reminderChoice === "custom" }}
                >
                  <Text style={[styles.chipText, reminderChoice === "custom" && styles.chipTextActive]}>Custom</Text>
                </Pressable>
              </View>
              {reminderChoice === "custom" ? (
                <View style={styles.customRow}>
                  <TextInput
                    value={customAmount}
                    onChangeText={(text) => setCustomAmount(text.replace(/[^0-9]/g, "").slice(0, 3))}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    style={styles.amountInput}
                    accessibilityLabel="How many"
                  />
                  {reminderUnits(timed).map((unit) => {
                    const active = customUnit === unit;
                    return (
                      <Pressable
                        key={unit}
                        onPress={() => setCustomUnit(unit)}
                        style={[styles.chip, active && styles.chipActive]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{unit}</Text>
                      </Pressable>
                    );
                  })}
                  <Text style={styles.customBefore}>before</Text>
                </View>
              ) : null}

              <Text style={styles.sectionLabel}>REPEATS</Text>
              <View style={styles.chips}>
                {([null, ...REMINDER_REPEATS] as const).map((repeat) => {
                  const active = reminderRepeat === repeat;
                  return (
                    <Pressable
                      key={repeat ?? "never"}
                      onPress={() => setReminderRepeat(repeat)}
                      style={[styles.chip, active && styles.chipActive]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        {repeat ? REPEAT_LABELS[repeat] : "Never"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* When it would go off, in words, as the choices change. */}
              <Text style={styles.reminderWhen}>
                {chosenBefore === null
                  ? "How long before?"
                  : nextReminder
                    ? `Reminds you ${dayWords(nextReminder)} at ${formatClockTime(nextReminder)}.`
                    : "That time has already passed, so it will not go off."}
              </Text>
              <Button size="lg" loading={saving} disabled={chosenBefore === null} onPress={() => void setReminder()}>
                Set reminder
              </Button>
              {schedule.remindBefore != null ? (
                <Button variant="ghost" onPress={clearReminder} disabled={saving}>
                  No reminder
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.reminderWhen}>A reminder counts back from the task&apos;s day, so it needs one first.</Text>
              <Button size="lg" onPress={() => setPanel("date")}>
                Choose a day
              </Button>
            </>
          )
        ) : panel === "confirmDelete" ? (
          <>
            <Button
              variant="destructive"
              size="lg"
              loading={deleting}
              onPress={() => {
                if (deleting) return;
                setDeleting(true);
                setError("");
                onDelete()
                  .then(() => onClose())
                  .catch(() => setError("That task could not be deleted. Please try again."))
                  .finally(() => setDeleting(false));
              }}
            >
              Delete
            </Button>
            <Button variant="ghost" onPress={onClose} disabled={deleting}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <View style={styles.chips}>
              {dueDayOptions().map((option) => {
                const active =
                  option.value === null
                    ? schedule.completeBy === null
                    : isSameDay(option.value, schedule.completeBy);
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => chooseDate(option.value)}
                    disabled={saving}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              {Platform.OS === "ios" ? null : (
                <Pressable
                  onPress={() => setDatePickerOpen(true)}
                  style={[styles.chip, styles.chipWithIcon]}
                  accessibilityLabel="Pick a date"
                >
                  <CalendarDays size={14} color={colors.mutedForeground} />
                  <Text style={styles.chipText}>Pick a date</Text>
                </Pressable>
              )}
            </View>
            {/* iOS shows the calendar in the page: tapping a day chooses it.
                Android's is a dialog of its own, opened from the chip. */}
            {Platform.OS === "ios" || datePickerOpen ? (
              <View style={styles.picker}>
                <DateTimePicker
                  value={schedule.completeBy ?? new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "inline" : "default"}
                  accentColor={colors.primary}
                  themeVariant={dark ? "dark" : "light"}
                  onChange={handlePicked}
                />
              </View>
            ) : null}
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Animated.View>
    </Sheet>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    face: { gap: spacing[4] },
    pressed: { opacity: 0.7 },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    chip: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.primary },
    chipText: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.mutedForeground,
    },
    chipTextActive: { color: colors.accentForeground, fontFamily: fonts.baseSemi },
    chipWithIcon: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
    optionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      minHeight: 52,
    },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    optionText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    optionTextActive: { fontFamily: fonts.baseSemi },
    optionTextMuted: { color: colors.mutedForeground },
    // The inline calendar draws its own padding; this just keeps it off the
    // sheet's edges on narrow screens.
    picker: { marginHorizontal: -spacing[2] },
    reminderWhen: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.mutedForeground },
    sectionLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.label * scale,
      letterSpacing: 1.2,
      color: colors.mutedForeground,
      marginBottom: -spacing[2],
    },
    customRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2] },
    amountInput: {
      minWidth: 56,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      fontFamily: fonts.baseSemi,
      fontSize: textSize.body * scale,
      color: colors.foreground,
      textAlign: "center",
    },
    customBefore: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
    timePicker: { alignItems: "center" },
    timeChip: {
      alignSelf: "flex-start",
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingLeft: spacing[3],
      paddingRight: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    timeChipText: { fontFamily: fonts.display, fontSize: textSize.title * scale, color: colors.foreground },
    backText: {
      fontFamily: fonts.baseSemi,
      fontSize: textSize.body * scale,
      color: colors.foreground,
    },
    error: {
      fontFamily: fonts.base,
      fontSize: textSize.small * scale,
      color: colors.error,
    },
  });
}
