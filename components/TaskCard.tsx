import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Check,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { TaskRecord } from "../helpers/TaskRecord";
import { TASK_STATUS_LABELS, TASK_STATUS_VALUES } from "../helpers/TaskRecord";
import type { TaskStatus } from "../helpers/schema";
import { dueState, formatDue } from "../helpers/taskDates";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./DropdownMenu";
import styles from "./TaskCard.module.css";

interface TaskCardProps {
  task: TaskRecord;
  /** Hide the project chip when every card on screen shares one project. */
  showProject?: boolean;
  /** Hide the note link when the card is already shown inside that note. */
  showNoteLink?: boolean;
  className?: string;
  onStatusChange: (status: TaskStatus) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

/**
 * Read-first task card: one big circle to finish it, the text, a few quiet
 * chips, and a single menu for everything else. Editing happens in a
 * dialog so the board stays calm.
 */
export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  showProject = true,
  showNoteLink = true,
  className,
  onStatusChange,
  onEdit,
  onDelete,
}) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const done = task.status === "done";
  const due = task.completeBy ? dueState(task.completeBy) : null;
  const noteHref = task.noteId ? `/note/${task.noteId}` : null;

  return (
    <article
      className={`${styles.card} ${done ? styles.done : ""} ${className ?? ""}`}
      data-status={task.status}
    >
      <button
        type="button"
        className={styles.check}
        aria-pressed={done}
        aria-label={done ? "Mark as not done" : "Mark as done"}
        onClick={() => onStatusChange(done ? "todo" : "done")}
      >
        {done && <Check aria-hidden="true" />}
      </button>

      <div className={styles.body}>
        <button type="button" className={styles.text} onClick={onEdit}>
          {task.text}
        </button>

        {(showProject || task.completeBy || (showNoteLink && noteHref)) && (
          <div className={styles.meta}>
            {showProject && <span className={styles.chip}>{task.projectName}</span>}
            {task.completeBy && due && (
              <span className={`${styles.chip} ${styles.dueChip} ${styles[`due_${due}`]}`}>
                <CalendarDays aria-hidden="true" />
                {due === "overdue" && !done ? "Overdue · " : ""}
                {formatDue(task.completeBy)}
              </span>
            )}
            {showNoteLink && noteHref && (
              <Link to={noteHref} className={`${styles.chip} ${styles.noteChip}`}>
                <NotebookPen aria-hidden="true" />
                From your note
              </Link>
            )}
          </div>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-md" className={styles.more} aria-label="More actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={styles.menu}>
          {TASK_STATUS_VALUES.filter((status) => status !== task.status).map((status) => (
            <DropdownMenuItem key={status} onSelect={() => onStatusChange(status)}>
              <ArrowRight aria-hidden="true" />
              Move to {TASK_STATUS_LABELS[status]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil aria-hidden="true" />
            Edit…
          </DropdownMenuItem>
          {showNoteLink && noteHref && (
            <DropdownMenuItem asChild>
              <Link to={noteHref}>
                <NotebookPen aria-hidden="true" />
                Open the note
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={styles.destructiveItem} onSelect={() => setConfirmingDelete(true)}>
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Delete this task?"
        description="It will stay hidden even if you refresh tasks from the note it came from."
        confirmLabel="Delete"
        destructive
        loading={deleting}
        onConfirm={() => {
          setDeleting(true);
          void onDelete()
            .then(() => setConfirmingDelete(false))
            .catch(() => toast.error("That task could not be deleted. Please try again."))
            .finally(() => setDeleting(false));
        }}
      />
    </article>
  );
};
