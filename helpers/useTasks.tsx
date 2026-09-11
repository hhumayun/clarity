import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTasksList, type OutputType as TasksListOutput } from "../endpoints/tasks/list_GET.schema";
import { postTasksExtract } from "../endpoints/tasks/extract_POST.schema";
import { postTasksAdd } from "../endpoints/tasks/add_POST.schema";
import { postTaskCreate } from "../endpoints/tasks/create_POST.schema";
import { postTaskUpdate } from "../endpoints/tasks/update_POST.schema";
import { postTaskDelete } from "../endpoints/tasks/delete_POST.schema";
import { postTasksClearDone } from "../endpoints/tasks/clear_done_POST.schema";
import { postProjectCreate } from "../endpoints/projects/create_POST.schema";
import { postProjectUpdate } from "../endpoints/projects/update_POST.schema";
import { postProjectDelete } from "../endpoints/projects/delete_POST.schema";

export const TASKS_QUERY_KEY = ["tasks"] as const;

export function useTasks(noteId?: string, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = [...TASKS_QUERY_KEY, noteId ?? "all"] as const;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY });

  const query = useQuery({
    queryKey,
    queryFn: () => getTasksList(noteId ? { noteId } : {}),
    enabled,
    placeholderData: (previous) => previous,
  });

  // Extraction only suggests; nothing is written until the writer picks
  // which suggestions to add, so the cache is left alone here.
  const extract = useMutation({
    mutationFn: (input: Parameters<typeof postTasksExtract>[0]) =>
      postTasksExtract(input),
  });

  const addSuggested = useMutation({
    mutationFn: (input: Parameters<typeof postTasksAdd>[0]) =>
      postTasksAdd(input),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: (input: Parameters<typeof postTaskCreate>[0]) =>
      postTaskCreate(input),
    onSuccess: invalidate,
  });

  // Status changes (the checkbox) are applied to the cache immediately so a
  // tap feels instant; the server result replaces it a moment later.
  const update = useMutation({
    mutationFn: (input: Parameters<typeof postTaskUpdate>[0]) =>
      postTaskUpdate(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: TASKS_QUERY_KEY });
      const snapshots = queryClient.getQueriesData<TasksListOutput>({ queryKey: TASKS_QUERY_KEY });
      queryClient.setQueriesData<TasksListOutput>({ queryKey: TASKS_QUERY_KEY }, (old) => {
        if (!old) return old;
        return {
          ...old,
          tasks: old.tasks.map((task) =>
            task.id === input.id
              ? {
                  ...task,
                  ...(input.status !== undefined ? { status: input.status } : {}),
                  ...(input.text !== undefined ? { text: input.text } : {}),
                  ...(input.completeBy !== undefined ? { completeBy: input.completeBy } : {}),
                  ...(input.projectId !== undefined
                    ? {
                        projectId: input.projectId,
                        projectName:
                          old.projects.find((p) => p.id === input.projectId)?.name ?? task.projectName,
                      }
                    : {}),
                  updatedAt: new Date(),
                }
              : task,
          ),
        };
      });
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
    mutationFn: (input: Parameters<typeof postTaskDelete>[0]) =>
      postTaskDelete(input),
    onSuccess: invalidate,
  });

  const clearDone = useMutation({
    mutationFn: (input: Parameters<typeof postTasksClearDone>[0]) =>
      postTasksClearDone(input),
    onSuccess: invalidate,
  });

  const createProject = useMutation({
    mutationFn: (input: Parameters<typeof postProjectCreate>[0]) =>
      postProjectCreate(input),
    onSuccess: invalidate,
  });

  const renameProject = useMutation({
    mutationFn: (input: Parameters<typeof postProjectUpdate>[0]) =>
      postProjectUpdate(input),
    onSuccess: invalidate,
  });

  const deleteProject = useMutation({
    mutationFn: (input: Parameters<typeof postProjectDelete>[0]) =>
      postProjectDelete(input),
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
