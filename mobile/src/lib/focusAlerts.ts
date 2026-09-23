import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";

/**
 * How focus time says it is over: a soft haptic and a short chime while the
 * app is open, and a quiet local notification if it is not. Never an alarm.
 */

// While the app is in the foreground the screen itself plays the chime, so
// the notification should not also pop a banner over it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let asked = false;

/** Ask once, the first time focus starts. A "no" is respected, silently. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (asked || !current.canAskAgain) return false;
    asked = true;
    const next = await Notifications.requestPermissionsAsync();
    return next.granted;
  } catch {
    return false;
  }
}

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
