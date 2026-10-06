import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Hourglass } from "../art/Pictures";
import { TimeOfDay } from "../art/TimeOfDay";
import { greetings, questions } from "../data/prompts";
import { today } from "../lib/dates";
import { noteTime, openOn } from "../store/selectors";
import { useDevice } from "../state/device";
import { useSage, useWhenEditable } from "../data/sage";
import { useTheme } from "../theme/ThemeProvider";
import { edge, radius, space } from "../theme/tokens";
import { Card } from "./Card";
import { CircleCheck } from "./CircleCheck";
import { tap } from "./haptics";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/**
 * Today's two ways in, side by side, in the shape of Rosebud's pair of
 * cards but holding Clarity's own two activities: writing to the day's
 * question, and focusing on what's next. Each has its small living
 * picture. They sit on a quieter surface than the tasks, with no lift, so
 * the day's tasks below stay the strongest thing on the page. Once today's page is written its card settles into the page,
 * like a finished thing: the card sinks into the page, the picture dims,
 * the words go grey, and a check pops in. Focus stays open for another session; a small check in
 * its corner says there's been one today.
 */
export function TodayCards() {
  const router = useRouter();
  const { phase, colors } = useTheme();
  const tasks = useSage((state) => state.tasks);
  const notes = useSage((state) => state.notes);
  const pages = useSage((state) => state.pages);
  const focusLength = useDevice((state) => state.prefs.focusLength);
  const focusToday = useSage((state) => state.focusToday);
  const t = today();
  const pageId = pages[t];
  const page = pageId ? notes.find((note) => note.id === pageId) : undefined;
  const next = openOn(tasks, t)[0];
  const whenEditable = useWhenEditable();
  const question = questions[phase][0];

  return (
    <View style={styles.pair}>
      <WriteCard
        title={greetings[phase]}
        question={question}
        written={page ? noteTime(page.time) : null}
        onPress={() => {
          tap();
          if (page) router.push(`/note/${page.id}`);
          else whenEditable(() => router.push(`/note/new?prompt=${encodeURIComponent(question)}&page=1`));
        }}
      />
      <Card
        inset={false}
        onPress={() => {
          tap();
          if (next) router.push(`/focus/${next.id}`);
          else whenEditable(() => router.push(`/quick-add?day=${t}`));
        }}
        accessibilityRole="button"
        accessibilityLabel={next ? `Focus on ${next.title}, ${focusLength} minutes` : "Nothing to focus on. Add a task"}
        style={[styles.card, { backgroundColor: colors.quiet, boxShadow: "none" }]}
      >
        {focusToday > 0 ? (
          <View style={styles.corner} accessibilityLabel="You've focused today">
            <CircleCheck on size={20} />
          </View>
        ) : null}
        <View style={styles.picture}>
          <Hourglass size={54} />
        </View>
        <Txt variant="headline" center style={styles.title}>
          Focus
        </Txt>
        {next ? (
          <>
            <Txt variant="subhead" tone="ink2" center numberOfLines={2} style={styles.sub}>
              {next.title}
            </Txt>
            <View style={styles.meta}>
              <Icon name="timer" size={13} color={colors.ink3} weight="semibold" />
              <Txt variant="footnote" tone="ink3">
                {focusLength} min
              </Txt>
            </View>
          </>
        ) : (
          <Txt variant="subhead" tone="ink2" center numberOfLines={2} style={styles.sub}>
            Add something to work on
          </Txt>
        )}
      </Card>
    </View>
  );
}

function WriteCard({ title, question, written, onPress }: { title: string; question: string; written: string | null; onPress: () => void }) {
  const { colors, phase } = useTheme();
  // The check pops in once you're back on Today, not while the note is still covering it.
  const [shown, setShown] = useState(!!written);
  const before = useRef(!!written);
  useEffect(() => {
    if (!!written === before.current) return;
    before.current = !!written;
    const timer = setTimeout(() => setShown(!!written), written ? 520 : 0);
    return () => clearTimeout(timer);
  }, [written]);
  return (
    <Card
      inset={false}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={written ? `${title}. Today's page, written at ${written}` : `${title}. ${question}`}
      style={[styles.card, { backgroundColor: colors.quiet, boxShadow: "none" }, shown && { backgroundColor: colors.page, borderWidth: 1.5, borderColor: colors.line }]}
    >
      <View style={[styles.picture, shown && styles.resting]}>
        <TimeOfDay phase={phase} size={76} />
      </View>
      <Txt variant="headline" tone={shown ? "ink2" : "ink"} center style={styles.title}>
        {title}
      </Txt>
      {shown ? (
        <View style={styles.done}>
          <PopCheck size={24} />
          <Txt variant="footnote" tone="ink3">
            Written at {written}
          </Txt>
        </View>
      ) : (
        <Txt variant="subhead" tone="ink2" center numberOfLines={3} style={styles.sub}>
          {question}
        </Txt>
      )}
    </Card>
  );
}

/** A check that arrives ticked: it mounts open and ticks itself a beat later, so it pops. */
function PopCheck({ size }: { size: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOn(true), 80);
    return () => clearTimeout(timer);
  }, []);
  return <CircleCheck on={on} size={size} />;
}

const styles = StyleSheet.create({
  pair: { flexDirection: "row", gap: space[3], marginHorizontal: edge },
  card: { flex: 1, minHeight: 150, borderRadius: radius.card + 2, alignItems: "center", paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[4], gap: 2 },
  picture: { height: 58, justifyContent: "center", marginBottom: 2 },
  title: { fontSize: 16, lineHeight: 21 },
  resting: { opacity: 0.6 },
  sub: { paddingHorizontal: 2, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  corner: { position: "absolute", top: 10, right: 10 },
  done: { alignItems: "center", gap: 6, marginTop: 6 },
});
