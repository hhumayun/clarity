import { useAudioPlayer } from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check,
  ChevronLeft,
  CupSoda,
  Eye,
  Flag,
  FilePlus2,
  Pause,
  Play,
  Square,
  PersonStanding,
} from "lucide-react-native";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOutDown } from "react-native-reanimated";
import { fadeOut, MOTION } from "../../../src/ui/motion";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCountdown } from "../../../src/hooks/useCountdown";
import { useFirstSteps, useFocusPrefs, useFocusSummary, useRecordFocus } from "../../../src/hooks/useFocus";
import { useCreateNote } from "../../../src/hooks/useNotes";
import { useTasks } from "../../../src/hooks/useTasks";
import {
  BREAK_MINUTES,
  checkInHeading,
  checkInQuestion,
  FOCUS_DURATIONS,
  focusedMinutes,
  KEEP_GOING_MINUTES,
  minutesLeftLabel,
  minutesPhrase,
  restLeftLabel,
  stepFromLeftOff,
  type FocusOutcome,
} from "../../../src/lib/focus";
import {
  cancelEndAlert,
  ensureNotificationPermission,
  scheduleEndAlert,
  softHaptic,
} from "../../../src/lib/focusAlerts";
import { areaColor } from "../../../src/lib/lifeCenter";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, radius, spacing, type Colors } from "../../../src/theme";
import type { TaskRecord } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { ProgressRing } from "../../../src/ui/ProgressRing";
import { Skeleton } from "../../../src/ui/Skeleton";
import { Switch } from "../../../src/ui/Switch";

type Phase = "setup" | "focusing" | "checkin" | "break";

type Session = {
  startedAt: Date;
  plannedMinutes: number;
  firstStep: string;
  focusedSeconds: number;
  stoppedEarly: boolean;
};

const REST_IDEAS = [
  { icon: PersonStanding, text: "Stand up and stretch" },
  { icon: CupSoda, text: "Drink a glass of water" },
  { icon: Eye, text: "Look at something far away" },
];

/**
 * Focus time for one task, start to finish: set up, focus, check in, rest.
 * One screen with phases rather than several routes, so the timer never has
 * to survive a navigation.
 */
