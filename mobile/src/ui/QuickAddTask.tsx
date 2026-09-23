import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { ArrowUp, CalendarDays, Hash, Plus, Sparkles } from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePresence } from "../hooks/usePresence";
import { useTaskLineParse } from "../hooks/useTaskLineParse";
import { atNoon, dateChipLabel, fromIsoDay, isSameDay } from "../lib/dates";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../theme";
import type { ProjectRecord } from "../types";
import { Button } from "./Button";
import { Input } from "./Input";
import { Collapse } from "./Collapse";

export type QuickAddDraft = {
  text: string;
  projectId: string;
  completeBy: Date | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  projects: ProjectRecord[];
  defaultProjectId?: string | null;
  /**
   * A date the box opens with, e.g. today when adding from the Today screen.
   * A date typed into the line still wins over it.
   */
  defaultDate?: Date | null;
  placeholder?: string;
  onCreateProject: (name: string) => Promise<ProjectRecord>;
  /** Creates the task. The parent closes the box once this resolves. */
  onSubmit: (draft: QuickAddDraft) => Promise<void>;
};

/** Which row is unfolded under the text, if any. Never more than one. */
type Expander = "project" | "newProject" | "date" | null;
/**
 * Who set the date. The model's reading follows the text until the writer
 * chooses for themselves, after which it is left alone.
 */
type DateSource = "none" | "default" | "ai" | "manual";

