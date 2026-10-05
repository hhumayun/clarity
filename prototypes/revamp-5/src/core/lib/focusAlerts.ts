import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { ensureNotificationPermission } from "./notifications";

/**
 * How focus time says it is over: a soft haptic and a short chime while the
 * app is open, and a quiet local notification if it is not. Never an alarm.
 * (While the app is open the notification shows no banner: see
 * notifications.ts.)
 */

export { ensureNotificationPermission };

export async function scheduleEndAlert(at: number, title: string, body: string): Promise<string | null> {
  try {
    if (at <= Date.now()) return null;
    return await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    return null;
  }
}

export async function cancelEndAlert(id: string | null) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered, or never scheduled: nothing to undo.
  }
}

export function softHaptic() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
