import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTasksList,
  postProjectCreate,
  postProjectDelete,
  postProjectUpdate,
  postTaskCreate,
  getTaskNotes,
  postTaskDelete,
  postTaskLink,
  postTaskSummary,
  postTaskUpdate,
  postTasksAdd,
  postTasksClearDone,
  postTasksExtract,
} from "../api/tasks";
import { linkedNoteIds } from "../lib/taskLinks";
import type { TaskRecord, TaskStatus } from "../types";

export const TASKS_QUERY_KEY = ["tasks"] as const;
export const TASK_NOTES_KEY = ["task-notes"] as const;
export const TASK_SUMMARY_KEY = ["task-summary"] as const;

type TasksListOutput = Awaited<ReturnType<typeof getTasksList>>;

export function useTasks(noteId?: string, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = [...TASKS_QUERY_KEY, noteId ?? "all"] as const;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });

  const query = useQuery({
    queryKey,
    queryFn: () => getTasksList(noteId ? { noteId } : {}),
    enabled,
    placeholderData: (previous) => previous,
  });

  const extract = useMutation({
    mutationFn: (body: { noteId: string }) => postTasksExtract(body),
  });
  const addSuggested = useMutation({
    mutationFn: (body: {
      noteId: string;
      tasks: { text: string; projectName: string; completeBy?: Date | null }[];
    }) => postTasksAdd(body),
    onSuccess: invalidate,
  });
  const create = useMutation({
    mutationFn: (body: {
      text: string;
      description?: string;
      projectId?: string;
      projectName?: string;
      completeBy?: Date | null;
      status?: TaskStatus;
      noteId?: string | null;
    }) => postTaskCreate(body),
    onSuccess: ({ task }) => {
      // Show the new card at once rather than after the refetch, so the
      // screen can scroll to it and flash it the moment the dialog closes.
      const insert = (old: TasksListOutput | undefined) =>
        old && !old.tasks.some((t) => t.id === task.id)
          ? { ...old, tasks: [task, ...old.tasks] }
          : old;
      queryClient.setQueryData<TasksListOutput>([...TASKS_QUERY_KEY, "all"], insert);
      for (const noteId of linkedNoteIds(task)) {
        queryClient.setQueryData<TasksListOutput>([...TASKS_QUERY_KEY, noteId], insert);
      }
      invalidate();
    },
  });

  const update = useMutation({
    mutationFn: (body: {
      id: string;
      text?: string;
      description?: string;
      projectId?: string;
      completeBy?: Date | null;
      status?: TaskStatus;
    }) => postTaskUpdate(body),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const snapshots = queryClient.getQueriesData<TasksListOutput>({
        queryKey: TASKS_QUERY_KEY,
      });
      queryClient.setQueriesData<TasksListOutput>(
        { queryKey: TASKS_QUERY_KEY },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            tasks: old.tasks.map((task) =>
              task.id === input.id
                ? {
                    ...task,
                    ...(input.status !== undefined ? { status: input.status } : {}),
                    ...(input.text !== undefined ? { text: input.text } : {}),
                    ...(input.description !== undefined ? { description: input.description } : {}),
                    ...(input.completeBy !== undefined
                      ? { completeBy: input.completeBy }
                      : {}),
                    ...(input.projectId !== undefined
                      ? {
                          projectId: input.projectId,
                          projectName:
                            old.projects.find((p) => p.id === input.projectId)
                              ?.name ?? task.projectName,
                        }
                      : {}),
                    updatedAt: new Date(),
                  }
                : task,
            ) as TaskRecord[],
          };
        },
      );
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: invalidate,
  });

  // Link or unlink a note: the task joins or leaves that note's list at once,
  // and its note count everywhere follows, before the server has answered.
  const link = useMutation({
    mutationFn: (body: { taskId: string; noteId: string; linked: boolean }) => postTaskLink(body),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const snapshots = queryClient.getQueriesData<TasksListOutput>({ queryKey: TASKS_QUERY_KEY });
      const known = snapshots.flatMap(([, data]) => data?.tasks ?? []).find((task) => task.id === input.taskId);
      const relink = (task: TaskRecord): TaskRecord => {
        const ids = linkedNoteIds(task).filter((id) => id !== input.noteId);
        return { ...task, noteIds: input.linked ? [...ids, input.noteId] : ids };
      };
      for (const [key, data] of snapshots) {
        if (!data) continue;
        const listNote = key[1];
        let tasks = data.tasks.map((task) => (task.id === input.taskId ? relink(task) : task));
        if (listNote === input.noteId) {
          const has = tasks.some((task) => task.id === input.taskId);
          if (input.linked && !has && known) tasks = [relink(known), ...tasks];
          if (!input.linked) tasks = tasks.filter((task) => task.id !== input.taskId);
        }
        queryClient.setQueryData<TasksListOutput>(key, { ...data, tasks });
      }
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      for (const [key, data] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, data);
      }
    },
    onSettled: (_data, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: [...TASK_NOTES_KEY, input.taskId] });
      void queryClient.invalidateQueries({ queryKey: [...TASK_SUMMARY_KEY, input.taskId] });
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (body: { id: string }) => postTaskDelete(body),
    onSuccess: invalidate,
  });
  const clearDone = useMutation({
    mutationFn: (body: { projectId?: string } = {}) => postTasksClearDone(body),
    onSuccess: invalidate,
  });
  const createProject = useMutation({
    mutationFn: (body: { name: string }) => postProjectCreate(body),
    onSuccess: invalidate,
  });
  const renameProject = useMutation({
    mutationFn: (body: { id: string; name: string }) => postProjectUpdate(body),
    onSuccess: invalidate,
  });
  const deleteProject = useMutation({
    mutationFn: (body: { id: string; moveTasksTo?: string }) =>
      postProjectDelete(body),
    onSuccess: invalidate,
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
  return useQuery({
    queryKey: [...TASK_NOTES_KEY, taskId],
    queryFn: () => getTaskNotes(taskId),
    enabled,
  });
}

/**
 * The AI summary of a task. The server keeps it until the task's notes or
 * focus time change, so asking again is cheap; `enabled` holds it back until
 * the person wants one.
 */
export function useTaskSummary(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: [...TASK_SUMMARY_KEY, taskId],
    queryFn: () => postTaskSummary(taskId),
    enabled,
    retry: 1,
    staleTime: 60_000,
  });
}
