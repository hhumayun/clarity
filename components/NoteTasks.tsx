import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { TaskStatus } from "../helpers/schema";
import type { TaskRecord } from "../helpers/TaskRecord";
import type { SuggestedTask } from "../endpoints/tasks/extract_POST.schema";
import { formatDue } from "../helpers/taskDates";
import { sortProjects, sortTasks } from "../helpers/taskSort";
import { useTasks } from "../helpers/useTasks";
import { Button } from "./Button";
import { Skeleton } from "./Skeleton";
import { TaskCard } from "./TaskCard";
import { TaskDialog, type TaskDraft } from "./TaskDialog";
import styles from "./NoteTasks.module.css";

interface NoteTasksProps {
  noteId: string | null;
  enabled: boolean;
  className?: string;
}

function quietAiFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "OUT_OF_CREDITS" || /too many requests/i.test(error instanceof Error ? error.message : "");
}

/** The project most of this note's tasks already belong to, if any. */
function commonProjectId(tasks: TaskRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const task of tasks) counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) { best = id; bestCount = count; }
  }
  return best;
}

export const NoteTasks: React.FC<NoteTasksProps> = ({ noteId, enabled, className }) => {
  const { query, extract, addSuggested, create, update, remove, createProject } = useTasks(
    noteId ?? undefined,
    enabled && Boolean(noteId),
  );
  const attemptedRef = useRef(false);
  const extractRef = useRef(extract.mutate);
  extractRef.current = extract.mutate;
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: TaskRecord | null }>({
    open: false,
    task: null,
  });

  // Suggestions the AI found, waiting for the writer's choice. Selected by
  // default — the writer unticks what they do not want.
  const [suggestions, setSuggestions] = useState<SuggestedTask[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState(false);

  const runExtract = () => {
    if (!noteId) return;
    extract.mutate(
      { noteId },
      {
        onSuccess: ({ suggested, unchanged }) => {
          setSuggestions(suggested);
          setChecked(new Set(suggested.map((_, i) => i)));
          if (unchanged) {
            toast.message("Nothing new — the note has not changed since the last look.");
          } else if (suggested.length === 0) {
            toast.message("No new tasks found in this note.");
          }
        },
        onError: (error) => {
          if (!quietAiFailure(error)) toast.error("Tasks could not be found right now. You can try again.");
        },
      },
    );
  };

  // First time the tab opens on a note that has never been looked at, take a
  // look automatically — but only ever suggest, never add.
  useEffect(() => {
    if (!enabled || !noteId || !query.data?.extraction) return;
    if (query.data.extraction.hasExtracted || attemptedRef.current) return;
    attemptedRef.current = true;
    extractRef.current(
      { noteId },
      {
        onSuccess: ({ suggested }) => {
          setSuggestions(suggested);
          setChecked(new Set(suggested.map((_, i) => i)));
        },
        onError: (error) => {
          if (!quietAiFailure(error)) toast.error("Tasks could not be found right now. You can try again.");
        },
      },
    );
  }, [enabled, noteId, query.data?.extraction]);

  const projects = useMemo(() => sortProjects(query.data?.projects ?? []), [query.data?.projects]);
  const tasks = useMemo(() => sortTasks(query.data?.tasks ?? []), [query.data?.tasks]);
  const loading = query.isFetching && !query.data;

  if (!noteId) {
    return (
      <div className={`${styles.empty} ${className ?? ""}`}>
        <p>Start writing your note first. Tasks will be available after it saves.</p>
      </div>
    );
  }

  const toggleSuggestion = (index: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const addSelected = async () => {
    if (!suggestions || checked.size === 0) return;
    setAdding(true);
    try {
      const chosen = suggestions.filter((_, i) => checked.has(i));
      const { added } = await addSuggested.mutateAsync({ noteId, tasks: chosen });
      setSuggestions(null);
      setChecked(new Set());
      toast.success(added > 0 ? `${added} ${added === 1 ? "task" : "tasks"} added` : "Those tasks were already in your list");
    } catch {
      toast.error("Those tasks could not be added. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const changeStatus = (task: TaskRecord, status: TaskStatus) => {
    update.mutate(
      { id: task.id, status },
      { onError: () => toast.error("That change could not be saved. Please try again.") },
    );
  };

  const saveTask = async (draft: TaskDraft) => {
    if (!draft.projectId) throw new Error("Choose a project for this task.");
    if (taskDialog.task) {
      await update.mutateAsync({
        id: taskDialog.task.id,
        text: draft.text,
        projectId: draft.projectId,
        completeBy: draft.completeBy,
        status: draft.status,
      });
    } else {
      await create.mutateAsync({
        text: draft.text,
        projectId: draft.projectId,
        completeBy: draft.completeBy,
        status: draft.status,
        noteId,
      });
      toast.success("Task added");
    }
  };

  const openTasks = tasks.filter((t) => t.status !== "done");
  const doneTasks = tasks.filter((t) => t.status === "done");
  const selectedCount = checked.size;

  return (
    <section className={`${styles.section} ${className ?? ""}`} aria-label="Tasks from this note">
      <div className={styles.headingRow}>
        <div>
          <h2>Tasks from this note</h2>
          <p>Anything you want to remember or complete, in one place.</p>
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={runExtract} disabled={extract.isPending || loading || adding}>
            <RefreshCw className={extract.isPending ? styles.spinning : ""} aria-hidden="true" />
            {extract.isPending ? "Looking…" : "Find tasks"}
          </Button>
          <Button size="sm" onClick={() => setTaskDialog({ open: true, task: null })} disabled={loading}>
            <Plus aria-hidden="true" />
            Add a task
          </Button>
        </div>
      </div>

      {query.data?.extraction?.needsRefresh && !extract.isPending && suggestions === null && (
        <p className={styles.changed}>This note changed. Find tasks again when you are ready to look for new ones.</p>
      )}

      {extract.isPending && (
        <div className={styles.suggestionBox} aria-live="polite">
          <p className={styles.suggestionIntro}>Looking for clear actions in your note…</p>
        </div>
      )}

      {suggestions !== null && !extract.isPending && (
        <div className={styles.suggestionBox}>
          {suggestions.length === 0 ? (
            <div className={styles.suggestionEmpty}>
              <p>No new tasks found in this note.</p>
              <Button variant="ghost" size="sm" onClick={() => setSuggestions(null)}>Close</Button>
            </div>
          ) : (
            <>
              <p className={styles.suggestionIntro}>
                Found {suggestions.length} possible {suggestions.length === 1 ? "task" : "tasks"}.
                Tick the ones you want — nothing is added until you say so.
              </p>
              <ul className={styles.suggestionList}>
                {suggestions.map((item, index) => (
                  <li key={index}>
                    <label className={styles.suggestion}>
                      <input
                        type="checkbox"
                        className={styles.suggestionCheck}
                        checked={checked.has(index)}
                        onChange={() => toggleSuggestion(index)}
                      />
                      <span className={styles.suggestionText}>{item.text}</span>
                      <span className={styles.suggestionMeta}>
                        <span className={styles.suggestionChip}>{item.projectName}</span>
                        {item.completeBy && (
                          <span className={styles.suggestionChip}>
                            <CalendarDays aria-hidden="true" />
                            {formatDue(item.completeBy)}
                          </span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className={styles.suggestionActions}>
                <Button variant="ghost" size="sm" onClick={() => { setSuggestions(null); setChecked(new Set()); }} disabled={adding}>
                  Dismiss
                </Button>
                <Button size="sm" onClick={() => void addSelected()} disabled={adding || selectedCount === 0}>
                  {adding ? "Adding…" : selectedCount === suggestions.length
                    ? `Add ${selectedCount === 1 ? "task" : `all ${selectedCount} tasks`}`
                    : `Add ${selectedCount} ${selectedCount === 1 ? "task" : "tasks"}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className={styles.list}>
          {[0, 1].map((item) => <Skeleton key={item} className={styles.skeleton} />)}
        </div>
      )}

      {query.isError && (
        <div className={styles.empty}>
          <p>We could not load these tasks.</p>
          <Button variant="secondary" onClick={() => void query.refetch()}>Try again</Button>
        </div>
      )}

      {!loading && !query.isError && tasks.length === 0 && suggestions === null && !extract.isPending && (
        <div className={styles.empty}>
          <Sparkles aria-hidden="true" />
          <p>No tasks yet. Add one yourself, or use Find tasks to look for actions in your note.</p>
        </div>
      )}

      {openTasks.length > 0 && (
        <div className={styles.list}>
          {openTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              showNoteLink={false}
              onStatusChange={(next) => changeStatus(task, next)}
              onEdit={() => setTaskDialog({ open: true, task })}
              onDelete={async () => { await remove.mutateAsync({ id: task.id }); }}
            />
          ))}
        </div>
      )}

      {doneTasks.length > 0 && (
        <details className={styles.doneGroup} open={openTasks.length === 0}>
          <summary className={styles.doneSummary}>
            Done <span className={styles.doneCount}>{doneTasks.length}</span>
          </summary>
          <div className={styles.list}>
            {doneTasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                showNoteLink={false}
                onStatusChange={(next) => changeStatus(task, next)}
                onEdit={() => setTaskDialog({ open: true, task })}
                onDelete={async () => { await remove.mutateAsync({ id: task.id }); }}
              />
            ))}
          </div>
        </details>
      )}

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((s) => ({ ...s, open }))}
        task={taskDialog.task}
        projects={projects}
        defaultProjectId={commonProjectId(tasks)}
        onSave={saveTask}
        onDelete={
          taskDialog.task
            ? async () => { await remove.mutateAsync({ id: taskDialog.task!.id }); }
            : undefined
        }
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
      />
    </section>
  );
};
