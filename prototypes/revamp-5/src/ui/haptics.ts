import * as Haptics from "expo-haptics";

/** Haptics are punctuation: one per action, on the same frame as the visual. Never on web. */
const on = process.env.EXPO_OS === "ios" || process.env.EXPO_OS === "android";
export const tick = () => on && void Haptics.selectionAsync();
export const tap = () => on && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
export const done = () => on && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
