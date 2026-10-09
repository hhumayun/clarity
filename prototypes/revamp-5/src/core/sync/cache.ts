import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { ProjectRecord, TaskRecord } from "../types";
import { outbox } from "./store";

/**
 * Fetch, unless changes made here are still on their way to the server: then
 * the server's copy would not have them yet, and showing it would make them
 * vanish until they land. Keep what is on screen instead; the runner
 * refreshes everything once the outbox is empty. Photos waiting to go up
 * don't count: a photo can't change a list (revamp 5).
 */
export async function unlessSyncing<T>(queryClient: QueryClient, queryKey: QueryKey, fetcher: () => Promise<T>): Promise<T> {
  const cached = queryClient.getQueryData<T>(queryKey);
  if (cached !== undefined && outbox.pendingCount({ photos: false }) > 0) return cached;
  return fetcher();
}

/** The same for one page of an infinite list, found by the page's cursor. */
export async function pageUnlessSyncing<P>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  pageParam: unknown,
  fetcher: () => Promise<P>,
): Promise<P> {
  const cached = queryClient.getQueryData<InfiniteData<P, unknown>>(queryKey);
  if (cached && outbox.pendingCount({ photos: false }) > 0) {
    const index = cached.pageParams.findIndex((param) => param === pageParam);
    if (index >= 0) return cached.pages[index];
  }
  return fetcher();
}

type TasksData = { tasks: TaskRecord[]; projects: ProjectRecord[] };

/** The server kept its own project of that name: use its id everywhere here. */
export function remapProjectInCache(queryClient: QueryClient, fromId: string, project: ProjectRecord) {
  queryClient.setQueriesData<TasksData>({ queryKey: ["tasks"] }, (old) => {
    if (!old?.projects) return old;
    const hasServer = old.projects.some((item) => item.id === project.id);
    return {
      ...old,
      projects: hasServer
        ? old.projects.filter((item) => item.id !== fromId)
        : old.projects.map((item) => (item.id === fromId ? project : item)),
      tasks: old.tasks.map((task) =>
        task.projectId === fromId ? { ...task, projectId: project.id, projectName: project.name } : task,
      ),
    };
  });
}
