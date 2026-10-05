import React from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, interpolate, useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { duration, easeOut } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge } from "../theme/tokens";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/**
 * The top of a page, as Rosebud has it: the page's name small and centred,
 * an icon at either side, all on the page colour. It stays put; content
 * scrolls under it, and once anything has, a hairline draws under the bar.
 * `onTitle` makes the name a button with a small chevron (a month that
 * opens the calendar). `children` hang under the bar, inside it (the week).
 */
export function TopBar({
  title,
  subtitle,
  onTitle,
  titleLabel,
  left,
  right,
  scrollY,
  changeKey,
  children,
  style,
}: {
  title: string;
  /** A small grey line under the name (Today's full date). */
  subtitle?: string;
  onTitle?: () => void;
  titleLabel?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  scrollY?: SharedValue<number>;
  /** When this changes the title cross-fades (a new month). */
  changeKey?: string;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const rule = useAnimatedStyle(() => ({ opacity: interpolate(scrollY?.value ?? 0, [0, 10], [0, 1], "clamp") }));
  const name = (pressed = false) => (
    <Animated.View key={changeKey} entering={changeKey ? FadeIn.duration(duration.base).easing(easeOut) : undefined} style={[styles.names, { opacity: pressed ? 0.55 : 1 }]}>
      <View style={styles.name}>
        <Txt variant="headline" numberOfLines={1} accessibilityRole="header">
          {title}
        </Txt>
        {onTitle ? <Icon name="down" size={13} color={colors.ink2} weight="bold" /> : null}
      </View>
      {subtitle ? (
        <Txt variant="footnote" tone="ink3" numberOfLines={1}>
          {subtitle}
        </Txt>
      ) : null}
    </Animated.View>
  );
  return (
    <View style={[styles.wrap, { paddingTop: insets.top, backgroundColor: colors.page }, style]}>
      <View style={[styles.bar, subtitle ? styles.tall : null]}>
        <View style={styles.side}>{left}</View>
        <View style={styles.middle}>
          {onTitle ? (
            <Pressable onPress={onTitle} accessibilityRole="button" accessibilityLabel={titleLabel ?? title} hitSlop={10}>
              {({ pressed }) => name(pressed)}
            </Pressable>
          ) : (
            name()
          )}
        </View>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
      {children}
      <Animated.View pointerEvents="none" style={[styles.rule, { backgroundColor: colors.line }, rule]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { zIndex: 2 },
  bar: { height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: edge - 10 },
  side: { width: 96, flexDirection: "row", alignItems: "center" },
  right: { justifyContent: "flex-end" },
  middle: { flex: 1, alignItems: "center" },
  tall: { height: 54 },
  names: { alignItems: "center" },
  name: { flexDirection: "row", alignItems: "center", gap: 5 },
  rule: { position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
