import React from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { calm, duration, easeOut, keep, spring, squash } from "../theme/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Press feedback for cards and buttons: a quick squash on press-in, then a
 * spring back that overshoots a hair, like something with a little give.
 * List rows dim instead; bar buttons only dim.
 */
export function PressableScale({
  style,
  scaleTo = squash,
  children,
  ...rest
}: Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle>; scaleTo?: number; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        scale.value = withTiming(scaleTo, { duration: duration.press, easing: easeOut, reduceMotion: keep });
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { ...(reduced ? calm : spring.pop), reduceMotion: keep });
        rest.onPressOut?.(event);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
