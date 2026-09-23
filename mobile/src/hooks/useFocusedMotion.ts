import { useIsFocused } from "expo-router";
import { FadeInDown, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { fadeIn, fadeOut, layoutTransition, MOTION } from "../ui/motion";

const rowIn = FadeInDown.duration(180);
const rowOut = FadeOutUp.duration(140);
const rowLayout = LinearTransition.duration(MOTION.base);

/**
 * List animations, but only while the screen is on screen. Data often
 * changes while a tab is hidden (a task finished in focus time, a catch-up
 * sorted, a refetch), and layout animations computed for a detached screen
 * can leave views misplaced or invisible when you come back. Hidden changes
 * are simply applied; visible ones animate.
 */
export function useFocusedMotion() {
  const focused = useIsFocused();
  return {
    enter: focused ? fadeIn : undefined,
    exit: focused ? fadeOut : undefined,
    layout: focused ? layoutTransition : undefined,
    rowEnter: focused ? rowIn : undefined,
    rowExit: focused ? rowOut : undefined,
    rowLayout: focused ? rowLayout : undefined,
  };
}
