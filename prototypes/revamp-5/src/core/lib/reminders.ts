import * as Notifications from "expo-notifications";
import type { TaskRecord } from "../types";
import { dateChipLabel } from "./dates";
import { areaTag } from "./lifeCenter";
import { readReminderData, type ReminderData } from "./notifications";
import { dueTimeLabel, wantedReminders } from "./reminderRules";

/**
 * Task reminders as local notifications: the phone schedules them itself,
 * from the tasks it has, so they work offline and need no push service (and
 * so run in Expo Go). The tasks are the truth; what is scheduled is brought
 * in line with them whenever they change and when the app comes back.
 */

export const REMINDER_CATEGORY = "task-reminder";
export const DONE_ACTION = "done";
export const SNOOZE_ACTION = "snooze";
const SNOOZE_MS = 60 * 60 * 1000;

/**
 * Done and Snooze under each reminder. Both open the app, which Expo Go
 * handles reliably; acting in the background would need a build of our own.
 */
export async function setUpReminderActions() {
  try {
    await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
      { identifier: DONE_ACTION, buttonTitle: "Done", options: { opensAppToForeground: true } },
      { identifier: SNOOZE_ACTION, buttonTitle: "Snooze 1 hour", options: { opensAppToForeground: true } },
    ]);
  } catch {
    // The reminder still shows, without its buttons.
  }
}

/**
 * Under the task's words, when it is due as seen from when the reminder goes
 * off ("Today at 3:00 pm", "Due tomorrow"), then its area.
 */
function bodyFor(task: Pick<TaskRecord, "projectName" | "dueTime">, day: Date, at: number): string {
  const when = dateChipLabel(day, new Date(at));
  const due = task.dueTime ? `${when} at ${dueTimeLabel(task.dueTime)}` : `Due ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
  return [due, task.projectName ? areaTag(task.projectName) : ""].filter(Boolean).join(" · ");
}

async function schedule(identifier: string, title: string, body: string, data: ReminderData) {
  try {
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title, body, sound: true, data, categoryIdentifier: REMINDER_CATEGORY },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data.at },
    });
  } catch {
    // A time that passed while scheduling, or notifications unavailable.
  }
}

async function cancel(identifier: string) {
  try {
    await Notifications.cancelScheduledNotificationAsync(identifier);
  } catch {
    // Already delivered or gone.
  }
}

async function reconcileOnce(tasks: TaskRecord[]) {
  try {
    const [permission, waiting, shown] = await Promise.all([
      Notifications.getPermissionsAsync(),
      Notifications.getAllScheduledNotificationsAsync(),
      Notifications.getPresentedNotificationsAsync(),
    ]);
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const isOpen = (taskId: string) => {
      const task = byId.get(taskId);
      return Boolean(task && task.status !== "done");
    };
    const wanted = permission.granted ? wantedReminders(tasks) : [];
    const wantedByKey = new Map(wanted.map((item) => [item.key, item]));

    // What is already waiting stays if it is still wanted, word for word.
    const have = new Set<string>();
    for (const request of waiting) {
      const data = readReminderData(request.content.data);
      if (!data) continue; // Not a reminder (focus time's alert).
      if (data.kind === "snooze") {
        if (!isOpen(data.taskId)) await cancel(request.identifier);
        continue;
      }
      const task = byId.get(data.taskId);
      const key = `${data.taskId}:${data.at}`;
      const want = wantedByKey.get(key);
      const current =
        task && want && request.content.title === task.text && (request.content.body ?? "") === bodyFor(task, want.day, want.at);
      if (current) have.add(key);
      else await cancel(request.identifier);
    }

    for (const item of wanted) {
      if (have.has(item.key)) continue;
      const task = byId.get(item.taskId);
      if (!task) continue;
      await schedule(`reminder:${item.key}`, task.text, bodyFor(task, item.day, item.at), {
        kind: "reminder",
        taskId: task.id,
        at: item.at,
      });
    }

    // Reminders already shown for tasks since done or deleted leave the
    // notification list.
    for (const notification of shown) {
      const data = readReminderData(notification.request.content.data);
      if (data && !isOpen(data.taskId)) {
        await Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {});
      }
    }
  } catch {
    // Notifications unavailable just now: the next change tries again.
  }
}

let running = false;
let latest: TaskRecord[] | null = null;

/**
 * Bring the phone's waiting reminders in line with the tasks: schedule what
 * is missing, cancel what is no longer wanted (or whose words changed), and
 * drop snoozes of tasks now done or gone. `tasks` must be every task, as
 * one missing from it loses its reminders. One run at a time; a call during
 * a run is picked up after it, with the latest tasks.
 */
export function reconcileReminders(tasks: TaskRecord[]) {
  latest = tasks;
  if (running) return;
  running = true;
  void (async () => {
    try {
      while (latest) {
        const next = latest;
        latest = null;
        await reconcileOnce(next);
      }
    } finally {
      running = false;
    }
  })();
}

/** "Snooze 1 hour": the same reminder again in an hour, on this phone only. */
export async function snoozeReminder(request: Notifications.NotificationRequest) {
  const data = readReminderData(request.content.data);
  if (!data) return;
  const at = Date.now() + SNOOZE_MS;
  await schedule(`snooze:${data.taskId}:${at}`, request.content.title ?? "", request.content.body ?? "", {
    kind: "snooze",
    taskId: data.taskId,
    at,
  });
}

/** Signing out: this person's reminders leave the phone. */
export async function cancelAllReminders() {
  try {
    const waiting = await Notifications.getAllScheduledNotificationsAsync();
    for (const request of waiting) {
      if (readReminderData(request.content.data)) await cancel(request.identifier);
    }
  } catch {
    // Nothing scheduled, or notifications unavailable.
  }
}
