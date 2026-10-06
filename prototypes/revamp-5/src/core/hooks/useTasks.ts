import { randomUUID } from "expo-crypto";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getTaskNotes, getTasksList, postTaskSummary, postTasksAdd, postTasksExtract } from "../api/tasks";
import { dateChipLabel } from "../lib/dates";
import { dueTimeLabel, withReminders, type TaskChange } from "../lib/reminderRules";
import { linkedNoteIds } from "../lib/taskLinks";
import { useToast } from "../providers/ToastProvider";
import { unlessSyncing } from "../sync/cache";
import { outbox } from "../sync/store";
import type { LinkedNote, ProjectRecord, ReminderRepeat, TaskRecord, TaskStatus } from "../types";
import { findCachedNote } from "./useNotes";

export const TASKS_QUERY_KEY = ["tasks"] as const;
export const TASK_NOTES_KEY = ["task-notes"] as const;
export const TASK_SUMMARY_KEY = ["task-summary"] as const;

type TasksListOutput = Awaited<ReturnType<typeof getTasksList>>;

/**
 * Every cached task list, changed the same way. `listNote` is the note a list
 * belongs to, or "all".
 */
function editTaskLists(queryClient: QueryClient, edit: (data: TasksListOutput, listNote: string) => TasksListOutput) {
  for (const [key, data] of queryClient.getQueriesData<TasksListOutput>({ queryKey: TASKS_QUERY_KEY })) {
    if (data) queryClient.setQueryData(key, edit(data, String(key[1])));
  }
}

/** A task as the phone has it, from whichever list holds it. */
export function findCachedTask(queryClient: QueryClient, id: string): TaskRecord | undefined {
  for (const [, data] of queryClient.getQueriesData<TasksListOutput>({ queryKey: TASKS_QUERY_KEY })) {
    const task = data?.tasks.find((item) => item.id === id);
    if (task) return task;
  }
  return undefined;
}

/** The areas the phone knows about. */
function cachedProjects(queryClient: QueryClient): ProjectRecord[] {
  for (const [, data] of queryClient.getQueriesData<TasksListOutput>({ queryKey: TASKS_QUERY_KEY })) {
    if (data?.projects?.length) return data.projects;
  }
  return [];
}

const sameName = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * An area by name: the one already here, or a new one made here and queued.
 * (The server keeps one area per name; if it already has this one, the
 * runner swaps in its id.)
 */
function ensureProject(queryClient: QueryClient, rawName: string): ProjectRecord {
  const name = rawName.trim().replace(/\s+/g, " ");
  const existing = cachedProjects(queryClient).find((project) => sameName(project.name, name));
  if (existing) return existing;
  const now = new Date();
  const project: ProjectRecord = { id: randomUUID(), name, createdAt: now, updatedAt: now };
  outbox.enqueue({ kind: "project.create", body: { id: project.id, name } });
  editTaskLists(queryClient, (data) => ({ ...data, projects: [project, ...data.projects] }));
  return project;
}

/**
 * Tasks and areas. Every change is made here at once (the lists update before
 * any answer) and queued in the outbox, which sends it when there is a
 * connection — straight away, or later if the phone is offline.
 */