function addDays(days: number): Date {
  const now = new Date();
  return atNoon(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

/**
 * One box above the keyboard: the task, a project chip, a date chip, send.
 * A due date typed into the line is read out by the model and lands in the
 * date chip on its own. Everything unfolds inside this one box — there is no
 * second dialog, because a Modal presented over a Modal is how a screen ends
 * up drawn right but deaf to touch.
 */
export function QuickAddTask({
  open,
  onClose,
  projects,
  defaultProjectId,
  defaultDate = null,
  placeholder = "e.g., Call Dr. Lee tomorrow",
  onCreateProject,
  onSubmit,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [dateSource, setDateSource] = useState<DateSource>("none");
  const [expander, setExpander] = useState<Expander>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { parsed, pending, settle } = useTaskLineParse(text, { enabled: open });

  // Reset on open only. Reading the defaults through a ref keeps a project
  // created mid-session from wiping the line the writer is typing.
  const defaultsRef = useRef({ defaultProjectId, projects, defaultDate });
  defaultsRef.current = { defaultProjectId, projects, defaultDate };
  useEffect(() => {
    if (!open) return;
    const defaults = defaultsRef.current;
    setText("");
    setProjectId(defaults.defaultProjectId ?? defaults.projects[0]?.id ?? null);
    setDate(defaults.defaultDate);
    setDateSource(defaults.defaultDate ? "default" : "none");
    setExpander(null);
    setPickerOpen(false);
    setNewProject("");
    setError("");
  }, [open]);

  // Let the model's reading drive the date chip until the writer takes over.
  // A pending parse (parsed === null) leaves the chip alone, so the date does
  // not blink off and on between keystrokes.
  useEffect(() => {
    if (dateSource === "manual" || parsed === null) return;
    if (parsed.completeBy) {
      const found = fromIsoDay(parsed.completeBy);
      if (found && !isSameDay(found, date)) {
        setDate(found);
        setDateSource("ai");
      } else if (found && dateSource !== "ai") {
        setDateSource("ai");
      }
      return;
    }
    if (dateSource === "ai") {
      // The date words were deleted: fall back to what the box opened with.
      const fallback = defaultsRef.current.defaultDate;
      setDate(fallback);
      setDateSource(fallback ? "default" : "none");
    }
  }, [parsed, dateSource, date]);

  const projectName = projects.find((project) => project.id === projectId)?.name ?? "Project";
  const canSend = text.trim().length > 0 && Boolean(projectId) && !submitting;

  const submit = async () => {
    if (!canSend || !projectId) return;
    const raw = text.trim().replace(/\s+/g, " ");
    setSubmitting(true);
    setError("");
    try {
      let finalText = raw;
      let completeBy = date;
      if (dateSource !== "manual") {
        // Use the model's reading of the final text, not of whatever it last
        // saw while typing. Bounded, so a slow model cannot stall the add.
        const line = await settle(raw);
        const found = line.completeBy ? fromIsoDay(line.completeBy) : null;
        completeBy = found ?? defaultsRef.current.defaultDate;
        if (found && line.text.trim()) finalText = line.text.trim();
      }
      Keyboard.dismiss();
      await onSubmit({ text: finalText, projectId, completeBy });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That task could not be added. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (next: Exclude<Expander, null>) => {
    setExpander((current) => (current === next ? null : next));
    setPickerOpen(false);
  };

  const chooseDate = (value: Date | null) => {
    setDate(value);
    setDateSource("manual");
    setExpander(null);
    setPickerOpen(false);
  };

  const openPicker = () => {
    // The inline calendar needs the room the keyboard is using.
    Keyboard.dismiss();
    setPickerOpen(true);
  };

  const onPicked = (event: DateTimePickerEvent, picked?: Date) => {
    if (event.type === "dismissed") {
      setPickerOpen(false);
      return;
    }
    if (picked) chooseDate(atNoon(picked.getFullYear(), picked.getMonth(), picked.getDate()));
    setPickerOpen(false);
  };

  const createProject = async () => {
    const name = newProject.trim().replace(/\s+/g, " ");
    if (!name) return;
    setCreating(true);
    setError("");
    try {
      const project = await onCreateProject(name);
      setProjectId(project.id);
      setNewProject("");
      setExpander(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be added.");
    } finally {
      setCreating(false);
    }
  };

  // Mounted while open and while sliding away; see usePresence for why a
  // closed Modal must not stay in the tree.
  const { mounted, progress } = usePresence(open);
  const boxHeight = useSharedValue(400);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const boxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * boxHeight.value }],
  }));
  // Drop the keyboard as the box leaves, not a beat after it has gone.
  useEffect(() => {
    if (!open) Keyboard.dismiss();
  }, [open]);

  if (!mounted) return null;

  const shortcuts: Array<{ label: string; value: Date | null }> = [
    { label: "No date", value: null },
    { label: "Today", value: addDays(0) },
    { label: "Tomorrow", value: addDays(1) },
    { label: "Next week", value: addDays(7) },
  ];

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={styles.fill} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={boxStyle}
          onLayout={(event) => {
            boxHeight.value = event.nativeEvent.layout.height;
          }}
        >
        {/* No layout animation here: the rows below grow and shrink their own
            height, and the box simply follows them. */}
        <View style={[styles.box, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            autoFocus
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            style={styles.input}
            maxLength={500}
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Task"
          />

          <Collapse open={expander === "project"}>
            <View style={[styles.chips, styles.unfold]}>
              {projects.map((project) => {
                const active = project.id === projectId;
                return (
                  <Pressable
                    key={project.id}
                    onPress={() => {
                      setProjectId(project.id);
                      setExpander(null);
                    }}
                    style={[styles.chip, active && styles.chipSet]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextSet]}>
                      {project.name}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setExpander("newProject")}
                accessibilityLabel="Add a project"
                style={[styles.chip, styles.chipDashed]}
              >
                <Plus size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>
          </Collapse>

          <Collapse open={expander === "newProject"}>
            <View style={[styles.row, styles.unfold]}>
              <Input
                style={styles.flex}
                value={newProject}
                onChangeText={setNewProject}
                placeholder="New project name"
                autoFocus
                maxLength={100}
                returnKeyType="done"
                onSubmitEditing={() => void createProject()}
              />
              <Button
                size="sm"
                loading={creating}
                disabled={!newProject.trim()}
                onPress={() => void createProject()}
              >
                Add
              </Button>
            </View>
          </Collapse>

          <Collapse open={expander === "date"}>
            <View style={[styles.chips, styles.unfold]}>
              {shortcuts.map((option) => {
                const active =
                  option.value === null ? date === null : isSameDay(option.value, date);
                return (
                  <Pressable
                    key={option.label}
                    onPress={() => chooseDate(option.value)}
                    style={[styles.chip, active && styles.chipSet]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextSet]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable onPress={openPicker} style={styles.chip} accessibilityLabel="Pick a date">
                <CalendarDays size={14} color={colors.mutedForeground} />
                <Text style={styles.chipText}>Pick…</Text>
              </Pressable>
            </View>
          </Collapse>

          {/* iOS draws the calendar inline, so it unfolds like the rows above.
              Android's picker is a dialog of its own and must mount and unmount
              exactly with its state. */}
          {Platform.OS === "ios" ? (
            <Collapse open={pickerOpen}>
              <View style={styles.unfold}>
                <DateTimePicker
                  value={date ?? new Date()}
                  mode="date"
                  display="inline"
                  accentColor={colors.primary}
                  themeVariant={dark ? "dark" : "light"}
                  onChange={onPicked}
                />
              </View>
            </Collapse>
          ) : pickerOpen ? (
            <DateTimePicker
              value={date ?? new Date()}
              mode="date"
              display="default"
              onChange={onPicked}
            />
          ) : null}

          <View style={styles.toolbar}>
            <Pressable
              onPress={() => toggle("project")}
              style={[styles.chip, expander === "project" && styles.chipOpen]}
              accessibilityLabel={`Project: ${projectName}. Change project`}
            >
              <Hash size={14} color={colors.mutedForeground} />
              <Text style={styles.chipText} numberOfLines={1}>
                {projectName}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => toggle("date")}
              style={[styles.chip, date && styles.chipSet, expander === "date" && styles.chipOpen]}
              accessibilityLabel={date ? `Due ${dateChipLabel(date)}. Change date` : "Set a due date"}
            >
              {dateSource === "ai" ? (
                <Sparkles size={14} color={colors.accentForeground} />
              ) : (
                <CalendarDays size={14} color={date ? colors.accentForeground : colors.mutedForeground} />
              )}
              <Text style={[styles.chipText, date && styles.chipTextSet]}>
                {date ? dateChipLabel(date) : "Date"}
              </Text>
            </Pressable>
            {pending ? <ActivityIndicator size="small" color={colors.mutedForeground} /> : null}
            <View style={styles.flex} />
            <Pressable
              onPress={() => void submit()}
              disabled={!canSend}
              style={[styles.send, !canSend && styles.sendDisabled]}
              accessibilityLabel="Add task"
            >
              {submitting ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <ArrowUp size={20} color={colors.primaryForeground} strokeWidth={2.5} />
              )}
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    flex: { flex: 1, justifyContent: "flex-end" },
    backdrop: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(30, 28, 25, 0.4)",
    },
    fill: { flex: 1 },
    box: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[4],
      paddingTop: spacing[4],
    },
    // Each unfolding row carries its own space above it, so it takes none
    // at all when folded away.
    unfold: { paddingTop: spacing[3] },
    input: {
      fontFamily: fonts.base,
      fontSize: 18 * scale,
      color: colors.foreground,
      paddingVertical: spacing[2],
      minHeight: 44,
    },
    row: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    toolbar: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginTop: spacing[3] },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[1],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
      maxWidth: 180,
    },
    chipSet: { backgroundColor: colors.accent, borderColor: colors.primary },
    chipOpen: { borderColor: colors.primary },
    chipDashed: { borderStyle: "dashed" },
    chipText: {
      fontFamily: fonts.baseSemi,
      fontSize: 14 * scale,
      color: colors.foreground,
    },
    chipTextSet: { color: colors.accentForeground },
    send: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    sendDisabled: { opacity: 0.4 },
    error: {
      marginTop: spacing[2],
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.error,
    },
  });
}
