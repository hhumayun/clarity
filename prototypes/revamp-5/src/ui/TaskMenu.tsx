import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dayChoices, dayLabel, type Day } from "../lib/dates";
import { whenLabel } from "../store/selectors";
import { useSage } from "../data/sage";
import { arrive, duration, fadeTiming, reducedAtLaunch } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, radius, space } from "../theme/tokens";
import { useAcknowledge } from "./Acknowledgement";
import { CardRow } from "./Card";
import { Chip } from "./Chip";
import { CircleCheck } from "./CircleCheck";
import { tick } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

type Rect = { x: number; y: number; width: number; height: number };
type Open = { taskId: string; rect: Rect; noteId?: string };

const MenuContext = createContext<(open: Open) => void>(() => {});
const MENU_WIDTH = 250;
/** The lifted row is this much narrower on each side, like a raised card. */
const LIFT_INSET = 8;
const ROW = 44;
const GLYPH = 21;
const GAP = 14;
const DATE_PAGE_HEIGHT = 236;

/** Long-press a task anywhere: open its quick menu. */
export const useTaskMenu = () => useContext(MenuContext);

/**
 * The quick menu: the page dims and softens, the task lifts where it was as
 * a white card, and a short list of icon-and-word rows grows from beside
 * it. "Date" swaps the list for day choices in place. Tap anywhere else to
 * put it back.
 */
export function TaskMenuProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null);
  const show = useCallback((next: Open) => setOpen(next), []);
  return (
    <MenuContext.Provider value={show}>
      {children}
      {open ? <TaskMenu {...open} onClosed={() => setOpen(null)} /> : null}
    </MenuContext.Provider>
  );
}

