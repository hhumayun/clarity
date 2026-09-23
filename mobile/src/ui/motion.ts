import { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

/**
 * One vocabulary for movement, so the app moves the same way everywhere.
 * Short and eased out: things arrive quickly and settle, never bounce.
 * Reanimated honours the phone's Reduce Motion setting for all of these.
 */
export const MOTION = {
  fast: 160,
  base: 220,
  slow: 280,
} as const;

export const EASE_OUT = Easing.out(Easing.cubic);
export const EASE_IN = Easing.in(Easing.cubic);

/** Neighbours slide into place when something above them grows or goes. */
export const layoutTransition = LinearTransition.duration(MOTION.base).easing(EASE_OUT);
export const fadeIn = FadeIn.duration(MOTION.base);
export const fadeInFast = FadeIn.duration(MOTION.fast);
export const fadeOut = FadeOut.duration(MOTION.fast);
