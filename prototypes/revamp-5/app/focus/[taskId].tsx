import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeOut,
  interpolateColor,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { useAreaColor, useFocusHistory, useTask } from "../../src/store/hooks";
import type { FocusLength, Outcome } from "../../src/store/model";
import { clockLabel } from "../../src/store/selectors";
import { useStore } from "../../src/store/store";
import { calm, duration, easeInOut, easeOut, spring } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { dark as room, edge, pad, radius, space } from "../../src/theme/tokens";
import { Hourglass, Tea } from "../../src/art/Pictures";
import { Card, CardGroup } from "../../src/ui/Card";
import { Chip } from "../../src/ui/Chip";
import { done as doneHaptic, tap, tick } from "../../src/ui/haptics";
import { Icon, type IconName } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { Level } from "../../src/ui/Level";
import { PressableScale } from "../../src/ui/PressableScale";
import { Roll } from "../../src/ui/Roll";
import { SavedPill } from "../../src/ui/SavedPill";
import { Toggle } from "../../src/ui/Toggle";
import { Txt, useType } from "../../src/ui/Txt";

/** The break's room: the dark, in either theme. */
const ROOM = "#0D0D0E";
const LENGTHS: { minutes: FocusLength; label: string }[] = [
  { minutes: 10, label: "Easy start" },
  { minutes: 15, label: "Steady" },
  { minutes: 25, label: "Classic" },
];
const BREAK = 5;
const KEEP_GOING = 10;
/** How long the stop button must be held. */
const HOLD_MS = 1_200;
const DIAL = 40;
/** The edge of the round controls, so they read on the colour and on the page alike. */
const DISC_EDGE = "rgba(255, 255, 255, 0.16)";
const SLOT = 24;
const INSET = edge + SLOT + space[3];

type Phase = "setup" | "focus" | "checkin" | "break";

/**
 * Focus time, in four steps. Set it up on the page, with Rosebud's tiles
 * for the length; press Start and a deep shade of your accent floods out
 * from the button to fill the screen. The colour is the timer: it drains
 * from the top as the minutes go, so the whole screen is the clock. The
 * words are light on the colour and dark on the page, so they change where
 * the level passes. Then the check-in, with the lights up, and a break in
 * the dark with a cup of tea. Icons carry the controls; words are for the
 * task, its first step and the question after.
 */
