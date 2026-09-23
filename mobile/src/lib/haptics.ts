import * as Haptics from "expo-haptics";

/**
 * The app's few haptics, in one place so they stay consistent. Each is a
 * single light cue, never a pattern, and a failure (a device without a
 * haptic engine) is ignored.
 */

/** A task finished: the "success" tap. */
export function hapticDone() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

/** A task brought back from done: lighter, so undoing never feels like a win. */
export function hapticUndone() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
