import React, { createContext, useContext, useEffect } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { useKeyboardHandler, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { type SharedValue, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { EASE_OUT } from "./motion";

/**
 * How long the page takes to make room for the keyboard. The keyboard's own
 * movement is iOS's (about 250 ms) and cannot be changed; the page glides a
 * little slower than that, easing out so it keeps up at the start and settles
 * gently. Raise it to slow the page further.
 */
export const KEYBOARD_GLIDE_MS = 380;

/**
 * The room the view is making for the keyboard right now, in points. A panel
 * that takes the keyboard's place (the suggestion tray) grows by exactly what
 * this shrinks, so whatever sits above them stays put during the swap.
 */
const KeyboardRoomContext = createContext<SharedValue<number> | null>(null);

export function useKeyboardRoom(): SharedValue<number> | null {
  return useContext(KeyboardRoomContext);
}

/**
 * Like a keyboard-avoiding view with "padding", but the page makes room on
 * its own, gentler timing rather than matching the keyboard's quick one.
 * When the keyboard starts to move, the padding glides to where the keyboard
 * is heading. When a finger drags the keyboard down (interactive dismissal),
 * it follows the finger exactly.
 *
 * Fills the space it is given down to the bottom of the screen, like the view
 * it replaces; the keyboard's height is measured from there.
 */
export function GentleKeyboardAvoidingView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const padding = useSharedValue(0);
  // Opened with the keyboard already up: start with its room made.
  const { height: keyboardNow } = useReanimatedKeyboardAnimation();
  useEffect(() => {
    padding.value = Math.max(0, -keyboardNow.value);
  }, [padding, keyboardNow]);

  useKeyboardHandler(
    {
      onStart: (event) => {
        "worklet";
        // Destination values: where the keyboard will be when it stops.
        padding.value = withTiming(event.height, { duration: KEYBOARD_GLIDE_MS, easing: EASE_OUT });
      },
      onInteractive: (event) => {
        "worklet";
        padding.value = event.height;
      },
    },
    [],
  );

  const animated = useAnimatedStyle(() => ({ paddingBottom: padding.value }));
  return (
    <KeyboardRoomContext.Provider value={padding}>
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </KeyboardRoomContext.Provider>
  );
}