export default function Focus() {
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const { colors, dark, accent } = useTheme();
  const reduced = useReducedMotion();
  const areaColor = useAreaColor();
  const task = useTask(taskId);
  const mark = areaColor(task?.area);
  const bodyType = useType("body");
  // What sits on the level: light words on the deep colour.
  const onLevel = { ink: accent.onDeep, soft: "rgba(242,239,233,0.74)" };
  const history = useFocusHistory(taskId);
  const prefs = useStore((state) => state.prefs);
  const setPref = useStore((state) => state.setPref);
  const recordFocus = useStore((state) => state.recordFocus);
  const parkThought = useStore((state) => state.parkThought);
  const speed = prefs.fastTimers ? 30 : 1;

  const [phase, setPhase] = useState<Phase>("setup");
  const [length, setLength] = useState<number>(prefs.focusLength);
  const [step, setStep] = useState(() => firstStepFrom(history?.leftOff ?? null));
  const [secondsLeft, setSecondsLeft] = useState(length * 60);
  const [running, setRunning] = useState(false);
  const [natural, setNatural] = useState(false);
  const [focused, setFocused] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>("progress");
  const [leftOff, setLeftOff] = useState("");
  const [parking, setParking] = useState(false);
  const [thought, setThought] = useState("");
  const [parked, setParked] = useState(0);
  const [breakOver, setBreakOver] = useState(false);
  const [flood, setFlood] = useState<{ x: number; y: number } | null>(null);

  // The timer: an end time, so it survives the app going to the background.
  const total = useRef(0);
  const endsAt = useRef(0);
  const pausedLeft = useRef(0);
  /** How much time is left, 1 → 0: the colour's level. */
  const level = useSharedValue(1);

  const tone = useSharedValue(0);
  useEffect(() => {
    const target = phase === "break" ? 1 : 0;
    tone.value = withTiming(target, { duration: duration.flood, easing: easeInOut });
  }, [phase, tone]);
  const backdrop = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(tone.value, [0, 1], [colors.page, ROOM]) }));

  const start = useCallback(
    (minutes: number, next: Phase = "focus") => {
      total.current = minutes * 60;
      endsAt.current = Date.now() + (total.current * 1000) / speed;
      setSecondsLeft(total.current);
      setRunning(true);
      setBreakOver(false);
      setFlood(null);
      level.value = 1;
      level.value = withTiming(0, { duration: (total.current * 1000) / speed, easing: Easing.linear });
      setPhase(next);
    },
    [level, speed],
  );

  const finish = useCallback(
    (ended: boolean) => {
      const left = Math.max(0, ((running ? endsAt.current - Date.now() : pausedLeft.current) * speed) / 1000);
      cancelAnimation(level);
      setRunning(false);
      if (phase === "break") {
        doneHaptic();
        setBreakOver(true);
        return;
      }
      doneHaptic();
      setNatural(ended);
      setFocused(Math.round((total.current - left) / 60));
      setLeftOff("");
      setOutcome("progress");
      setParking(false);
      setPhase("checkin");
    },
    [phase, level, running, speed],
  );

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const left = ((endsAt.current - Date.now()) * speed) / 1000;
      setSecondsLeft(Math.max(0, Math.ceil(left)));
      if (left <= 0) finish(true);
    }, 250);
    return () => clearInterval(timer);
  }, [running, speed, finish]);

  const pause = () => {
    tap();
    if (running) {
      pausedLeft.current = endsAt.current - Date.now();
      cancelAnimation(level);
      setRunning(false);
    } else {
      endsAt.current = Date.now() + pausedLeft.current;
      level.value = withTiming(0, { duration: pausedLeft.current, easing: Easing.linear });
      setRunning(true);
    }
  };

  /** Start: ink floods out from the button, then the clock starts. */
  const begin = (x: number, y: number) => {
    tap();
    if (reduced) {
      start(length);
      return;
    }
    setFlood({ x, y });
    setTimeout(() => start(length), duration.flood);
  };

  const save = () => {
    if (!task) return;
    recordFocus(task.id, focused, outcome, leftOff);
  };
  const leave = () => {
    save();
    router.back();
  };
  const keepGoing = () => {
    save();
    setStep(firstStepFrom(leftOff) || step);
    start(KEEP_GOING);
  };

  if (!task) {
    return (
      <View style={[styles.missing, { backgroundColor: colors.page }]}>
        <Txt variant="title3" tone="ink2" style={styles.center}>
          That task could not be found. It may have been deleted.
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={8}>
          <Txt variant="callout" weight="bold">
            Go back
          </Txt>
        </Pressable>
      </View>
    );
  }

  const minutesLeft = secondsLeft >= 60 ? String(Math.ceil(secondsLeft / 60)) : "<1";
  const ends = new Date(Date.now() + (secondsLeft * 1000) / speed);
  const until = clockLabel(ends.getHours() * 60 + ends.getMinutes());
  const share = total.current ? secondsLeft / total.current : 1;
  const chosen = LENGTHS.find((choice) => choice.minutes === length) ?? LENGTHS[1];

  return (
    <Animated.View style={[styles.screen, backdrop]}>
      {/* The top of the screen is on the level until the first few seconds drain it. */}
      <StatusBar style={phase === "break" ? "light" : (phase === "setup" && flood !== null) || (phase === "focus" && share > 0.95) ? "light" : dark ? "light" : "dark"} />

      {phase === "setup" ? (
        <Animated.View key="setup" entering={FadeIn.duration(duration.enter)} exiting={FadeOut.duration(duration.quick)} style={styles.flex}>
          <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + space[2], paddingBottom: 124 + insets.bottom }]} keyboardShouldPersistTaps="handled">
            <View style={styles.top}>
              <IconButton icon="close" label="Close" onPress={() => router.back()} />
            </View>

            <View style={[styles.padded, styles.heading]}>
              <Hourglass size={72} run={false} />
              <Txt variant="title1" center>
                {task.title}
              </Txt>
              <View style={styles.area}>
                <View style={[styles.dot, { backgroundColor: mark }]} />
                <Txt variant="footnote" tone="ink3">
                  {task.area}
                </Txt>
              </View>
            </View>

            <View style={styles.lengths} accessibilityRole="radiogroup">
              {LENGTHS.map((choice) => {
                const on = choice.minutes === length;
                return (
                  <PressableScale
                    key={choice.minutes}
                    onPress={() => {
                      tick();
                      setLength(choice.minutes);
                      setPref("focusLength", choice.minutes);
                    }}
                    accessibilityRole="radio"
                    aria-selected={on}
                    accessibilityLabel={`${choice.minutes} minutes, ${choice.label}`}
                    scaleTo={0.95}
                    style={[styles.length, { backgroundColor: colors.card, borderColor: on ? colors.ink : colors.card }]}
                  >
                    <Dial minutes={choice.minutes} on={on} />
                    <Txt variant="headline" style={{ color: on ? colors.ink : colors.ink2 }}>
                      {choice.minutes} min
                    </Txt>
                    <Txt variant="footnote" tone="ink3">
                      {choice.label}
                    </Txt>
                  </PressableScale>
                );
              })}
            </View>

            <View style={styles.stepBlock}>
              <Card style={styles.stepCard}>
                <Field icon="flag" value={step} onChangeText={setStep} placeholder="What's your first small step?" />
              </Card>
              <View style={styles.ideas}>
                {suggestSteps(task.title).map((idea) => (
                  <Chip key={idea} icon="sparkles" label={idea} onPress={() => (tick(), setStep(idea))} accessibilityLabel={`Use: ${idea}`} />
                ))}
              </View>
            </View>

            <CardGroup>
              <View style={styles.breakRow}>
                <View style={styles.slot}>
                  <Icon name="coffee" size={19} color={colors.ink2} weight="medium" />
                </View>
                <Txt variant="row" style={styles.flex}>
                  Take a break after
                </Txt>
                <Toggle value={prefs.breakAfter} onValueChange={(value) => setPref("breakAfter", value)} accessibilityLabel="Take a break after" />
              </View>
            </CardGroup>
          </ScrollView>

          <View pointerEvents="box-none" style={[styles.sticky, { paddingBottom: insets.bottom + space[3] }]}>
            <LinearGradient pointerEvents="none" colors={[fade(colors.page, 0), colors.page]} style={StyleSheet.absoluteFill} />
            <PressableScale
              onPress={(event) => begin(event.nativeEvent.pageX ?? W / 2, event.nativeEvent.pageY ?? H - 60)}
              accessibilityRole="button"
              accessibilityLabel={`Start ${length} minutes of focus time`}
              style={[styles.start, { backgroundColor: accent.solid }]}
            >
              <Icon name="play" size={16} color={accent.on} weight="bold" />
              <Txt variant="headline" style={{ color: accent.on }}>
                Start · {length} min
              </Txt>
            </PressableScale>
          </View>
          {flood ? <Flood x={flood.x} y={flood.y} color={accent.deep} width={W} height={H} /> : null}
        </Animated.View>
      ) : null}

      {phase === "focus" ? (
        // The flood has already filled the screen with ink, so focus arrives without a fade.
        <Animated.View key="focus" entering={reduced ? FadeIn.duration(duration.enter) : undefined} exiting={FadeOut.duration(duration.quick)} style={styles.flex}>
          {/* The words in ink, on the canvas the level leaves behind… */}
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Readout ink={colors.ink} soft={colors.ink2} task={task.title} step={step} minutes={minutesLeft} until={until} running={running} top={insets.top} />
          </View>
          {/* …and inverted on the level, which slides down past them. */}
          <Level level={level} color={accent.deep} running={running} width={W} height={H}>
            <Readout ink={onLevel.ink} soft={onLevel.soft} task={task.title} step={step} minutes={minutesLeft} until={until} running={running} top={insets.top} />
          </Level>
          <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={styles.controlsWrap} pointerEvents="box-none">
            {parking ? (
              <Animated.View
                entering={FadeIn.duration(duration.base)}
                exiting={FadeOut.duration(duration.quick)}
                style={[styles.park, { backgroundColor: colors.card, boxShadow: colors.shadow, marginBottom: insets.bottom + space[2] }]}
              >
                <TextInput
                  autoFocus
                  value={thought}
                  onChangeText={setThought}
                  placeholder="What's on your mind?"
                  placeholderTextColor={colors.ink3}
                  multiline
                  selectionColor={accent.solid}
                  cursorColor={accent.solid}
                  style={[bodyType, styles.parkInput, { color: colors.ink }]}
                />
                <View style={styles.parkButtons}>
                  <IconButton
                    icon="close"
                    label="Cancel"
                    tone="ink3"
                    onPress={() => {
                      setParking(false);
                      setThought("");
                    }}
                  />
                  <Txt variant="footnote" tone="ink3" style={styles.parkNote}>
                    Goes to Notes. The timer keeps running.
                  </Txt>
                  <PressableScale
                    onPress={() => {
                      if (!thought.trim()) return;
                      parkThought(task.id, thought);
                      tick();
                      setThought("");
                      setParking(false);
                      setParked((n) => n + 1);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Save to Notes"
                    style={[styles.save, { backgroundColor: accent.solid, opacity: thought.trim() ? 1 : 0.35 }]}
                  >
                    <Icon name="notes" size={18} color={accent.on} weight="semibold" />
                  </PressableScale>
                </View>
              </Animated.View>
            ) : (
              <View style={[styles.controls, { paddingBottom: insets.bottom + space[4] }]}>
                <RoomButton icon="idea" label="Park a thought" onPress={() => (tap(), setParking(true))} />
                <PressableScale
                  onPress={pause}
                  accessibilityRole="button"
                  accessibilityLabel={running ? "Pause" : "Resume"}
                  scaleTo={0.9}
                  style={[styles.pause, { backgroundColor: colors.ink, borderColor: DISC_EDGE }]}
                >
                  <Icon name={running ? "pause" : "play"} size={26} color={colors.page} weight="bold" />
                </PressableScale>
                <HoldToStop onStop={() => finish(false)} />
              </View>
            )}
            <SavedPill key={parked} visible={parked > 0 && !parking} label="Saved to Notes" style={[styles.parkedPill, { bottom: insets.bottom + 112 }]} />
          </KeyboardAvoidingView>
        </Animated.View>
      ) : null}

      {phase === "checkin" ? (
        <Animated.View key="checkin" entering={FadeIn.duration(duration.flood).easing(easeOut)} exiting={FadeOut.duration(duration.quick)} style={styles.flex}>
          <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[8] }]} keyboardShouldPersistTaps="handled">
            <View style={styles.top}>
              <IconButton icon="close" label="Close. Your focus time is saved." onPress={leave} />
            </View>
            <View style={[styles.padded, styles.heading]}>
              <Txt variant="title1" center>
                {natural ? "Time's up. Nice focus." : "Stopped early. That still counts."}
              </Txt>
              <Txt variant="callout" tone="ink2" center>
                {focused >= 1 ? `${focused} min` : "Under a minute"} on {task.title}
              </Txt>
            </View>

            <View style={styles.block}>
              <Txt variant="section" tone="ink3" center>
                How did it go?
              </Txt>
              <View style={styles.outcomes}>
                {(
                  [
                    ["finished", "Finished it"],
                    ["progress", "Made progress"],
                    ["stuck", "Got stuck"],
                  ] as [Outcome, string][]
                ).map(([value, label]) => (
                  <OutcomeChoice key={value} kind={value} label={label} selected={outcome === value} onPress={() => (tick(), setOutcome(value))} />
                ))}
              </View>
            </View>

            {outcome !== "finished" ? (
              <Animated.View entering={FadeIn.duration(duration.enter)} style={styles.block}>
                <Txt variant="section" tone="ink3" center>
                  {outcome === "stuck" ? "Where did you get stuck?" : "Where did you leave off?"}
                </Txt>
                <Card style={styles.stepCard}>
                  <Field
                    icon="flag"
                    value={leftOff}
                    onChangeText={setLeftOff}
                    placeholder={outcome === "stuck" ? "e.g., Not sure which form to use" : "e.g., Found the receipts. Next: fill in the forms."}
                  />
                </Card>
                <Txt variant="footnote" tone="ink3" center>
                  You'll see this next time you open the task.
                </Txt>
              </Animated.View>
            ) : null}

            <View style={[styles.padded, styles.actions]}>
              {prefs.breakAfter ? (
                <>
                  <Action
                    icon="coffee"
                    label="Take a break"
                    hint={`Take a ${BREAK}-minute break`}
                    fill={accent.solid}
                    text={accent.on}
                    onPress={() => {
                      save();
                      start(BREAK, "break");
                    }}
                  />
                  {outcome !== "finished" ? <Action icon="play" label="Keep going" hint={`Keep going for ${KEEP_GOING} more minutes`} fill={colors.card} text={colors.ink} onPress={keepGoing} /> : null}
                </>
              ) : outcome === "finished" ? (
                <Action icon="today" label="Back to Today" fill={accent.solid} text={accent.on} onPress={leave} />
              ) : (
                <Action icon="play" label="Keep going" hint={`Keep going for ${KEEP_GOING} more minutes`} fill={accent.solid} text={accent.on} onPress={keepGoing} />
              )}
              {!(outcome === "finished" && !prefs.breakAfter) ? <TextLink label="I'm done for now" color={colors.ink2} onPress={leave} /> : null}
            </View>
          </ScrollView>
        </Animated.View>
      ) : null}

      {phase === "break" ? (
        <Animated.View key="break" entering={FadeIn.duration(duration.flood).easing(easeOut)} style={[styles.flex, { paddingTop: insets.top + space[2], paddingBottom: insets.bottom + space[5] }]}>
          <ScrollView contentContainerStyle={styles.breakContent}>
            <View style={styles.top}>
              <PressableScale onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" scaleTo={0.86} hitSlop={4} style={styles.closeRoom}>
                <Icon name="close" size={22} color={room.ink2} weight="medium" />
              </PressableScale>
            </View>

            <View style={styles.tea}>
              <Tea size={84} art={room.art} />
            </View>
            <View style={[styles.padded, styles.breakTime]}>
              {breakOver ? (
                <Txt variant="numerals" style={{ color: room.ink }}>
                  0
                </Txt>
              ) : (
                <>
                  <Roll value={minutesLeft} variant="numerals" color={room.ink} accessibilityLabel={`${minutesLeft} minutes of rest left`} />
                  <Txt variant="subhead" style={{ color: room.ink2 }}>
                    minutes of rest · until {until}
                  </Txt>
                </>
              )}
              <View style={[styles.track, { backgroundColor: room.sunken }]}>
                <BreakBar level={level} />
              </View>
            </View>

            <View style={styles.padded}>
              <Txt variant="title1" style={{ color: room.ink }}>
                {breakOver ? "Break's over" : "Time to rest"}
              </Txt>
              <Txt variant="callout" style={[styles.breakLine, { color: room.ink2 }]}>
                {breakOver ? "Come back whenever you're ready." : "Step away from the screen. We'll let you know when the break is over."}
              </Txt>
            </View>

            {!breakOver ? (
              <View>
                {(
                  [
                    ["stretch", "Stand up and stretch"],
                    ["water", "Drink a glass of water"],
                    ["far", "Look at something far away"],
                  ] as [IconName, string][]
                ).map(([icon, label], i) => (
                  <Animated.View key={label} entering={FadeIn.delay(280 + i * 90).duration(duration.enter).easing(easeOut)}>
                    {i > 0 ? <View style={[styles.roomRule, { backgroundColor: room.hairline }]} /> : null}
                    <View style={styles.roomIdea}>
                      <View style={styles.slot}>
                        <Icon name={icon} size={21} color={room.ink2} weight="medium" />
                      </View>
                      <Txt variant="callout" style={{ color: room.ink }}>
                        {label}
                      </Txt>
                    </View>
                  </Animated.View>
                ))}
              </View>
            ) : null}

            {leftOff.trim() ? (
              <View style={[styles.padded, styles.backNote]}>
                <View style={styles.slot}>
                  <Icon name="flag" size={16} color={room.ink3} weight="medium" />
                </View>
                <View style={styles.flex}>
                  <Txt variant="footnote" style={{ color: room.ink3 }}>
                    When you're back
                  </Txt>
                  <Txt variant="callout" style={{ color: room.ink2 }}>
                    {leftOff.trim()}
                  </Txt>
                </View>
              </View>
            ) : null}

            <View style={[styles.padded, styles.actions]}>
              {outcome === "finished" ? (
                <Action icon="today" label="Back to Today" fill={room.ink} text={ROOM} onPress={() => router.back()} />
              ) : (
                <>
                  <Action
                    icon="play"
                    label="Back to it"
                    hint={`Back to it for ${length} minutes`}
                    fill={room.ink}
                    text={ROOM}
                    onPress={() => {
                      setStep(firstStepFrom(leftOff) || step);
                      start(length);
                    }}
                  />
                  <TextLink label="I'm done for now" color={room.ink2} onPress={() => router.back()} />
                </>
              )}
            </View>
          </ScrollView>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** A colour at a given opacity, for the fade above Start. */
function fade(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Ink, flooding out from where the finger pressed until it fills the screen. */
function Flood({ x, y, color, width, height }: { x: number; y: number; color: string; width: number; height: number }) {
  const reach = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
  const grow = useSharedValue(0);
  useEffect(() => {
    grow.value = withTiming(1, { duration: duration.flood, easing: easeOut });
  }, [grow]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: 0.02 + 0.98 * grow.value }] }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: "absolute", left: x - reach, top: y - reach, width: reach * 2, height: reach * 2, borderRadius: reach, backgroundColor: color }, style]}
    />
  );
}

