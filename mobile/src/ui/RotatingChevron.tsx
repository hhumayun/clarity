import { ChevronDown } from "lucide-react-native";
import React, { useEffect } from "react";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT, MOTION } from "./motion";

/** A chevron that turns to show open or closed, rather than flipping. */
export function RotatingChevron({ open, size = 14, color }: { open: boolean; size?: number; color: string }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withTiming(open ? 1 : 0, { duration: MOTION.base, easing: EASE_OUT });
  }, [open, turn]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <ChevronDown size={size} color={color} />
    </Animated.View>
  );
}
