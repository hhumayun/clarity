import React, { useEffect, useState } from "react";
import { CalendarDays, Trash2, X } from "lucide-react";
import type { ProjectRecord, TaskRecord } from "../helpers/TaskRecord";
import { TASK_STATUS_LABELS, TASK_STATUS_VALUES } from "../helpers/TaskRecord";
import type { TaskStatus } from "../helpers/schema";
import { formatDueLong } from "../helpers/taskDates";
import { useIsMobile } from "../helpers/useIsMobile";
import { Button } from "./Button";
import { Calendar } from "./Calendar";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "./Dialog";
import { Popover, PopoverContent, PopoverTrigger } from "./Popover";
import { ProjectPicker } from "./ProjectPicker";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "./Sheet";
import { Textarea } from "./Textarea";
import { ToggleGroup, ToggleGroupItem } from "./ToggleGroup";
import styles from "./TaskDialog.module.css";

export type TaskDraft = {
  text: string;
  projectId: string | null;
  completeBy: Date | null;
  status: TaskStatus;
};

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing task; omit for "Add a task". */
  task?: TaskRecord | null;
  projects: ProjectRecord[];
  /** Project preselected for a new task (e.g. the active filter). */
  defaultProjectId?: string | null;
  onSave: (draft: TaskDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCreateProject: (name: string) => Promise<ProjectRecord>;
}

function draftFrom(task: TaskRecord | null | undefined, defaultProjectId: string | null | undefined, projects: ProjectRecord[]): TaskDraft {
  if (task) {
    return { text: task.text, projectId: task.projectId, completeBy: task.completeBy, status: task.status };
  }
  return {
    text: "",
    projectId: defaultProjectId ?? projects[0]?.id ?? null,
    completeBy: null,
    status: "todo",
  };
}

/**
 * One form for adding and editing a task. A centred dialog on wide screens,
 * a bottom sheet on phones so the keyboard does not cover it.
 */
export const TaskDialog: React.FC<TaskDialogProps> = ({
  open, onOpenChange, task, projects, defaultProjectId, onSave, onDelete, onCreateProject,
}) => {
  const isMobile = useIsMobile();
  const [draft, setDraft] = useState<TaskDraft>(() => draftFrom(task, defaultProjectId, projects));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editing = Boolean(task);

  // Reset the form each time the dialog opens for a (possibly different) task.
  useEffect(() => {
    if (open) {
      setDraft(draftFrom(task, defaultProjectId, projects));
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  const canSave = draft.text.trim().length > 0 && Boolean(draft.projectId) && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ ...draft, text: draft.text.trim().replace(/\s+/g, " ") });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That task could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const form = (
    <div className={styles.form}>
      <label className={styles.field}>
        <span className={styles.label}>What needs doing?</span>
        <Textarea
          value={draft.text}
          onChange={(event) => setDraft((d) => ({ ...d, text: event.target.value }))}
          placeholder="For example, call Dr. Lee to book a check-up"
          rows={3}
          maxLength={500}
          autoFocus={!isMobile}
          disableResize
          className={styles.textarea}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void save();
            }
          }}
        />
      </label>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Project</span>
          <ProjectPicker
            projects={projects}
            value={draft.projectId ?? ""}
            onChange={(projectId) => setDraft((d) => ({ ...d, projectId }))}
            onCreate={onCreateProject}
            className={styles.control}
          />
        </label>

        <div className={styles.field}>
          <span className={styles.label}>Complete by</span>
          <div className={styles.dateRow}>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="md" className={styles.dateButton}>
                  <CalendarDays aria-hidden="true" />
                  {draft.completeBy ? formatDueLong(draft.completeBy) : "No date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" removeBackgroundAndPadding>
                <Calendar
                  mode="single"
                  selected={draft.completeBy ?? undefined}
                  onSelect={(date: Date | undefined) => {
                    setDraft((d) => ({ ...d, completeBy: date ?? null }));
                    setDateOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            {draft.completeBy && (
              <Button
                variant="ghost"
                size="icon-md"
                aria-label="Clear date"
                onClick={() => setDraft((d) => ({ ...d, completeBy: null }))}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Where is it?</span>
        <ToggleGroup
          type="single"
          value={draft.status}
          variant="outline"
          size="lg"
          className={styles.statusGroup}
          onValueChange={(value) => value && setDraft((d) => ({ ...d, status: value as TaskStatus }))}
          aria-label="Task status"
        >
          {TASK_STATUS_VALUES.map((status) => (
            <ToggleGroupItem key={status} value={status} className={styles.statusItem}>
              {TASK_STATUS_LABELS[status]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <div className={styles.footer}>
        {editing && onDelete && (
          <Button variant="ghost" className={styles.deleteButton} onClick={() => setConfirmingDelete(true)} disabled={saving}>
            <Trash2 aria-hidden="true" />
            Delete task
          </Button>
        )}
        <div className={styles.footerActions}>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button size="lg" onClick={() => void save()} disabled={!canSave}>
            {saving ? "Saving…" : editing ? "Save" : "Add task"}
          </Button>
        </div>
      </div>
    </div>
  );

  const title = editing ? "Edit task" : "Add a task";
  const description = editing
    ? "Change anything you like. Nothing is saved until you press Save."
    : "A short, clear action in your own words.";

  return (
    <>
      {isMobile ? (
        <Sheet open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
          <SheetContent side="bottom" className={styles.sheet}>
            <SheetHeader className={styles.sheetHeader}>
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>{description}</SheetDescription>
            </SheetHeader>
            <div className={styles.sheetBody}>{form}</div>
          </SheetContent>
        </Sheet>
      ) : (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
          <DialogContent className={styles.dialog}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {form}
          </DialogContent>
        </Dialog>
      )}

      {editing && onDelete && (
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
              .then(() => {
                setConfirmingDelete(false);
                onOpenChange(false);
              })
              .catch(() => setError("That task could not be deleted. Please try again."))
              .finally(() => setDeleting(false));
          }}
        />
      )}
    </>
  );
};