/** A slice of the circle, clockwise from twelve. */
function slice(share: number, c: number, r: number): string {
  if (share >= 1) return `M${c - r} ${c} A${r} ${r} 0 1 1 ${c + r} ${c} A${r} ${r} 0 1 1 ${c - r} ${c} Z`;
  const angle = share * Math.PI * 2;
  const x = c + r * Math.sin(angle);
  const y = c - r * Math.cos(angle);
  return `M${c} ${c} L${c} ${c - r} A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

/**
 * A length as a slice of a 25-minute dial: the longer the time, the fuller
 * the dial. The chosen one fills with ink, blooming out from a little
 * smaller; no number has to be read to see which is which.
 */
function Dial({ minutes, on }: { minutes: number; on: boolean }) {
  const { colors, accent } = useTheme();
  const progress = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, { duration: on ? duration.base : duration.quick, easing: easeOut });
  }, [on, progress]);
  const lit = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ scale: 0.9 + 0.1 * progress.value }] }));
  const c = DIAL / 2;
  const r = c - 2;
  const wedge = slice(minutes / 25, c, r);
  return (
    <View style={styles.dial}>
      <Svg width={DIAL} height={DIAL}>
        <Circle cx={c} cy={c} r={r} stroke={colors.ink3} strokeWidth={1.5} fill="none" />
        <Path d={wedge} fill={colors.line} />
      </Svg>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, lit]}>
        <Svg width={DIAL} height={DIAL}>
          <Circle cx={c} cy={c} r={r} stroke={accent.solid} strokeWidth={1.5} fill="none" />
          <Path d={wedge} fill={accent.solid} />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** A plain text field: an icon, the words, and a line that draws itself across when you're typing. */
function Field({ icon, value, onChangeText, placeholder }: { icon: IconName; value: string; onChangeText: (text: string) => void; placeholder: string }) {
  const { colors, accent } = useTheme();
  const body = useType("body");
  const draw = useSharedValue(0);
  const line = useAnimatedStyle(() => ({ transform: [{ scaleX: draw.value }] }));
  return (
    <View>
      <View style={styles.fieldRow}>
        <View style={[styles.slot, { alignSelf: "flex-start", height: body.lineHeight, marginTop: space[3] }]}>
          <Icon name={icon} size={18} color={colors.ink3} weight="medium" />
        </View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.ink3}
          multiline
          selectionColor={accent.solid}
          cursorColor={accent.solid}
          onFocus={() => {
            draw.value = withTiming(1, { duration: duration.enter, easing: easeOut });
          }}
          onBlur={() => {
            draw.value = withTiming(0, { duration: duration.quick, easing: easeOut });
          }}
          style={[body, styles.input, { color: colors.ink }]}
        />
      </View>
      <View style={styles.rule}>
        <Animated.View style={[styles.draw, { backgroundColor: accent.solid }, line]} />
      </View>
    </View>
  );
}

/** What focus time shows: the task, its first step, the minutes left and when it ends. Drawn twice, once per ink. */
function Readout({
  ink,
  soft,
  task,
  step,
  minutes,
  until,
  running,
  top,
}: {
  ink: string;
  soft: string;
  task: string;
  step: string;
  minutes: string;
  until: string;
  running: boolean;
  top: number;
}) {
  return (
    <View style={[styles.readout, { paddingTop: top + space[6] }]}>
      <Txt variant="title1" numberOfLines={3} style={{ color: ink }}>
        {task}
      </Txt>
      {step.trim() ? (
        <View style={styles.stepRow}>
          <Icon name="flag" size={15} color={soft} weight="medium" />
          <Txt variant="subhead" numberOfLines={2} style={[styles.flex, { color: soft }]}>
            {step.trim()}
          </Txt>
        </View>
      ) : null}
      <View style={styles.readTime}>
        <Roll value={minutes} variant="numerals" color={ink} accessibilityLabel={`${minutes} minutes left`} />
        <View style={styles.until}>
          {running ? null : <Icon name="pause" size={14} color={soft} weight="semibold" />}
          <Txt variant="subhead" style={{ color: soft }}>
            {running ? `${minutes === "1" || minutes === "<1" ? "minute" : "minutes"} left · until ${until}` : "Paused"}
          </Txt>
        </View>
      </View>
    </View>
  );
}

/** A round control that sits on the ink or the canvas: a dark disc with a pale icon. */
function RoomButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={label} scaleTo={0.9} style={[styles.round, { backgroundColor: colors.ink, borderColor: DISC_EDGE }]}>
      <Icon name={icon} size={21} color={colors.page} weight="semibold" />
    </PressableScale>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const STOP = 52;
const STROKE = 3;
const STOP_R = (STOP - STROKE) / 2;
const STOP_C = 2 * Math.PI * STOP_R;

/**
 * Stopping early is deliberate: hold, and a ring draws itself round the
 * button over a second and a bit; let go sooner and it winds back. A tap
 * says how it works. VoiceOver's activate stops at once.
 */
function HoldToStop({ onStop }: { onStop: () => void }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const fill = useSharedValue(0);
  const [hint, setHint] = useState("");
  const since = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clear, []);
  useAnimatedReaction(
    () => fill.value >= 1,
    (full, was) => {
      if (full && !was) scheduleOnRN(onStop);
    },
  );
  const ring = useAnimatedProps(() => ({ strokeDashoffset: STOP_C * (1 - fill.value) }));
  const squeeze = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.08 * fill.value }] }));
  return (
    <View style={styles.stopWrap}>
      {hint ? (
        <Animated.View entering={FadeIn.duration(duration.quick)} exiting={FadeOut.duration(duration.quick)} pointerEvents="none" style={styles.hintWrap}>
          <View style={[styles.hint, { backgroundColor: colors.ink, borderColor: DISC_EDGE }]}>
            <Txt variant="footnote" weight="bold" style={{ color: colors.page }}>
              {hint}
            </Txt>
          </View>
        </Animated.View>
      ) : null}
      <Animated.View style={squeeze}>
        <Pressable
          onPressIn={() => {
            tick();
            since.current = Date.now();
            clear();
            timer.current = setTimeout(() => setHint("Keep holding"), 300);
            fill.value = withTiming(1, { duration: HOLD_MS, easing: Easing.linear });
          }}
          onPressOut={() => {
            clear();
            if (fill.value >= 1) return;
            fill.value = withSpring(0, reduced ? calm : spring.settle);
            if (Date.now() - since.current < 300) {
              setHint("Hold to stop");
              timer.current = setTimeout(() => setHint(""), 1_600);
            } else {
              setHint("");
            }
          }}
          accessibilityRole="button"
          accessibilityLabel="Stop early"
          accessibilityHint="Press and hold to stop."
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={(event) => event.nativeEvent.actionName === "activate" && onStop()}
          style={[styles.round, { backgroundColor: colors.ink, borderColor: DISC_EDGE }]}
        >
          <Svg width={STOP} height={STOP} style={styles.ringSvg}>
            <AnimatedCircle cx={STOP / 2} cy={STOP / 2} r={STOP_R} stroke={colors.warm} strokeWidth={STROKE} strokeLinecap="round" fill="none" strokeDasharray={STOP_C} animatedProps={ring} />
          </Svg>
          <Icon name="close" size={19} color={colors.page} weight="semibold" />
        </Pressable>
      </Animated.View>
    </View>
  );
}

/** The break's time, as a bar that empties. */
function BreakBar({ level }: { level: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: level.value }] }));
  return <Animated.View style={[styles.trackFill, { backgroundColor: room.ink }, style]} />;
}

/**
 * How it went, as a shape rather than a colour: a full disc for finished, a
 * half for progress, an empty ring for stuck. The chosen one springs forward
 * and the others step back.
 */
function OutcomeChoice({ kind, label, selected, onPress }: { kind: Outcome; label: string; selected: boolean; onPress: () => void }) {
  const { colors, accent } = useTheme();
  const reduced = useReducedMotion();
  const progress = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    progress.value = withSpring(selected ? 1 : 0, reduced ? calm : spring.pop);
  }, [selected, progress, reduced]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: 0.84 + 0.16 * progress.value }], opacity: Math.min(1, 0.5 + 0.5 * progress.value) }));
  const size = 52;
  const r = size / 2 - 3;
  const colour = selected ? accent.solid : colors.ink2;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" aria-selected={selected} accessibilityLabel={label} style={[styles.outcome, { backgroundColor: colors.card, borderColor: selected ? colors.ink : colors.card }]}>
      <Animated.View style={grow}>
        <Svg width={size} height={size}>
          {kind === "finished" ? <Circle cx={size / 2} cy={size / 2} r={r + 2} fill={colour} /> : null}
          {kind === "progress" ? (
            <>
              <Circle cx={size / 2} cy={size / 2} r={r} stroke={colour} strokeWidth={3} fill="none" />
              <Path d={`M${size / 2} ${size / 2 - r} A${r} ${r} 0 0 0 ${size / 2} ${size / 2 + r} Z`} fill={colour} />
            </>
          ) : null}
          {kind === "stuck" ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={colour} strokeWidth={3} fill="none" /> : null}
        </Svg>
      </Animated.View>
      <Txt variant="footnote" weight={selected ? "bold" : "semibold"} style={[styles.outcomeLabel, { color: selected ? colors.ink : colors.ink2 }]}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** A full-width choice: an icon and one or two words, solid for the way forward and outlined for the other. */
function Action({ icon, label, hint, fill, line, text, onPress }: { icon?: IconName; label: string; hint?: string; fill?: string; line?: string; text: string; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hint ?? label}
      style={[styles.action, fill ? { backgroundColor: fill } : null, line ? { borderColor: line, borderWidth: 1.5 } : null]}
    >
      {icon ? <Icon name={icon} size={17} color={text} weight="semibold" /> : null}
      <Txt variant="headline" style={{ color: text }}>
        {label}
      </Txt>
    </PressableScale>
  );
}

function TextLink({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={styles.link}>
      {({ pressed }) => (
        <Txt variant="callout" weight="bold" style={{ color, opacity: pressed ? 0.5 : 1 }}>
          {label}
        </Txt>
      )}
    </Pressable>
  );
}

/** The first line of where you left off, or whatever follows "Next:". */
function firstStepFrom(leftOff: string | null): string {
  if (!leftOff) return "";
  const next = leftOff.match(/next:\s*(.+)/i);
  const step = (next ? next[1] : leftOff.split("\n")[0]).trim().replace(/\.$/, "");
  return step.charAt(0).toUpperCase() + step.slice(1);
}

/** Three small first steps, six words or fewer, as the app's AI offers them. */
function suggestSteps(title: string): string[] {
  const written: Record<string, string[]> = {
    "Send the brief to Ana": ["Check the quote for VAT", "Write the budget section", "Draft the opening line"],
    "Renew the passport": ["Find the renewal form", "Check the photo rules", "Find the old passport"],
    "Book the dentist": ["Find the surgery's number", "Check next week's free mornings", "Call before lunch"],
    "Call Mum back": ["Find the photos from June", "Note two things to ask", "Make a cup of tea"],
    "Draft the onboarding copy": ["List the three screens", "Write the first headline", "Cut one sentence"],
  };
  return written[title] ?? ["Open what you need", "Write one rough line", "List the first three steps"];
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  missing: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3], padding: edge },
  page: { gap: space[6] },
  padded: { paddingHorizontal: edge },
  top: { paddingHorizontal: edge - 11, minHeight: 44, alignItems: "flex-start", justifyContent: "center" },
  heading: { gap: space[2], alignItems: "center" },
  area: { flexDirection: "row", alignItems: "center", gap: 7 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  slot: { width: SLOT, alignItems: "center", justifyContent: "center" },
  block: { gap: space[3] },
  lengthBlock: { gap: space[3] },
  lengths: { flexDirection: "row", gap: space[3], paddingHorizontal: edge },
  length: { flex: 1, alignItems: "center", gap: 2, paddingVertical: space[4], borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1.5 },
  stepBlock: { gap: space[3] },
  stepCard: { paddingHorizontal: pad, paddingVertical: space[1] },
  ideas: { flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "center", paddingHorizontal: edge },
  tea: { alignItems: "center", marginTop: space[2] },
  dial: { width: DIAL, height: DIAL },
  fieldRow: { flexDirection: "row", gap: space[3] },
  input: { flex: 1, minHeight: 48, paddingVertical: space[3], textAlignVertical: "top", outlineWidth: 0 },
  rule: { height: 1.5, justifyContent: "flex-end" },
  draw: { position: "absolute", left: 0, right: 0, bottom: 0, height: 1.5, transformOrigin: "left" },
  idea: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 12 },
  breakRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: pad, paddingVertical: space[3] },
  sticky: { position: "absolute", left: 0, right: 0, bottom: 0, paddingTop: space[8], alignItems: "center" },
  start: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], height: 56, alignSelf: "stretch", marginHorizontal: edge, borderRadius: radius.button, borderCurve: "continuous" },
  readout: { flex: 1, paddingHorizontal: edge },
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: space[2], marginTop: space[3] },
  readTime: { position: "absolute", left: edge, right: edge, bottom: 200, gap: 2 },
  until: { flexDirection: "row", alignItems: "center", gap: 6 },
  controlsWrap: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, justifyContent: "flex-end" },
  controls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[8] },
  round: { width: STOP, height: STOP, borderRadius: STOP / 2, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  pause: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  ringSvg: { position: "absolute", top: -1, left: -1, transform: [{ rotate: "-90deg" }] },
  stopWrap: { alignItems: "center" },
  hintWrap: { position: "absolute", bottom: STOP + space[3], width: 200, alignItems: "center" },
  hint: { height: 32, paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  parkedPill: { position: "absolute", left: 0, right: 0 },
  park: { marginHorizontal: space[3], paddingTop: space[3], paddingHorizontal: space[4], paddingBottom: space[2], borderRadius: radius.lg, borderCurve: "continuous" },
  parkInput: { minHeight: 64, maxHeight: 160, paddingVertical: space[2], outlineWidth: 0 },
  parkButtons: { flexDirection: "row", alignItems: "center", gap: space[2], marginLeft: -space[3] },
  parkNote: { flex: 1 },
  save: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  spent: { flexDirection: "row", alignItems: "center", gap: space[2] },
  outcomes: { flexDirection: "row", gap: space[3], paddingHorizontal: edge },
  outcome: { flex: 1, alignItems: "center", gap: space[2], paddingVertical: space[4], borderRadius: radius.card, borderCurve: "continuous", borderWidth: 1.5 },
  outcomeLabel: { textAlign: "center" },
  actions: { gap: space[3] },
  action: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space[2], height: 54, borderRadius: radius.button, borderCurve: "continuous" },
  link: { alignSelf: "center", paddingVertical: space[2] },
  closeRoom: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  breakContent: { gap: space[6], paddingBottom: space[6] },
  breakTime: { marginTop: space[4], gap: space[2] },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: space[3] },
  trackFill: { height: 4, borderRadius: 2, transformOrigin: "left" },
  breakLine: { marginTop: space[2] },
  roomRule: { height: StyleSheet.hairlineWidth, marginLeft: INSET, marginRight: edge },
  roomIdea: { flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: edge, paddingVertical: 14 },
  backNote: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
});
