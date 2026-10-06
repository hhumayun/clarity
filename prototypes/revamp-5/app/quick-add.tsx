import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, { withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dayChoices, today, type Day } from "../src/lib/dates";
import { parseTask } from "../src/lib/parseTask";
import { whenLabel } from "../src/store/selectors";
import { useSage, useSageStatus } from "../src/data/sage";
import { arrive, duration, easeOut, reducedAtLaunch, spring } from "../src/theme/motion";
import { useTheme } from "../src/theme/ThemeProvider";
import { edge, radius, space } from "../src/theme/tokens";
import { useAcknowledge } from "../src/ui/Acknowledgement";
import { Button, type ButtonState } from "../src/ui/Button";
import { CompactTime, InlineCalendar } from "../src/ui/Calendar";
import { Chip } from "../src/ui/Chip";
import { done as doneHaptic, tap, tick } from "../src/ui/haptics";
import { Icon } from "../src/ui/Icon";
import { Txt, useType } from "../src/ui/Txt";

/**
 * A small card over the page, after Rosebud's "Add goal": one line to type
 * on, the area and the day as chips under it, and a full-width Add that
 * stays the accent's pale tint until there's something to add. Words like
 * "tomorrow at 3pm" are read as you type and shown on the day chip (with a
 * sparkle), then taken out of the title. Add answers with a check, and the
 * card goes. ?day=yyyy-mm-dd | none, ?area=Name, ?note=id (links the new
 * task to that note).
 */
