import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useTasks } from "../hooks/useTasks";
import { readReminderData } from "../lib/notifications";
import { DONE_ACTION, reconcileReminders, setUpReminderActions, SNOOZE_ACTION, snoozeReminder } from "../lib/reminders";
import { useToast } from "./ToastProvider";

// Changes often come in runs (a task edited field by field, a list
// refetched): schedule once they settle.
const SETTLE_MS = 800;

// Each answer to a reminder is acted on once, though it can arrive both as
// the app's launch response and through the listener.
const handled = new Set<string>();

/**
 * Keeps this phone's reminders in step with its tasks, and answers them: a
 * tap opens the task, Done ticks it off (a repeating task moves on to its
 * next time), Snooze brings it back in an hour.
 *
 * Draws nothing. It sits beside the signed-in screens rather than around
 * them, so its re-renders (on every task change) touch nothing else.
 */
export function Reminders() {
  const router = useRouter();
  const toast = useToast();
  const { query, update } = useTasks();
  const tasks = query.data?.tasks;

  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const act = useRef({ router, toast, update });
  act.current = { router, toast, update };

  useEffect(() => {
    void setUpReminderActions();
  }, []);

  // Every time the tasks change. Not before they are known: an empty list
  // would cancel every reminder.
  useEffect(() => {
    if (!tasks) return;
    const timer = setTimeout(() => reconcileReminders(tasks), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [tasks]);

  // Coming back to the app: time has passed, so a repeating reminder may
  // need its next times scheduled.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active" && tasksRef.current) reconcileReminders(tasksRef.current);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const answer = (response: Notifications.NotificationResponse) => {
      const request = response.notification.request;
      const data = readReminderData(request.content.data);
      if (!data) return;
      const key = `${request.identifier}|${response.actionIdentifier}|${response.notification.date}`;
      if (handled.has(key)) return;
      handled.add(key);
      Notifications.clearLastNotificationResponse();
      const { router: nav, toast: say, update: change } = act.current;

      if (response.actionIdentifier === DONE_ACTION) {
        change
          .mutateAsync({ id: data.taskId, status: "done" })
          .then(({ rolledTo }) => {
            // A repeating task says when it is next instead.
            if (!rolledTo) say.show("Marked done");
          })
          .catch(() => say.show("That task could not be marked done. Please try again."));
        return;
      }
      if (response.actionIdentifier === SNOOZE_ACTION) {
        void snoozeReminder(request).then(() => say.show("Snoozed for an hour"));
        return;
      }
      // A tap on the reminder itself opens its task.
      nav.navigate({ pathname: "/life-center", params: { task: data.taskId } });
    };

    // Opened by tapping a reminder while the app was closed: answered once
    // the screens are up.
    const launch = Notifications.getLastNotificationResponse();
    const timer = launch ? setTimeout(() => answer(launch), 300) : null;
    const subscription = Notifications.addNotificationResponseReceivedListener(answer);
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return null;
}
