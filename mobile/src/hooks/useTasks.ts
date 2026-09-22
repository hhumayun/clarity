import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTasksList,
  postProjectCreate,
  postProjectDelete,
  postProjectUpdate,
  postTaskCreate,
  postTaskDelete,
  postTaskUpdate,
  postTasksAdd,
  postTasksClearDone,
  postTasksExtract,
} from "../api/tasks";
import type { TaskRecord, TaskStatus } from "../types";

export const TASKS_QUERY_KEY = ["tasks"] as const;

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
      if (task.noteId) {
        queryClient.setQueryData<TasksListOutput>([...TASKS_QUERY_KEY, task.noteId], insert);
      }
      invalidate();
    },
  });

  const update = useMutation({
    mutationFn: (body: {
      id: string;
      text?: string;
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
    remove,
    clearDone,
    createProject,
    renameProject,
    deleteProject,
  };
}
