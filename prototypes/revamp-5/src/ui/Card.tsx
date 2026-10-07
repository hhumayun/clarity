import React, { Children, Fragment, isValidElement } from "react";
import { Pressable, StyleSheet, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { arrive, calm, duration, easeOut, fadeTiming, keep, leave, spring, squash } from "../theme/motion";
import { useTheme } from "../theme/ThemeProvider";
import { edge, pad, radius } from "../theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A card: what you wrote sits on one. White on the warm grey page, 18
 * corners, no border and the faintest lift. Pressable cards give a little
 * under a finger and spring back; they never change colour.
 */
export function Card({
  children,
  style,
  inset = true,
  onPress,
  onLongPress,
  ...rest
}: Omit<PressableProps, "style" | "children"> & { children: React.ReactNode; style?: StyleProp<ViewStyle>; inset?: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const surface = [styles.card, { backgroundColor: colors.card, boxShadow: colors.cardShadow }, inset && styles.inset, style];
  if (!onPress && !onLongPress) return <View style={surface}>{children}</View>;
  return (
    <AnimatedPressable
      {...rest}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={(event) => {
        scale.value = withTiming(squash, { duration: duration.press, easing: easeOut, reduceMotion: keep });
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { ...(reduced ? calm : spring.pop), reduceMotion: keep });
        rest.onPressOut?.(event);
      }}
      style={[surface, press]}
    >
      {children}
    </AnimatedPressable>
  );
}

/**
 * Rows on one card, a hairline between each. Children that are null are
 * skipped, so a group can be built with conditions.
 */
export function CardGroup({ children, style, inset = true, moving = false }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; inset?: boolean; moving?: boolean }) {
  const { colors } = useTheme();
  const items = Children.toArray(children).filter((child) => isValidElement(child));
  if (items.length === 0) return null;
  const keyOf = (child: React.ReactNode, i: number) => (isValidElement(child) && child.key != null ? child.key : i);
  const rule = <View style={[styles.rule, { backgroundColor: colors.hairline }]} />;
  const cardStyle = [styles.card, styles.group, { backgroundColor: colors.card, boxShadow: colors.cardShadow }, inset && styles.inset, style];
  // `moving`: rows that come and go fade, each carrying the hairline above it. The card's section
  // moves it; a movement of its own as well would double it (in the web build).
  if (moving) {
    return (
      <View style={cardStyle}>
        {items.map((child, i) => (
          <Animated.View key={keyOf(child, i)} entering={arrive} exiting={leave}>
            {i > 0 ? rule : null}
            {child}
          </Animated.View>
        ))}
      </View>
    );
  }
  return (
    <View style={cardStyle}>
      {items.map((child, i) => (
        <Fragment key={keyOf(child, i)}>
          {i > 0 ? rule : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * A row inside a card that can be pressed. Rows wash, they don't squash:
 * pressing lays the card's well colour behind the row; letting go fades it.
 */
export function CardRow({ children, style, ...rest }: Omit<PressableProps, "style" | "children"> & { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const wash = useSharedValue(0);
  const washStyle = useAnimatedStyle(() => ({ opacity: wash.value }));
  return (
    <Pressable
      {...rest}
      onPressIn={(event) => {
        wash.value = withTiming(1, fadeTiming(duration.press));
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        wash.value = withTiming(0, fadeTiming(duration.base));
        rest.onPressOut?.(event);
      }}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.sunken }, washStyle]} />
      <View style={[styles.row, style]}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.card, borderCurve: "continuous" },
  group: { overflow: "hidden" },
  inset: { marginHorizontal: edge },
  rule: { height: 1 },
  row: { paddingHorizontal: pad },
});
