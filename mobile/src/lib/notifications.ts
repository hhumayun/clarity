import * as Notifications from "expo-notifications";

/**
 * What the app's notifications share: the one handler deciding how they show
 * while the app is open, and asking for permission. Focus time's end alert
 * and task reminders both go through here.
 */

/** What a reminder carries, so the app can tell its own reminders apart. */
export type ReminderData = { kind: "reminder" | "snooze"; taskId: string; at: number };

export function readReminderData(data: unknown): ReminderData | null {
  if (!data || typeof data !== "object") return null;
  const { kind, taskId, at } = data as Record<string, unknown>;
  if ((kind === "reminder" || kind === "snooze") && typeof taskId === "string" && typeof at === "number") {
    return { kind, taskId, at };
  }
  return null;
}

// While the app is open, a reminder still shows and sounds: it is usually
// about something not on screen. Focus time's alert stays quiet, as the
// focus screen plays its own chime.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const reminder = readReminderData(notification.request.content.data) !== null;
    return {
      shouldShowBanner: reminder,
      shouldShowList: true,
      shouldPlaySound: reminder,
      shouldSetBadge: false,
    };
  },
});

let asked = false;

/**
 * Ask once, the first time something needs to notify (focus time, or a
 * reminder being set). A "no" is respected: never asked again.
 */
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
