import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { radius } from "../theme";
import { useAppTheme } from "../providers/AppThemeProvider";

export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[styles.box, { backgroundColor: colors.muted, opacity }, style]}
    />
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: radius.md,
    minHeight: 20,
  },
});
