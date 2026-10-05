import { useRouter } from "expo-router";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import React, { useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "../store/store";
import { duration, easeOut, spring } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { radius } from "../theme/tokens";
import { tap, tick } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { Txt } from "./Txt";

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Today", icon: "today" },
  notes: { label: "Notes", icon: "notes" },
  life: { label: "Life", icon: "life" },
  search: { label: "Search", icon: "search" },
};
const BAR = 54;
const FAB = 58;
/** Room above the bar for the dial's choices: touches only land inside a parent, so the + column reaches up this far. */
const REACH = 104;

/**
 * Rosebud's bar, adapted: a flat white bar across the bottom with four
 * places and the round + in the middle, raised a little above the line.
 * The chosen tab is ink and filled; the rest are grey outlines; a chosen
 * icon gives a small pop. Tabs never slide. The + opens a small dial
 * rather than guessing: the + turns into ×, the page dims, and "Note" and
 * "Task" spring out of it in a little arc.
 */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors, accent } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduced = useReducedMotion();
  const viewDay = useStore((s) => s.viewDay);
  const [open, setOpen] = useState(false);
  const dial = useSharedValue(0);
  const bottom = Math.max(insets.bottom, 10);

  useEffect(() => {
    dial.value = reduced ? withTiming(open ? 1 : 0, { duration: duration.base }) : open ? withSpring(1, spring.bloom) : withTiming(0, { duration: duration.quick, easing: easeOut });
  }, [open, dial, reduced]);

  // Android's back closes the dial first.
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const routes = state.routes;
  const half = Math.ceil(routes.length / 2);
  const tab = (route: (typeof routes)[number], index: number) => {
    const meta = TABS[route.name] ?? { label: route.name, icon: "notes" as IconName };
    const selected = index === state.index;
    return (
      <TabButton
        key={route.key}
        label={meta.label}
        icon={meta.icon}
        selected={selected}
        onPress={() => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!selected && !event.defaultPrevented) {
            tick();
            navigation.navigate(route.name);
          }
        }}
      />
    );
  };

  const plus = useAnimatedStyle(() => ({ transform: [{ rotate: `${dial.value * 135}deg` }] }));
  const scrim = useAnimatedStyle(() => ({ opacity: interpolate(dial.value, [0, 1], [0, 1], "clamp") }));

  const choose = (to: string) => {
    tick();
    setOpen(false);
    setTimeout(() => router.push(to), reduced ? 0 : 90);
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {/* Always there, so it can fade out as the dial folds; it only takes touches while open. */}
      <Animated.View pointerEvents={open ? "auto" : "none"} style={[StyleSheet.absoluteFill, scrim]}>
        <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" accessibilityElementsHidden={!open} importantForAccessibility={open ? "auto" : "no-hide-descendants"} style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} />
      </Animated.View>

      <View pointerEvents="box-none" style={[styles.dock, { paddingBottom: bottom }]}>
        <View style={[styles.bar, { backgroundColor: colors.card, borderTopColor: colors.line, paddingBottom: bottom, height: BAR + bottom }]} />
        <View pointerEvents="box-none" style={styles.row}>
          {routes.slice(0, half).map((route, i) => tab(route, i))}
          <View style={styles.centre} pointerEvents="box-none">
            <DialOption open={open} dial={dial} side={-1} icon="pen" label="Note" onPress={() => choose("/note/new")} />
            <DialOption open={open} dial={dial} side={1} icon="checkCircle" label="Task" onPress={() => choose(`/quick-add?day=${viewDay}`)} />
            <Pressable
              onPress={() => {
                tap();
                setOpen((v) => !v);
              }}
              accessibilityRole="button"
              accessibilityLabel={open ? "Close" : "New note or task"}
              aria-expanded={open}
              style={({ pressed }) => [styles.fab, { backgroundColor: accent.solid, boxShadow: colors.shadow, transform: [{ scale: pressed ? 0.93 : 1 }] }]}
            >
              <Animated.View style={plus}>
                <Icon name="plus" size={28} color={accent.on} weight="bold" />
              </Animated.View>
            </Pressable>
          </View>
          {routes.slice(half).map((route, i) => tab(route, half + i))}
        </View>
      </View>
    </View>
  );
}

/** One of the dial's two choices: it springs out of the + to its place in the arc, and folds back in when the dial closes. */
function DialOption({ open, dial, side, icon, label, onPress }: { open: boolean; dial: { value: number }; side: -1 | 1; icon: IconName; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => {
    const v = Math.max(0, dial.value);
    return {
      opacity: Math.min(1, v * 1.4),
      transform: [{ translateX: reduced ? side * 70 : side * 70 * v }, { translateY: reduced ? -86 : -86 * v }, { scale: reduced ? 1 : 0.5 + 0.5 * v }],
    };
  });
  return (
    <Animated.View pointerEvents={open ? "auto" : "none"} style={[styles.option, style]}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`New ${label.toLowerCase()}`} style={({ pressed }) => [styles.optionPill, { backgroundColor: colors.raised, boxShadow: colors.shadow, transform: [{ scale: pressed ? 0.95 : 1 }] }]}>
        <Icon name={icon} size={18} color={colors.ink} weight="semibold" />
        <Txt variant="headline">{label}</Txt>
      </Pressable>
    </Animated.View>
  );
}

function TabButton({ label, icon, selected, onPress }: { label: string; icon: IconName; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pop = useSharedValue(1);
  const first = React.useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (selected && !reduced) pop.value = withSequence(withTiming(0.84, { duration: duration.press, easing: easeOut }), withDelay(10, withSpring(1, spring.pop)));
  }, [selected, pop, reduced]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const color = selected ? colors.ink : colors.ink3;
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" aria-selected={selected} accessibilityLabel={label} style={styles.tab}>
      <Animated.View style={style}>
        <Icon name={icon} size={24} color={color} weight={selected ? "semibold" : "medium"} fill={selected} />
      </Animated.View>
      <Txt variant="caption" style={{ color, fontSize: 11, lineHeight: 14 }}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dock: { position: "absolute", left: 0, right: 0, bottom: 0 },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", alignItems: "flex-end", height: BAR + REACH },
  tab: { flex: 1, height: BAR, alignItems: "center", justifyContent: "center", gap: 2, paddingTop: 2 },
  centre: { flex: 1, height: BAR + REACH, alignItems: "center", justifyContent: "flex-end" },
  fab: { width: FAB, height: FAB, borderRadius: FAB / 2, alignItems: "center", justifyContent: "center", marginBottom: BAR - FAB + 12 },
  option: { position: "absolute", bottom: BAR - FAB + 12 + 4, alignItems: "center" },
  optionPill: { flexDirection: "row", alignItems: "center", gap: 8, height: 50, paddingHorizontal: 20, borderRadius: radius.pill, borderCurve: "continuous" },
});

export const TAB_BAR_HEIGHT = BAR;