function TaskMenu({ taskId, rect, noteId, onClosed }: Open & { onClosed: () => void }) {
  const { colors, dark } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const acknowledge = useAcknowledge();
  const task = useSage((state) => state.tasks.find((item) => item.id === taskId));
  const moveTask = useSage((state) => state.moveTask);
  const unlinkNote = useSage((state) => state.unlinkNote);
  const [page, setPage] = useState<"menu" | "date">("menu");
  const swapped = useRef(false);
  const go = (next: "menu" | "date") => {
    swapped.current = true;
    setPage(next);
  };

  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, fadeTiming(duration.base));
  }, [shown]);
  const close = (then?: () => void) => {
    shown.value = withTiming(0, fadeTiming(duration.quick), (finished) => {
      if (finished) scheduleOnRN(onClosed);
    });
    if (then) setTimeout(then, 60);
  };

  const backdrop = useAnimatedStyle(() => ({ opacity: shown.value }));
  const lift = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: reducedAtLaunch ? 1 : 0.97 + 0.03 * shown.value }] }));
  const menu = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ scale: reducedAtLaunch ? 1 : 0.95 + 0.05 * shown.value }] }));

  if (!task) return null;

  const rows: MenuRow[] = [
    { icon: "calendar", label: "Date", value: whenLabel(task), onPress: () => (tick(), go("date")) },
    { icon: "timer", label: "Focus", onPress: () => close(() => router.push(`/focus/${task.id}`)) },
  ];
  if (task.noteIds.length) rows.push({ icon: "doc", label: "Notes", onPress: () => close(() => router.push(`/task/${task.id}`)) });
  rows.push({ icon: "link", label: "Link a note", onPress: () => close(() => router.push(`/sheet/link-note?task=${task.id}`)) });
  const remove: MenuRow | null = noteId
    ? {
        icon: "close",
        label: "Remove from this note",
        danger: true,
        onPress: () =>
          close(() => {
            unlinkNote(task.id, noteId);
            acknowledge("Removed from this note. It's still in Life Center.", "check");
          }),
      }
    : null;

  const move = (day: Day | null) => {
    close(() => {
      moveTask(task.id, day);
      acknowledge(day ? `Moved to ${dayLabel(day)}` : "Date removed", "calendar");
    });
  };

  const menuHeight = page === "menu" ? rows.length * ROW + (remove ? ROW + 6 : 0) + 8 : DATE_PAGE_HEIGHT;
  const top = Math.max(insets.top + space[2], Math.min(rect.y, screenHeight - insets.bottom - rect.height - menuHeight - 24));
  const below = top + rect.height + space[2];
  const menuTop = below + menuHeight < screenHeight - insets.bottom - 12 ? below : Math.max(insets.top + 8, top - menuHeight - space[2]);
  const left = Math.min(Math.max(edge, rect.x + rect.width - MENU_WIDTH), screenWidth - edge - MENU_WIDTH);

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, backdrop]}>
        {Platform.OS === "ios" ? <BlurView intensity={18} tint={dark ? "dark" : "light"} style={StyleSheet.absoluteFill} /> : null}
        <Pressable accessibilityLabel="Close the menu" style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={() => close()} />
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.lifted, { top, left: rect.x + LIFT_INSET, width: rect.width - LIFT_INSET * 2, backgroundColor: colors.raised, boxShadow: colors.shadow }, lift]}>
        <View style={styles.words}>
          <Txt variant="row" tone={task.done ? "ink3" : "ink"} numberOfLines={2}>
            {task.title}
          </Txt>
          <View style={styles.area}>
            <Txt variant="footnote" tone="ink3">
              {task.area}
            </Txt>
          </View>
        </View>
        <CircleCheck on={task.done} />
      </Animated.View>

      <Animated.View style={[styles.menu, { top: menuTop, left, backgroundColor: colors.raised, boxShadow: colors.shadow, transformOrigin: "top right" }, menu]}>
        {page === "menu" ? (
          <Animated.View key="menu" entering={swapped.current ? arrive : undefined}>
            {rows.map((row, i) => (
              <React.Fragment key={row.label}>
                {i > 0 ? <View style={[styles.rule, { backgroundColor: colors.hairline, marginLeft: space[4] + GLYPH + GAP }]} /> : null}
                <MenuItem {...row} />
              </React.Fragment>
            ))}
            {remove ? (
              <>
                <View style={[styles.group, { backgroundColor: colors.sunken }]} />
                <MenuItem {...remove} />
              </>
            ) : null}
          </Animated.View>
        ) : (
          <Animated.View key="date" entering={arrive} style={styles.datePage}>
            <Pressable onPress={() => go("menu")} accessibilityRole="button" accessibilityLabel="Back to the menu" style={styles.dateHead} hitSlop={8}>
              <Icon name="back" size={16} color={colors.ink2} weight="semibold" />
              <Txt variant="headline">Date</Txt>
            </Pressable>
            <View style={styles.chips}>
              {dayChoices().map((choice) => (
                <Chip onCard key={choice.label} label={choice.label} selected={choice.day === task.day} onPress={() => move(choice.day)} />
              ))}
            </View>
            <View style={[styles.rule, { backgroundColor: colors.hairline }]} />
            <MenuItem icon="calendar" label="Pick a date…" onPress={() => close(() => router.push(`/sheet/date?task=${task.id}`))} />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

type MenuRow = { icon: IconName; label: string; value?: string; danger?: boolean; onPress: () => void };

function MenuItem({ icon, label, value, danger, onPress }: MenuRow) {
  const { colors } = useTheme();
  return (
    <CardRow onPress={onPress} accessibilityRole="menuitem" accessibilityLabel={label} style={styles.row}>
      <Icon name={icon} size={GLYPH} color={danger ? colors.danger : colors.ink2} weight="medium" />
      <Txt variant="callout" tone={danger ? "danger" : "ink"} numberOfLines={1} style={styles.rowLabel}>
        {label}
      </Txt>
      {value ? (
        <Txt variant="footnote" tone="ink3" numberOfLines={1} style={styles.value}>
          {value}
        </Txt>
      ) : null}
    </CardRow>
  );
}

const styles = StyleSheet.create({
  lifted: { position: "absolute", flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 13, paddingHorizontal: edge, borderRadius: radius.card, borderCurve: "continuous" },
  words: { flex: 1, gap: 3 },
  area: { flexDirection: "row", alignItems: "center", gap: 5 },
  menu: { position: "absolute", width: MENU_WIDTH, borderRadius: radius.card, borderCurve: "continuous", paddingVertical: 4, overflow: "hidden" },
  row: { height: ROW, flexDirection: "row", alignItems: "center", gap: GAP },
  rowLabel: { flex: 1 },
  value: { maxWidth: 100 },
  group: { height: 6 },
  rule: { height: 1 },
  datePage: { paddingTop: space[2] },
  dateHead: { flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: space[4] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2], paddingHorizontal: space[4], paddingTop: space[1], paddingBottom: space[3] },
});