export function useTasks(noteId?: string, enabled = true) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const queryKey = [...TASKS_QUERY_KEY, noteId ?? "all"] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => unlessSyncing(queryClient, queryKey, () => getTasksList(noteId ? { noteId } : {})),
    enabled,
    // Changes made here are already in it; within a minute nothing is refetched.
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });

  // Finding tasks in a note and adding them asks the AI and the server, so
  // these need a connection.
  const extract = useMutation({
    mutationFn: (body: { noteId: string }) => postTasksExtract(body),
  });
  const addSuggested = useMutation({
    mutationFn: (body: {
      noteId: string;
      tasks: { text: string; projectName: string; completeBy?: Date | null }[];
    }) => postTasksAdd(body),
    onSuccess: ({ tasks }) => {
      editTaskLists(queryClient, (data, listNote) => {
        const fresh = tasks.filter(
          (task) =>
            !data.tasks.some((existing) => existing.id === task.id) &&
            (listNote === "all" || linkedNoteIds(task).includes(listNote)),
        );
        return fresh.length ? { ...data, tasks: [...fresh, ...data.tasks] } : data;
      });
      void queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });
    },
  });

  const create = useMutation({
    mutationFn: async (body: {
      text: string;
      description?: string;
      projectId?: string;
      projectName?: string;
      completeBy?: Date | null;
      dueTime?: string | null;
      remindBefore?: number | null;
      remindRepeat?: ReminderRepeat | null;
      remindOnce?: boolean;
      status?: TaskStatus;
      noteId?: string | null;
    }) => {
      const project = body.projectId
        ? cachedProjects(queryClient).find((item) => item.id === body.projectId)
        : body.projectName
          ? ensureProject(queryClient, body.projectName)
          : undefined;
      const projectId = body.projectId ?? project?.id;
      if (!projectId) throw new Error("Choose an area for this task.");
      const now = new Date();
      const task: TaskRecord = {
        id: randomUUID(),
        text: body.text.trim().replace(/\s+/g, " "),
        description: body.description?.trim() ?? "",
        status: body.status ?? "todo",
        projectId,
        projectName: project?.name ?? "",
        noteId: body.noteId ?? null,
        noteIds: body.noteId ? [body.noteId] : [],
        completeBy: body.completeBy ?? null,
        // A time goes with a day.
        dueTime: body.completeBy ? (body.dueTime ?? null) : null,
        remindBefore: body.remindBefore ?? null,
        remindRepeat: body.remindRepeat ?? null,
        remindOnce: body.remindOnce ?? false,
        createdAt: now,
        updatedAt: now,
      };
      outbox.enqueue({
        kind: "task.create",
        body: {
          id: task.id,
          createdAt: now,
          text: task.text,
          description: task.description,
          projectId,
          completeBy: task.completeBy,
          ...(task.dueTime ? { dueTime: task.dueTime } : {}),
          ...(task.remindBefore != null ? { remindBefore: task.remindBefore } : {}),
          ...(task.remindRepeat ? { remindRepeat: task.remindRepeat } : {}),
          ...(task.remindOnce ? { remindOnce: true } : {}),
          status: task.status,
          noteId: task.noteId,
        },
      });
      // On screen at once, so it can be scrolled to and flashed.
      editTaskLists(queryClient, (data, listNote) =>
        listNote === "all" || listNote === task.noteId ? { ...data, tasks: [task, ...data.tasks] } : data,
      );
      return { task };
    },
  });

  const update = useMutation({
    mutationFn: async (asked: TaskChange) => {
      const before = findCachedTask(queryClient, asked.id);
      const { change, rolledTo } = withReminders(asked, before);
      // Stamped with when it was made, so a change sent later keeps its time (revamp 5).
      const body = { ...change, changedAt: new Date() };
      outbox.enqueue({ kind: "task.update", body });
      if (rolledTo) {
        const time = body.dueTime !== undefined ? body.dueTime : before?.dueTime;
        toast.show(`Next: ${dateChipLabel(rolledTo)}${time ? `, ${dueTimeLabel(time)}` : ""}`);
      }
      const projects = cachedProjects(queryClient);
      editTaskLists(queryClient, (data) => ({
        ...data,
        tasks: data.tasks.map((task) =>
          task.id === body.id
            ? {
                ...task,
                ...(body.status !== undefined ? { status: body.status } : {}),
                ...(body.text !== undefined ? { text: body.text } : {}),
                ...(body.description !== undefined ? { description: body.description } : {}),
                ...(body.completeBy !== undefined ? { completeBy: body.completeBy } : {}),
                ...(body.dueTime !== undefined ? { dueTime: body.dueTime } : {}),
                ...(body.remindBefore !== undefined ? { remindBefore: body.remindBefore } : {}),
                ...(body.remindRepeat !== undefined ? { remindRepeat: body.remindRepeat } : {}),
                ...(body.remindOnce !== undefined ? { remindOnce: body.remindOnce } : {}),
                // Done keeps the moment it first became done; reopening clears it (revamp 5).
                ...(body.status !== undefined ? { completedAt: body.status === "done" ? (task.status === "done" ? (task.completedAt ?? body.changedAt) : body.changedAt) : null } : {}),
                ...(body.movedFrom !== undefined ? { movedFrom: body.movedFrom } : {}),
                ...(body.projectId !== undefined
                  ? {
                      projectId: body.projectId,
                      projectName: projects.find((p) => p.id === body.projectId)?.name ?? task.projectName,
                    }
                  : {}),
                updatedAt: body.changedAt,
              }
            : task,
        ),
      }));
      return { rolledTo };
    },
  });

  // Link or unlink a note: the task joins or leaves that note's list, its
  // note count follows, and so does the task's own list of notes.
  const link = useMutation({
    mutationFn: async (body: { taskId: string; noteId: string; linked: boolean }) => {
      outbox.enqueue({ kind: "task.link", body });
      const known = findCachedTask(queryClient, body.taskId);
      const relink = (task: TaskRecord): TaskRecord => {
        const ids = linkedNoteIds(task).filter((id) => id !== body.noteId);
        return { ...task, noteIds: body.linked ? [...ids, body.noteId] : ids };
      };
      editTaskLists(queryClient, (data, listNote) => {
        let tasks = data.tasks.map((task) => (task.id === body.taskId ? relink(task) : task));
        if (listNote === body.noteId) {
          const has = tasks.some((task) => task.id === body.taskId);
          if (body.linked && !has && known) tasks = [relink(known), ...tasks];
          if (!body.linked) tasks = tasks.filter((task) => task.id !== body.taskId);
        }
        return { ...data, tasks };
      });
      queryClient.setQueryData<{ notes: LinkedNote[] }>([...TASK_NOTES_KEY, body.taskId], (old) => {
        if (!old) return old;
        const others = old.notes.filter((note) => note.id !== body.noteId);
        if (!body.linked) return { notes: others };
        const note = findCachedNote(queryClient, body.noteId);
        if (!note) return old;
        const linkedNote: LinkedNote = {
          id: note.id,
          title: note.title,
          preview: note.content.replace(/\s+/g, " ").trim().slice(0, 220),
          source: note.source ?? null,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        };
        return { notes: [linkedNote, ...others].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) };
      });
    },
  });

  const remove = useMutation({
    mutationFn: async (body: { id: string }) => {
      outbox.enqueue({ kind: "task.delete", body });
      editTaskLists(queryClient, (data) => ({ ...data, tasks: data.tasks.filter((task) => task.id !== body.id) }));
      return { deleted: true as const };
    },
  });

  const clearDone = useMutation({
    mutationFn: async (body: { projectId?: string } = {}) => {
      const isCleared = (task: TaskRecord) =>
        task.status === "done" && (!body.projectId || task.projectId === body.projectId);
      const all = queryClient.getQueryData<TasksListOutput>([...TASKS_QUERY_KEY, "all"]);
      const cleared = all?.tasks.filter(isCleared).length ?? 0;
      outbox.enqueue({ kind: "tasks.clearDone", body });
      editTaskLists(queryClient, (data) => ({ ...data, tasks: data.tasks.filter((task) => !isCleared(task)) }));
      return { cleared };
    },
  });

  const createProject = useMutation({
    mutationFn: async (body: { name: string }) => ({ project: ensureProject(queryClient, body.name) }),
  });

  const renameProject = useMutation({
    mutationFn: async (body: { id: string; name: string }) => {
      const name = body.name.trim().replace(/\s+/g, " ");
      outbox.enqueue({ kind: "project.update", body: { id: body.id, name } });
      editTaskLists(queryClient, (data) => ({
        ...data,
        projects: data.projects.map((project) =>
          project.id === body.id ? { ...project, name, updatedAt: new Date() } : project,
        ),
        tasks: data.tasks.map((task) => (task.projectId === body.id ? { ...task, projectName: name } : task)),
      }));
      const project = cachedProjects(queryClient).find((item) => item.id === body.id);
      return { project: project ?? { id: body.id, name, createdAt: new Date(), updatedAt: new Date() } };
    },
  });

  const deleteProject = useMutation({
    mutationFn: async (body: { id: string; moveTasksTo?: string }) => {
      outbox.enqueue({ kind: "project.delete", body });
      const target = body.moveTasksTo
        ? cachedProjects(queryClient).find((item) => item.id === body.moveTasksTo)
        : undefined;
      const all = queryClient.getQueryData<TasksListOutput>([...TASKS_QUERY_KEY, "all"]);
      const affected = all?.tasks.filter((task) => task.projectId === body.id).length ?? 0;
      editTaskLists(queryClient, (data) => ({
        ...data,
        projects: data.projects.filter((project) => project.id !== body.id),
        tasks: target
          ? data.tasks.map((task) =>
              task.projectId === body.id ? { ...task, projectId: target.id, projectName: target.name } : task,
            )
          : data.tasks.filter((task) => task.projectId !== body.id),
      }));
      return {
        deleted: true as const,
        movedTasks: target ? affected : 0,
        removedTasks: target ? 0 : affected,
      };
    },
  });

  return {
    query,
    extract,
    addSuggested,
    create,
    update,
    link,
    remove,
    clearDone,
    createProject,
    renameProject,
    deleteProject,
  };
}

/** The notes linked to one task, newest first. */
export function useTaskNotes(taskId: string, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = [...TASK_NOTES_KEY, taskId];
  return useQuery({
    queryKey,
    queryFn: () => unlessSyncing(queryClient, queryKey, () => getTaskNotes(taskId)),
    enabled,
    // One more try, then say so, rather than spinning through three.
    retry: 1,
  });
}

/**
 * The AI summary of a task. The server keeps it until the task's notes or
 * focus time change, so asking again is cheap; `enabled` holds it back until
 * the person wants one. It needs a connection.
 */
export function useTaskSummary(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...TASK_SUMMARY_KEY, taskId],
    queryFn: () => postTaskSummary(taskId),
    enabled,
    // The server already fails over between models; a retry here would only
    // double the wait before the person can try again themselves.
    retry: false,
    staleTime: 60_000,
  });
}