export default function FocusScreen() {
  const params = useLocalSearchParams<{ taskId: string; continue?: string }>();
  const taskId = params.taskId;
  const router = useRouter();
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);

  const { query, update } = useTasks();
  const summary = useFocusSummary();
  const { prefs, ready: prefsReady, save: savePrefs } = useFocusPrefs();
  const record = useRecordFocus();
  const createNote = useCreateNote();
  const chime = useAudioPlayer(require("../../../assets/sounds/focus-chime.wav"));

  const task: TaskRecord | undefined = query.data?.tasks.find((t) => t.id === taskId);
  const last = summary.data?.tasks.find((row) => row.taskId === taskId);
  const lastLeftOff = last && last.lastOutcome !== "finished" ? last.lastLeftOff.trim() : "";

  const [phase, setPhase] = useState<Phase>("setup");
  const [minutes, setMinutes] = useState(prefs.minutes);
  const [breakAfter, setBreakAfter] = useState(prefs.breakAfter);
  const [firstStep, setFirstStep] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [outcome, setOutcome] = useState<FocusOutcome>("progress");
  const [leftOff, setLeftOff] = useState("");
  const [parking, setParking] = useState(false);
  const [thought, setThought] = useState("");
  const [breakOver, setBreakOver] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const alertId = useRef<string | null>(null);

  const firstSteps = useFirstSteps(taskId, phase === "setup" && Boolean(task));

  // Setup starts from the remembered length and break choice, and from where
  // the person left off last time, once those have loaded.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !prefsReady || summary.isLoading) return;
    seeded.current = true;
    setMinutes(prefs.minutes);
    setBreakAfter(prefs.breakAfter);
    if (lastLeftOff) setFirstStep(stepFromLeftOff(lastLeftOff));
  }, [prefsReady, summary.isLoading, prefs, lastLeftOff]);

  const signalEnd = useCallback(() => {
    softHaptic();
    try {
      chime.seekTo(0);
      chime.play();
    } catch {
      // No sound is fine; the haptic already said it.
    }
  }, [chime]);

  const focusTimer = useCountdown({
    onDone: () => {
      signalEnd();
      alertId.current = null;
      setSession((s) => (s ? { ...s, focusedSeconds: s.plannedMinutes * 60, stoppedEarly: false } : s));
      setOutcome("progress");
      setLeftOff("");
      setParking(false);
      setPhase("checkin");
    },
  });
  const breakTimer = useCountdown({
    onDone: () => {
      signalEnd();
      alertId.current = null;
      setBreakOver(true);
    },
  });

  // Keep the screen on while a timer is running.
  const timing = focusTimer.status === "running" || breakTimer.status === "running";
  useEffect(() => {
    if (!timing) return;
    void activateKeepAwakeAsync("focus").catch(() => {});
    return () => {
      deactivateKeepAwake("focus");
    };
  }, [timing]);

  // Android's back button must not silently end a session.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (phase === "focusing") {
        toast.show("Use Stop early to end focus time.");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [phase, toast]);

  useEffect(
    () => () => {
      void cancelEndAlert(alertId.current);
    },
    [],
  );

  const close = useCallback(() => {
    void cancelEndAlert(alertId.current);
    alertId.current = null;
    if (router.canGoBack()) router.back();
    else router.replace("/life-center");
  }, [router]);

  const scheduleAlert = useCallback(async (at: number, title: string, body: string) => {
    await cancelEndAlert(alertId.current);
    alertId.current = await scheduleEndAlert(at, title, body);
  }, []);

  const beginFocus = useCallback(
    async (mins: number, step: string) => {
      const durationMs = mins * 60_000;
      setSession({
        startedAt: new Date(),
        plannedMinutes: mins,
        firstStep: step.trim(),
        focusedSeconds: 0,
        stoppedEarly: false,
      });
      setBreakOver(false);
      breakTimer.reset();
      setPhase("focusing");
      focusTimer.start(durationMs);
      if (await ensureNotificationPermission()) {
        await scheduleAlert(Date.now() + durationMs, "Focus time is up", "How did it go?");
      }
    },
    [breakTimer, focusTimer, scheduleAlert],
  );

  // "Continue · 15 min" from Today skips setup and starts straight away.
  const continued = useRef(false);
  useEffect(() => {
    if (continued.current || params.continue !== "1" || !task || !prefsReady || summary.isLoading) return;
    continued.current = true;
    setBreakAfter(prefs.breakAfter);
    void beginFocus(last?.lastPlannedMinutes ?? prefs.minutes, lastLeftOff ? stepFromLeftOff(lastLeftOff) : "");
  }, [params.continue, task, prefsReady, summary.isLoading, prefs, last, lastLeftOff, beginFocus]);

  const startFromSetup = () => {
    savePrefs({ minutes, breakAfter });
    void beginFocus(minutes, firstStep);
  };

  const togglePause = () => {
    if (focusTimer.status === "running") {
      focusTimer.pause();
      void cancelEndAlert(alertId.current);
      alertId.current = null;
    } else if (focusTimer.status === "paused") {
      const at = Date.now() + focusTimer.remainingMs;
      focusTimer.resume();
      void scheduleAlert(at, "Focus time is up", "How did it go?");
    }
  };

  const stopEarly = () => {
    const usedMs = focusTimer.stop();
    void cancelEndAlert(alertId.current);
    alertId.current = null;
    setSession((s) => (s ? { ...s, focusedSeconds: Math.round(usedMs / 1000), stoppedEarly: true } : s));
    setOutcome("progress");
    setLeftOff("");
    setParking(false);
    setPhase("checkin");
  };

  const parkThought = () => {
    const content = thought.trim();
    if (!content) return;
    createNote.mutate(
      { content, source: "focus" },
      {
        onSuccess: () => toast.show("Saved to Notes"),
        onError: () => toast.show("That thought could not be saved. Please try again."),
      },
    );
    setThought("");
    setParking(false);
  };

  /** Save the session, then go where the check-in's choice leads. */
  const leaveCheckIn = async (next: "break" | "keepGoing" | "done") => {
    if (!session || !task || leaving) return;
    setLeaving(true);
    const note = outcome === "finished" ? "" : leftOff.trim();
    record.mutate(
      {
        taskId: task.id,
        plannedMinutes: session.plannedMinutes,
        focusedSeconds: session.focusedSeconds,
        firstStep: session.firstStep,
        outcome,
        leftOff: note,
        startedAt: session.startedAt,
      },
      { onError: () => toast.show("That session could not be saved.") },
    );
    if (outcome === "finished") {
      update.mutate(
        { id: task.id, status: "done" },
        { onError: () => toast.show("The task could not be marked done. Please try again.") },
      );
    }
    setLeaving(false);
    if (next === "done") {
      close();
      return;
    }
    if (next === "keepGoing") {
      void beginFocus(KEEP_GOING_MINUTES, note ? stepFromLeftOff(note) : session.firstStep);
      return;
    }
    setPhase("break");
    setBreakOver(false);
    breakTimer.start(BREAK_MINUTES * 60_000);
    if (await ensureNotificationPermission()) {
      await scheduleAlert(Date.now() + BREAK_MINUTES * 60_000, "Break's over", "Ready when you are.");
    }
  };

  if (!task) {
    return (
      <SafeAreaView style={styles.page}>
        <Animated.View key="missing" entering={FadeIn.duration(MOTION.slow)} style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={close} style={styles.roundButton} accessibilityLabel="Close">
            <ChevronLeft size={20} color={colors.foreground} />
          </Pressable>
        </View>
        <View style={styles.body}>
          {query.isLoading ? (
            <Skeleton style={styles.skeleton} />
          ) : (
            <Text style={styles.muted}>That task could not be found. It may have been deleted.</Text>
          )}
        </View>
              </Animated.View>
      </SafeAreaView>
    );
  }

  // ---- Setup ---------------------------------------------------------------
  if (phase === "setup") {
    const steps = firstSteps.data?.steps ?? [];
    return (
      <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
        <Animated.View key={phase} entering={FadeIn.duration(MOTION.slow)} style={styles.flex}>
        <View style={styles.header}>
          <Pressable onPress={close} style={styles.roundButton} accessibilityLabel="Back">
            <ChevronLeft size={20} color={colors.foreground} />
          </Pressable>
          <Text style={styles.headerTitle}>Focus time</Text>
          <View style={styles.roundSpacer} />
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.gapSm}>
              <Text style={styles.muted}>You'll work on</Text>
              <Text style={styles.taskTitle}>{task.text}</Text>
              <View style={styles.area}>
                <View style={[styles.dot, { backgroundColor: areaColor(task.projectId) }]} />
                <Text style={styles.muted}>{task.projectName}</Text>
              </View>
            </View>

            <Text style={styles.label}>How long?</Text>
            <View style={styles.durations}>
              {FOCUS_DURATIONS.map((option) => {
                const active = option.minutes === minutes;
                return (
                  <Pressable
                    key={option.minutes}
                    onPress={() => setMinutes(option.minutes)}
                    style={[styles.duration, active && styles.durationActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${option.minutes} minutes, ${option.label}`}
                  >
                    <Text style={styles.durationNumber}>{option.minutes}</Text>
                    <Text style={styles.durationUnit}>min</Text>
                    <Text style={styles.durationLabel}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>What's your first small step?</Text>
            <TextInput
              value={firstStep}
              onChangeText={setFirstStep}
              placeholder="Something you could start in two minutes"
              placeholderTextColor={colors.mutedForeground}
              style={styles.input}
              maxLength={200}
              returnKeyType="done"
            />
            {steps.length > 0 ? (
              <Animated.View entering={FadeIn.duration(200)} style={styles.bubbles}>
                {steps.map((step) => (
                  <Pressable
                    key={step}
                    onPress={() => setFirstStep(step)}
                    style={[styles.bubble, firstStep === step && styles.bubbleActive]}
                    accessibilityLabel={`Use first step: ${step}`}
                  >
                    <Text style={styles.bubbleText}>{step}</Text>
                  </Pressable>
                ))}
              </Animated.View>
            ) : null}

            <View style={styles.breakRow}>
              <View style={styles.flex}>
                <Text style={styles.breakTitle}>{BREAK_MINUTES}-minute break after</Text>
                <Text style={styles.breakHint}>A gentle nudge to rest</Text>
              </View>
              <Switch
                value={breakAfter}
                onValueChange={setBreakAfter}
                accessibilityLabel={`${BREAK_MINUTES}-minute break after`}
              />
            </View>
          </ScrollView>
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={startFromSetup}
              accessibilityRole="button"
            >
              <Play size={18} color={colors.primaryForeground} fill={colors.primaryForeground} />
              <Text style={styles.primaryText}>Start {minutesPhrase(minutes)}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
              </Animated.View>
      </SafeAreaView>
    );
  }

  // ---- Focusing ------------------------------------------------------------
  if (phase === "focusing" && session) {
    const left = minutesLeftLabel(focusTimer.remainingMs);
    const paused = focusTimer.status === "paused";
    return (
      <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
        <Animated.View key={phase} entering={FadeIn.duration(MOTION.slow)} style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.focusBody} keyboardShouldPersistTaps="handled">
            <View style={styles.pill}>
              <View style={[styles.dot, { backgroundColor: colors.primary }]} />
              <Text style={styles.pillText}>Focus time · {session.plannedMinutes} min</Text>
            </View>
            <Text style={styles.muted}>You're working on</Text>
            <Text style={[styles.taskTitle, styles.centerText]}>{task.text}</Text>
            {session.firstStep ? (
              <View style={styles.stepChip}>
                <Flag size={16} color={colors.accentForeground} />
                <Text style={styles.stepChipText}>First step: {session.firstStep}</Text>
              </View>
            ) : null}

            <ProgressRing
              remaining={1 - focusTimer.progress}
              size={260}
              stroke={12}
              color={paused ? colors.mutedForeground : colors.primary}
              trackColor={colors.muted}
              style={styles.ring}
            >
              <Text style={styles.ringNumber} accessibilityLabel={`${left.value} ${left.unit}`}>
                {left.value}
              </Text>
              <Text style={styles.ringUnit}>{paused ? "paused" : left.unit}</Text>
            </ProgressRing>

            <View style={styles.controls}>
              <View style={styles.control}>
                <Pressable
                  onPress={() => setParking((v) => !v)}
                  style={styles.controlButton}
                  accessibilityLabel="Park a thought. Saves it to Notes without stopping the timer."
                >
                  <FilePlus2 size={22} color={colors.foreground} />
                </Pressable>
                <Text style={styles.controlLabel}>Park a thought</Text>
              </View>
              <View style={styles.control}>
                <Pressable
                  onPress={togglePause}
                  style={[styles.controlButton, styles.controlMain]}
                  accessibilityLabel={paused ? "Resume" : "Pause"}
                >
                  {paused ? (
                    <Play size={26} color={colors.primaryForeground} fill={colors.primaryForeground} />
                  ) : (
                    <Pause size={26} color={colors.primaryForeground} fill={colors.primaryForeground} />
                  )}
                </Pressable>
                <Text style={[styles.controlLabel, styles.controlLabelStrong]}>
                  {paused ? "Resume" : "Pause"}
                </Text>
              </View>
              <View style={styles.control}>
                <Pressable onPress={stopEarly} style={styles.controlButton} accessibilityLabel="Stop early">
                  <Square size={18} color={colors.foreground} fill={colors.foreground} />
                </Pressable>
                <Text style={styles.controlLabel}>Stop early</Text>
              </View>
            </View>

            {parking ? (
              <Animated.View
                entering={FadeInDown.duration(180)}
                exiting={FadeOutDown.duration(160)}
                style={styles.parkPanel}
              >
                <Text style={styles.label}>Park a thought</Text>
                <Text style={styles.breakHint}>It goes to Notes. The timer keeps running.</Text>
                <TextInput
                  value={thought}
                  onChangeText={setThought}
                  placeholder="What's on your mind?"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, styles.parkInput]}
                  autoFocus
                  multiline
                  maxLength={2_000}
                />
                <View style={styles.parkActions}>
                  <Button variant="ghost" size="sm" onPress={() => setParking(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" disabled={!thought.trim()} onPress={parkThought}>
                    Save to Notes
                  </Button>
                </View>
              </Animated.View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
              </Animated.View>
      </SafeAreaView>
    );
  }

  // ---- Check-in ------------------------------------------------------------
  if (phase === "checkin" && session) {
    const question = checkInQuestion(outcome);
    const finished = outcome === "finished";
    const mins = focusedMinutes(session.focusedSeconds);
    const primary = breakAfter
      ? { label: `Take a ${BREAK_MINUTES}-minute break`, next: "break" as const }
      : finished
        ? { label: "Back to Life Center", next: "done" as const }
        : { label: `Keep going · ${KEEP_GOING_MINUTES} more min`, next: "keepGoing" as const };
    const secondary = finished
      ? breakAfter
        ? { label: "I'm done for now", next: "done" as const }
        : null
      : breakAfter
        ? { label: `Keep going · ${KEEP_GOING_MINUTES} more min`, next: "keepGoing" as const }
        : { label: "I'm done for now", next: "done" as const };
    return (
      <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
        <Animated.View key={phase} entering={FadeIn.duration(MOTION.slow)} style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Animated.View entering={FadeIn.duration(240)} style={styles.doneBadge}>
              <Check size={26} color={colors.accentForeground} strokeWidth={2.5} />
            </Animated.View>
            <Text style={styles.bigTitle}>{checkInHeading(session.stoppedEarly)}</Text>
            <Text style={styles.muted}>
              {mins === 0 ? "Less than a minute" : minutesPhrase(mins)} on {task.text}
            </Text>

            <Text style={styles.label}>How did it go?</Text>
            <View style={styles.gapSm}>
              {(
                [
                  { value: "finished", label: "I finished it" },
                  { value: "progress", label: "I made progress" },
                  { value: "stuck", label: "I got stuck" },
                ] as const
              ).map((option) => {
                const active = outcome === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setOutcome(option.value)}
                    style={[styles.radioRow, active && styles.radioRowActive]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <View style={[styles.radio, active && styles.radioOn]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <Text style={styles.radioText}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            {question ? (
              <Animated.View entering={FadeIn.duration(180)} exiting={fadeOut} style={styles.gapSm}>
                <Text style={styles.label}>{question}</Text>
                <TextInput
                  value={leftOff}
                  onChangeText={setLeftOff}
                  placeholder={
                    outcome === "stuck"
                      ? "e.g., Not sure which form to use"
                      : "e.g., Found the receipts. Next: fill in the forms."
                  }
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, styles.leftOffInput]}
                  multiline
                  maxLength={2_000}
                />
                <Text style={styles.breakHint}>You'll see this next time you open the task.</Text>
              </Animated.View>
            ) : null}
          </ScrollView>
          <View style={[styles.footer, styles.gapSm]}>
            <Pressable
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              onPress={() => void leaveCheckIn(primary.next)}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{primary.label}</Text>
            </Pressable>
            {secondary ? (
              <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={() => void leaveCheckIn(secondary.next)}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>{secondary.label}</Text>
              </Pressable>
            ) : null}
            {breakAfter && !finished ? (
              <Pressable onPress={() => void leaveCheckIn("done")} style={styles.textLink}>
                <Text style={styles.textLinkText}>I'm done for now</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
              </Animated.View>
      </SafeAreaView>
    );
  }

  // ---- Break ---------------------------------------------------------------
  if (phase === "break" && session) {
    const left = restLeftLabel(breakTimer.remainingMs);
    const note = outcome === "finished" ? "" : leftOff.trim();
    return (
      <SafeAreaView style={styles.page} edges={["top", "bottom"]}>
        <Animated.View key={phase} entering={FadeIn.duration(MOTION.slow)} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.focusBody}>
          <View style={[styles.pill, styles.pillRest]}>
            <View style={[styles.dot, { backgroundColor: colors.rest }]} />
            <Text style={styles.pillText}>Break · {BREAK_MINUTES} min</Text>
          </View>
          <ProgressRing
            remaining={1 - breakTimer.progress}
            size={190}
            stroke={10}
            color={colors.rest}
            trackColor={colors.muted}
          >
            {breakOver ? (
              <Check size={44} color={colors.rest} strokeWidth={2.5} />
            ) : (
              <>
                <Text style={styles.restNumber}>{left.value}</Text>
                <Text style={styles.ringUnit}>{left.unit}</Text>
              </>
            )}
          </ProgressRing>
          <Text style={[styles.bigTitle, styles.centerText]}>
            {breakOver ? "Break's over" : "Time to rest"}
          </Text>
          <Text style={[styles.muted, styles.centerText]}>
            {breakOver
              ? "Come back whenever you're ready."
              : "Step away from the screen. We'll let you know when the break is over."}
          </Text>
          <View style={styles.ideas}>
            {REST_IDEAS.map(({ icon: Icon, text }, i) => (
              <View key={text} style={[styles.idea, i > 0 && styles.ideaDivider]}>
                <Icon size={20} color={colors.rest} />
                <Text style={styles.ideaText}>{text}</Text>
              </View>
            ))}
          </View>
          {note ? (
            <View style={styles.backCard}>
              <Text style={styles.backLabel}>WHEN YOU'RE BACK</Text>
              <Text style={styles.backText}>{note}</Text>
            </View>
          ) : null}
        </ScrollView>
        <View style={[styles.footer, styles.gapSm]}>
          {outcome === "finished" ? (
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={close}>
              <Text style={styles.primaryText}>Back to Life Center</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                onPress={() => void beginFocus(session.plannedMinutes, note ? stepFromLeftOff(note) : session.firstStep)}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>Back to it · {session.plannedMinutes} min</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={close}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>I'm done for now</Text>
              </Pressable>
            </>
          )}
        </View>
              </Animated.View>
      </SafeAreaView>
    );
  }

  return <SafeAreaView style={styles.page} />;
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    pressed: { opacity: 0.85 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
    },
    headerTitle: { fontFamily: fonts.baseSemi, fontSize: 17 * scale, color: colors.foreground },
    roundButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    roundSpacer: { width: 44 },
    body: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[6] },
    focusBody: { padding: spacing[4], gap: spacing[3], alignItems: "center", paddingBottom: spacing[6] },
    skeleton: { height: 120, borderRadius: radius.lg },
    gapSm: { gap: spacing[2] },
    muted: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    centerText: { textAlign: "center" },
    taskTitle: { fontFamily: fonts.display, fontSize: 28 * scale, color: colors.foreground },
    bigTitle: { fontFamily: fonts.display, fontSize: 30 * scale, color: colors.foreground },
    area: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    dot: { width: 8, height: 8, borderRadius: 4 },
    label: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    durations: { flexDirection: "row", gap: spacing[2] },
    duration: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    durationActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.accent },
    durationNumber: { fontFamily: fonts.display, fontSize: 30 * scale, color: colors.foreground },
    durationUnit: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    durationLabel: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    input: {
      minHeight: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.foreground,
      fontFamily: fonts.base,
      fontSize: 17 * scale,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    bubbles: { gap: spacing[2], alignItems: "flex-start" },
    bubble: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
    },
    bubbleActive: { borderColor: colors.primary, backgroundColor: colors.accent },
    bubbleText: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.foreground },
    breakRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
    },
    breakTitle: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.foreground },
    breakHint: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    footer: { paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[3] },
    primary: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing[2],
      minHeight: 56,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    primaryText: { fontFamily: fonts.baseBold, fontSize: 17 * scale, color: colors.primaryForeground },
    secondary: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 52,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    secondaryText: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.foreground },
    textLink: { alignItems: "center", paddingVertical: spacing[2] },
    textLinkText: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: 6,
      marginTop: spacing[4],
      marginBottom: spacing[3],
    },
    pillRest: { backgroundColor: colors.restSurface, borderColor: colors.restSurface },
    pillText: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    stepChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      borderRadius: radius.full,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      maxWidth: "100%",
    },
    stepChipText: { flexShrink: 1, fontFamily: fonts.base, fontSize: 15 * scale, color: colors.accentForeground },
    ring: { marginVertical: spacing[6] },
    ringNumber: { fontFamily: fonts.display, fontSize: 72 * scale, color: colors.foreground },
    ringUnit: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.mutedForeground },
    restNumber: { fontFamily: fonts.display, fontSize: 52 * scale, color: colors.foreground },
    controls: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-around", alignSelf: "stretch" },
    control: { alignItems: "center", gap: spacing[2], width: 110 },
    controlButton: {
      width: 64,
      height: 64,
      borderRadius: 32,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    controlMain: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.primary, borderWidth: 0 },
    controlLabel: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.foreground, textAlign: "center" },
    controlLabelStrong: { fontFamily: fonts.baseSemi },
    parkPanel: {
      alignSelf: "stretch",
      gap: spacing[2],
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: spacing[4],
      marginTop: spacing[4],
    },
    parkInput: { minHeight: 90, textAlignVertical: "top" },
    parkActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing[2] },
    doneBadge: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
      marginTop: spacing[4],
    },
    radioRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[4],
      minHeight: 54,
    },
    radioRowActive: { borderColor: colors.primary, borderWidth: 2, backgroundColor: colors.accent },
    radio: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    radioOn: { borderColor: colors.primary },
    radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primary },
    radioText: { fontFamily: fonts.base, fontSize: 17 * scale, color: colors.foreground },
    leftOffInput: { minHeight: 76, textAlignVertical: "top" },
    ideas: {
      alignSelf: "stretch",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: spacing[2],
    },
    idea: { flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[4] },
    ideaDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    ideaText: { fontFamily: fonts.base, fontSize: 16 * scale, color: colors.foreground },
    backCard: {
      alignSelf: "stretch",
      gap: 4,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
      padding: spacing[4],
    },
    backLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 12 * scale,
      letterSpacing: 1,
      color: colors.accentForeground,
    },
    backText: { fontFamily: fonts.base, fontSize: 16 * scale, lineHeight: 22 * scale, color: colors.foreground },
  });
}
