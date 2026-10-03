import { useRouter } from "expo-router";
import React from "react";
import { useAfterExit } from "../hooks/useAfterExit";
import { useTasks } from "../hooks/useTasks";
import { dateChipLabel } from "../lib/dates";
import { dueTimeLabel } from "../lib/reminderRules";
import { useToast } from "../providers/ToastProvider";
import type { TaskRecord } from "../types";
import { TaskMenu } from "./TaskMenu";

type Props = {
  /** The task pressed and held, or null when the menu is closed. */
  task: TaskRecord | null;
  onClose: () => void;
  /** The note whose tasks these are: offers "Remove from this note". */
  noteId?: string | null;
};

/**
 * A task's quick menu, wired the same wherever tasks are listed: move it to
 * another day, start focus time, open it at its notes or at linking one, and
 * in a note's own tasks, take it out of that note.
 */
export function TaskQuickMenu({ task, onClose, noteId }: Props) {
  const router = useRouter();
  const toast = useToast();
  // Only its changes are wanted here; the lists load the tasks themselves.
  const { update, link } = useTasks(undefined, false);
  const after = useAfterExit();

  return (
    <TaskMenu
      task={task}
      dueLabel={
        task?.completeBy
          ? `${dateChipLabel(task.completeBy)}${task.dueTime ? `, ${dueTimeLabel(task.dueTime)}` : ""}`
          : "None"
      }
      onClose={onClose}
      onMove={(moved, date) => {
        onClose();
        // It often leaves the list on screen, so say where it went once it has.
        update.mutate(
          { id: moved.id, completeBy: date },
          {
            onSuccess: () => toast.show(date ? `Moved to ${dateChipLabel(date)}.` : "Date removed."),
            onError: () => toast.show("That task could not be moved. Please try again."),
          },
        );
      }}
      onFocus={(chosen) => {
        onClose();
        router.push(`/focus/${chosen.id}`);
      }}
      onNotes={(chosen) => {
        onClose();
        after.later(() => router.push(`/task/${chosen.id}`));
      }}
      onLinkNote={(chosen) => {
        onClose();
        after.later(() => router.push(`/task/${chosen.id}?link=1`));
      }}
      onUnlink={
        noteId
          ? (chosen) => {
              onClose();
              link.mutate(
                { taskId: chosen.id, noteId, linked: false },
                {
                  onSuccess: () => toast.show("Removed from this note. It is still in Life Center."),
                  onError: () => toast.show("That task could not be removed. Please try again."),
                },
              );
            }
          : undefined
      }
      onExited={after.run}
    />
  );
}
