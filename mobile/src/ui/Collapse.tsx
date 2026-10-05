import React, { useState } from "react";
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
export function Collapse({
  open,
  appear = true,
  children,
}: {
  open: boolean;
  /**
   * Whether it unfolds when it is open from the start (the default). False:
   * it is there from the first frame, at its full height, and only later
   * openings unfold.
   */
  appear?: boolean;
  children: React.ReactNode;
}) {
  const { mounted, progress } = usePresence(open, { enterMs: MOTION.base, exitMs: MOTION.base, appear });
  const shown = useHeldWhileOpen(open, children);
  const contentHeight = useSharedValue(0);
  // Open from the start without unfolding: laid out as it is until it has
  // been measured, so it is not missing for a frame.
  const [measured, setMeasured] = useState(appear);
  const style = useAnimatedStyle(
    () => (measured ? { height: contentHeight.value * progress.value, opacity: progress.value } : {}),
    [measured],
  );
  if (!mounted) return null;
  return (
    <Animated.View style={[styles.clip, style]}>
      {/* Absolute, so the content keeps its natural height to be measured
          while the wrapper around it is still small. */}
      <View
        style={measured ? styles.content : null}
        onLayout={(event) => {
          contentHeight.value = event.nativeEvent.layout.height;
          if (!measured) setMeasured(true);
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