export default function QuickAdd() {
  const params = useLocalSearchParams<{ day?: string; area?: string; note?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, accent } = useTheme();
  const body = useType("body");
  const small = useType("footnote");
  const acknowledge = useAcknowledge();
  const areas = useSage((state) => state.areas);
  const tasks = useSage((state) => state.tasks);
  const notes = useSage((state) => state.notes);
  const addTask = useSage((state) => state.addTask);
  const addArea = useSage((state) => state.addArea);
  const viewDay = useSage((state) => state.viewDay);

  const defaultDay: Day | null = params.day && params.day !== "none" ? params.day : null;
  const defaultArea = useMemo(() => {
    if (params.area && areas.some((area) => area.name === params.area)) return params.area;
    if (params.note) {
      const fromNote = notes.find((note) => note.id === params.note)?.area;
      const tally = new Map<string, number>();
      for (const task of tasks) if (task.noteIds.includes(params.note)) tally.set(task.area, (tally.get(task.area) ?? 0) + 1);
      const common = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (common ?? fromNote) return (common ?? fromNote) as string;
    }
    return areas[0]?.name ?? null;
  }, [params.area, params.note, areas, notes, tasks]);

  const [text, setText] = useState("");
  const [area, setArea] = useState<string | null>(defaultArea);
  // Your account's areas can arrive just after this opens: take up the default once it's known.
  useEffect(() => {
    if (area === null && defaultArea) setArea(defaultArea);
  }, [area, defaultArea]);
  const [panel, setPanel] = useState<"none" | "areas" | "date">("none");
  // A day picked by hand wins over the words; a typed time still applies.
  const [manual, setManual] = useState<{ day: Day | null; time: number | null } | null>(null);
  const [newArea, setNewArea] = useState<string | null>(null);
  // An account's first task needs its first area: with none yet, the field to
  // name one is already showing, without taking the keyboard from the task.
  const { ready: loaded } = useSageStatus();
  const firstArea = loaded && areas.length === 0;
  useEffect(() => {
    if (firstArea && area === null && newArea === null) {
      setPanel("areas");
      setNewArea("");
    }
  }, [firstArea, area, newArea]);
  const [keyboard, setKeyboard] = useState(300);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", (event) => setKeyboard(event.endCoordinates.height));
    return () => sub.remove();
  }, []);

  const parsed = useMemo(() => parseTask(text, new Date(), defaultDay), [text, defaultDay]);
  const day = manual ? manual.day : parsed.day;
  const time = manual ? (manual.time ?? (parsed.fromText ? parsed.time : null)) : parsed.time;
  const when = day ? whenLabel({ day, time }) : null;
  const sparkle = !manual && parsed.fromText;
  // A name typed for a new area counts, even before Return.
  const typedArea = newArea?.trim() || null;
  const ready = text.trim().length > 0 && !!(area ?? typedArea);

  const [state, setState] = useState<ButtonState>("idle");
  const submit = () => {
    if (!ready || state !== "idle") return;
    const chosen = area ?? (typedArea ? addArea(typedArea) : null);
    if (!chosen) return;
    if (chosen !== area) setArea(chosen);
    const title = (parsed.fromText ? parsed.title : text.trim()) || text.trim();
    addTask({ title, area: chosen, day, time: day ? time : null, noteId: params.note ?? null });
    doneHaptic();
    setState("done");
    const where = when ?? "Someday";
    setTimeout(() => {
      router.back();
      acknowledge(params.note ? `Added to this note · ${where}` : day && day !== viewDay && params.day ? `Added · it's due ${where}` : `Added to ${chosen} · ${where}`, "check");
    }, 260);
  };

  const rise = () => {
    "worklet";
    return {
      initialValues: { opacity: 0, transform: [{ translateY: 40 }, { scale: 0.96 }] },
      animations: {
        opacity: withTiming(1, { duration: duration.quick, easing: easeOut }),
        transform: [{ translateY: withSpring(0, spring.glide) }, { scale: withSpring(1, spring.glide) }],
      },
    };
  };

  const commitArea = () => {
    const made = addArea(newArea ?? "");
    if (made) setArea(made);
    setNewArea(null);
    setPanel("none");
    input.current?.focus();
  };

  return (
    <View style={styles.screen}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={() => router.back()} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={styles.flex} pointerEvents="box-none">
        <View style={styles.flex} pointerEvents="box-none" />
        <Animated.View entering={reducedAtLaunch ? arrive : rise} style={[styles.card, { backgroundColor: colors.card, boxShadow: colors.shadow, marginBottom: panel === "date" ? 0 : space[3] }]}>
          <Txt variant="eyebrow" tone="ink3">
            {params.note ? "New task for this note" : "New task"}
          </Txt>
          <TextInput
            ref={input}
            autoFocus
            value={text}
            onChangeText={setText}
            onFocus={() => panel === "date" && setPanel("none")}
            placeholder={defaultDay ? "Call Dr. Lee" : "Call Dr. Lee tomorrow"}
            placeholderTextColor={colors.ink3}
            selectionColor={accent.solid}
            cursorColor={accent.solid}
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={submit}
            maxLength={500}
            style={[body, styles.input, { color: colors.ink }]}
            accessibilityLabel="New task"
          />

          {panel === "areas" && firstArea ? (
            <Txt variant="footnote" tone="ink3">
              Every task lives in an area, like Home or Work.
            </Txt>
          ) : null}
          {panel === "areas" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={styles.areaRow}>
              {areas.map((item) => (
                <Chip
                  onCard
                  key={item.name}
                  label={item.name}
                  selected={area === item.name}
                  onPress={() => (tick(), setArea(item.name), setPanel("none"))}
                />
              ))}
              {newArea === null ? (
                <Chip onCard icon="plus" label="New" accessibilityLabel="New area" onPress={() => setNewArea("")} />
              ) : (
                <View style={[styles.newArea, firstArea && styles.firstArea, { borderColor: colors.ink }]}>
                  <TextInput
                    autoFocus={!firstArea}
                    value={newArea}
                    onChangeText={setNewArea}
                    placeholder={firstArea ? "Name your first area" : "Name"}
                    placeholderTextColor={colors.ink3}
                    selectionColor={accent.solid}
                    cursorColor={accent.solid}
                    returnKeyType="done"
                    onSubmitEditing={commitArea}
                    accessibilityLabel="New area name"
                    style={[small, styles.newAreaInput, { color: colors.ink }]}
                  />
                </View>
              )}
            </ScrollView>
          ) : null}

          <View style={styles.tools}>
            <Chip
              onCard
              icon="tag"
              label={area ?? "Area"}
              accessibilityLabel={`Area: ${area ?? "none"}`}
              selected={panel === "areas"}
              onPress={() => (tap(), setPanel(panel === "areas" ? "none" : "areas"))}
            />
            <Chip
              onCard
              icon={sparkle ? "sparkles" : "calendar"}
              label={when ?? undefined}
              accessibilityLabel={`Date: ${when ?? "none"}`}
              selected={panel === "date"}
              onPress={() => {
                tap();
                if (panel === "date") {
                  setPanel("none");
                  input.current?.focus();
                } else {
                  Keyboard.dismiss();
                  setPanel("date");
                }
              }}
            />
          </View>
          <Button label="Add task" icon="plus" size="md" disabled={!ready} state={state} onPress={submit} />
        </Animated.View>

        {panel === "date" ? (
          <View style={[styles.datePanel, { minHeight: keyboard, paddingBottom: insets.bottom + space[3], backgroundColor: colors.page, borderTopColor: colors.hairline }]}>
            <ScrollView contentContainerStyle={styles.datePanelInner}>
              <View style={styles.chipsWrap}>
                {dayChoices().map((choice) => (
                  <Chip
                    key={choice.label}
                    label={choice.label}
                    selected={choice.day === day}
                    onPress={() => (tick(), setManual({ day: choice.day, time: choice.day ? time : null }))}
                  />
                ))}
              </View>
              <InlineCalendar value={day} onChange={(picked) => setManual({ day: picked, time })} />
              <View style={styles.timeRow}>
                {time !== null ? (
                  <>
                    <Icon name="clock" size={20} color={colors.ink2} weight="regular" />
                    <CompactTime value={time} onChange={(minutes) => setManual({ day: day ?? today(), time: minutes })} />
                    <Pressable onPress={() => setManual({ day, time: null })} accessibilityRole="button" accessibilityLabel="No time" hitSlop={10} style={styles.clear}>
                      <Icon name="close" size={16} color={colors.ink3} weight="medium" />
                    </Pressable>
                  </>
                ) : (
                  <Chip icon="clock" label="Add a time" onPress={() => setManual({ day: day ?? today(), time: 9 * 60 })} />
                )}
              </View>
            </ScrollView>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  card: { marginHorizontal: space[3], borderRadius: radius.lg, borderCurve: "continuous", paddingTop: space[5], paddingBottom: space[4], paddingHorizontal: space[4], gap: space[3] },
  input: { minHeight: 34, paddingVertical: 0, outlineWidth: 0 },
  areaRow: { gap: space[2] },
  tools: { flexDirection: "row", alignItems: "center", gap: space[2] },
  newArea: { height: 34, minWidth: 110, paddingHorizontal: 14, borderRadius: radius.pill, borderCurve: "continuous", borderWidth: 1.5, justifyContent: "center" },
  newAreaInput: { paddingVertical: 0, outlineWidth: 0 },
  firstArea: { minWidth: 200 },
  datePanel: { marginTop: space[3], borderTopWidth: StyleSheet.hairlineWidth },
  datePanelInner: { paddingHorizontal: edge, paddingTop: space[4], gap: space[4] },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  timeRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 44 },
  clear: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
