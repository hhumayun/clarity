import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useHeldWhileOpen, usePresence } from "../hooks/usePresence";
import { MOTION } from "./motion";

/**
 * A row that unfolds by growing its own height, and folds away by shrinking
 * it, so everything around it moves with it frame by frame.
 *
 * This replaces a layout transition on the container plus `exiting` on the
 * row, which looked wrong in a box pinned to the keyboard: the container's
 * background animated while its contents jumped, so the screen behind showed
 * through; and a leaving row's fading copy stayed put while the row beneath
 * jumped up into it.
 */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const { mounted, progress } = usePresence(open, { enterMs: MOTION.base, exitMs: MOTION.base });
  const shown = useHeldWhileOpen(open, children);
  const contentHeight = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    height: contentHeight.value * progress.value,
    opacity: progress.value,
  }));
  if (!mounted) return null;
  return (
    <Animated.View style={[styles.clip, style]}>
      {/* Absolute, so the content keeps its natural height to be measured
          while the wrapper around it is still small. */}
      <View
        style={styles.content}
        onLayout={(event) => {
          contentHeight.value = event.nativeEvent.layout.height;
        }}
      >
        {shown}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  content: { position: "absolute", top: 0, left: 0, right: 0 },
});
