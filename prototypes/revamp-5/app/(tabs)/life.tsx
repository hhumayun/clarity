import { useRouter, useScrollToTop } from "expo-router";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, LinearTransition, useAnimatedRef } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sprout } from "../../src/art/Pictures";
import { groupTasks } from "../../src/store/selectors";
import { useStore } from "../../src/store/store";
import { duration, easeOut } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, pad, radius, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { Button } from "../../src/ui/Button";
import { Card } from "../../src/ui/Card";
import { Chip } from "../../src/ui/Chip";
import { useScrollY } from "../../src/ui/chrome";
import { confirm } from "../../src/ui/confirm";
import { Icon } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { SectionTitle } from "../../src/ui/SectionTitle";
import { DoneFold, TaskCard } from "../../src/ui/TaskCard";
import { TopBar } from "../../src/ui/TopBar";
import { Txt } from "../../src/ui/Txt";

const settle = LinearTransition.duration(duration.enter).easing(easeOut);
const SECTIONS = [
  { key: "today", title: "Today" },
  { key: "week", title: "This week" },
  { key: "later", title: "Later" },
  { key: "undated", title: "Someday" },
] as const;

/**
 * Life Center: every task in one calm place, sorted by when, the way
 * Rosebud lists goals: a centred word for each section and the tasks on a
 * card under it. Areas filter the list from one row of chips under the bar.
 * What slipped is a single card with one way forward. Nothing counts.
 */
export default function LifeCenter() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const acknowledge = useAcknowledge();
  const tasks = useStore((state) => state.tasks);
  const areas = useStore((state) => state.areas);
  const clearCompleted = useStore((state) => state.clearCompleted);
  const { onScroll, scrollY } = useScrollY();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  useScrollToTop(scroller as never);
  const [area, setArea] = useState<string | null>(null);
  const groups = useMemo(() => groupTasks(tasks, area), [tasks, area]);
  const anySlipped = useMemo(() => groupTasks(tasks, null).slipped.length > 0, [tasks]);
  const anyOpen = groups.today.length + groups.week.length + groups.later.length + groups.undated.length > 0;

  const clear = async () => {
    const ok = await confirm({
      title: area ? `Clear finished tasks in ${area}?` : "Clear finished tasks?",
      message: "They will be removed. Your notes are not affected.",
      action: "Clear",
    });
    if (!ok) return;
    clearCompleted(area);
    acknowledge("Cleared", "trash");
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <TopBar title="Life Center" scrollY={scrollY} right={<IconButton icon="sliders" label="Manage areas" onPress={() => router.push("/sheet/areas")} />}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="All" selected={area === null} onPress={() => setArea(null)} />
          {areas.map((item) => (
            <Chip key={item.name} label={item.name} selected={area === item.name} onPress={() => setArea(area === item.name ? null : item.name)} />
          ))}
        </ScrollView>
      </TopBar>

      <Animated.ScrollView
        ref={scroller}
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120, paddingTop: space[4] }}
      >
        {anySlipped ? (
          <Card style={styles.slipped}>
            <View style={[styles.slippedIcon, { backgroundColor: colors.warmSoft }]}>
              <Icon name="rotate" size={18} color={colors.warm} weight="bold" />
            </View>
            <View style={styles.flex}>
              <Txt variant="headline">A few things slipped</Txt>
              <Txt variant="subhead" tone="ink2">
                Pick them up, move them, or let them go.
              </Txt>
            </View>
            <Button label="Catch up" variant="soft" size="sm" onPress={() => router.push("/catch-up")} accessibilityLabel="Catch up on what slipped" />
          </Card>
        ) : null}

        {SECTIONS.map((section, i) =>
          groups[section.key].length ? (
            <Animated.View key={section.key} layout={settle} entering={FadeIn.duration(duration.base)}>
              <SectionTitle title={section.title} first={i === 0 && !anySlipped} />
              <TaskCard tasks={groups[section.key]} variant={section.key === "today" ? "day" : "list"} showArea={!area} />
            </Animated.View>
          ) : null,
        )}
        {!anyOpen ? (
          <Animated.View entering={FadeIn.duration(duration.enter).easing(easeOut)} style={styles.empty}>
            <Sprout size={104} />
            <Txt variant="headline" center>
              {tasks.length === 0 ? "Nothing here yet" : area ? `Nothing waiting in ${area}` : "All clear"}
            </Txt>
            <Txt variant="subhead" tone="ink3" center style={styles.emptyText}>
              {tasks.length === 0 ? "Tasks you add, or find in your notes, gather here." : "Enjoy the quiet."}
            </Txt>
          </Animated.View>
        ) : null}
        <View style={styles.fold}>
          <DoneFold tasks={groups.done} onClear={clear} showArea={!area} />
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1, gap: 2 },
  chips: { gap: space[2], paddingHorizontal: edge, paddingBottom: space[3], alignItems: "center" },
  slipped: { flexDirection: "row", alignItems: "center", gap: space[3], padding: pad, marginTop: space[1] },
  slippedIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space[2], paddingTop: space[10], paddingHorizontal: edge },
  emptyText: { maxWidth: 280 },
  fold: { marginTop: space[3] },
});
