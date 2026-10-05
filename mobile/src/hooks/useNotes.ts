import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import {
  getNote,
  getNoteCounts,
  getNotesList,
  getNotesPage,
  postNotesReindex,
  withoutDoc,
  type ListNotesInput,
  type NotesPage,
} from "../api/notes";
import { noteDocs } from "../lib/noteDocs";
import { pageUnlessSyncing, unlessSyncing } from "../sync/cache";
import { outbox } from "../sync/store";
import type { NoteRecord, TaskRecord } from "../types";

export const NOTES_QUERY_KEY = ["notes"] as const;

// How long a list of notes counts as fresh. Changes made on this phone are
// already in it; coming back to a screen within this long fetches nothing.
const NOTES_FRESH_MS = 60_000;

export const useNotes = (params: ListNotesInput, opts: { enabled?: boolean } = {}) => {
  const queryClient = useQueryClient();
  const queryKey = [...NOTES_QUERY_KEY, "list", params];
  return useQuery({
    queryKey,
    // While changes made here are still on their way, keep showing them.
    queryFn: () => unlessSyncing(queryClient, queryKey, () => getNotesList(params)),
    staleTime: NOTES_FRESH_MS,
    enabled: opts.enabled ?? true,
    placeholderData: (previous) => previous,
  });
};

/** Ask for a range of notes ahead of time (the next month), as useNotes would. */
export function prefetchNotes(queryClient: QueryClient, params: ListNotesInput) {
  const queryKey = [...NOTES_QUERY_KEY, "list", params];
  return queryClient.prefetchQuery({
    queryKey,
    queryFn: () => unlessSyncing(queryClient, queryKey, () => getNotesList(params)),
    staleTime: NOTES_FRESH_MS,
  });
}

/** Notes per page of the Notes list; older pages load as you scroll. */
export const NOTES_PAGE_SIZE = 50;

/** The Notes list in pages, newest written first. */
export const useNotesPages = (params: ListNotesInput, opts: { enabled?: boolean } = {}) => {
  const queryClient = useQueryClient();
  const queryKey = [...NOTES_QUERY_KEY, "pages", params];
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      pageUnlessSyncing(queryClient, queryKey, pageParam, () =>
        getNotesPage({ ...params, limit: NOTES_PAGE_SIZE, cursor: pageParam }),
      ),
    staleTime: NOTES_FRESH_MS,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: opts.enabled ?? true,
    placeholderData: (previous) => previous,
  });
};

/** Every loaded page as one list. A note can only appear once. */
export function flattenPages(data: InfiniteData<NotesPage> | undefined): NoteRecord[] {
  if (!data) return [];
  const seen = new Set<string>();
  const notes: NoteRecord[] = [];
  for (const page of data.pages) {
    for (const note of page.notes) {
      if (seen.has(note.id)) continue;
      seen.add(note.id);
      notes.push(note);
    }
  }
  return notes;
}

/** Whole counts for the Notes list, e.g. how many notes are archived. */
export const useNoteCounts = () => {
  return useQuery({
    queryKey: [...NOTES_QUERY_KEY, "counts"],
    queryFn: () => getNoteCounts(),
    staleTime: NOTES_FRESH_MS,
  });
};

/** Whether `a` sorts before `b` in a paged list: newer written first, then higher id. */
function newerThan(a: NoteRecord, b: NoteRecord): boolean {
  const diff = a.createdAt.getTime() - b.createdAt.getTime();
  return diff !== 0 ? diff > 0 : a.id > b.id;
}

/**
 * The paged-list half of upsertNoteInLists. A note already loaded is
 * replaced, or dropped if it no longer belongs. A new one goes where it
 * sorts among the loaded notes; one that sorts past the last loaded note
 * while older pages remain is left for those pages to bring in, or it would
 * show up twice.
 */
function upsertInPages(
  data: InfiniteData<NotesPage>,
  note: NoteRecord,
  belongs: boolean,
  searched: boolean,
): InfiniteData<NotesPage> | null {
  const where = data.pages.findIndex((page) => page.notes.some((n) => n.id === note.id));
  if (where >= 0) {
    const pages = data.pages.map((page, i) =>
      i !== where
        ? page
        : {
            ...page,
            notes:
              belongs || searched
                ? page.notes.map((n) => (n.id === note.id ? note : n))
                : page.notes.filter((n) => n.id !== note.id),
          },
    );
    return { ...data, pages };
  }
  if (!belongs || data.pages.length === 0) return null;
  for (let p = 0; p < data.pages.length; p++) {
    const at = data.pages[p].notes.findIndex((n) => newerThan(note, n));
    if (at >= 0) {
      const notes = [...data.pages[p].notes];
      notes.splice(at, 0, note);
      return { ...data, pages: data.pages.map((page, i) => (i === p ? { ...page, notes } : page)) };
    }
  }
  const last = data.pages[data.pages.length - 1];
  if (last.nextCursor) return null;
  return {
    ...data,
    pages: data.pages.map((page, i) => (i === data.pages.length - 1 ? { ...page, notes: [...page.notes, note] } : page)),
  };
}

/**
 * Whether a note belongs in a list fetched with these filters, as far as the
 * phone can tell: a search's matches are the server's call.
 */
function belongsIn(params: ListNotesInput, note: NoteRecord): boolean {
  return (
    Boolean(params.archived) === note.archived &&
    !params.q &&
    (!params.from || note.createdAt >= params.from) &&
    (!params.to || note.createdAt < params.to) &&
    (!params.projectId || (note.projectIds ?? []).includes(params.projectId))
  );
}

/**
 * Put a note the editor just saved into every cached list it belongs in, so
 * it shows the moment you go back rather than after the next fetch. The
 * editor saves through the API directly (it debounces its own writes), so
 * nothing else would tell the lists. Lists filtered by a search are only
 * updated in place, never added to: whether a note matches a search is the
 * server's call, and the refetch on return settles it.
 */
export function upsertNoteInLists(queryClient: QueryClient, saved: NoteRecord) {
  // The lists keep the words, not the rich text (see withoutDoc).
  const note = withoutDoc(saved);
  const lists = queryClient.getQueriesData<{ notes: NoteRecord[] }>({
    queryKey: [...NOTES_QUERY_KEY, "list"],
  });
  for (const [key, data] of lists) {
    if (!data) continue;
    const params = (key[2] ?? {}) as ListNotesInput;
    const index = data.notes.findIndex((n) => n.id === note.id);
    const belongs = belongsIn(params, note);
    let notes = data.notes;
    if (index >= 0) {
      notes = belongs || params.q ? data.notes.map((n, i) => (i === index ? note : n)) : data.notes.filter((_, i) => i !== index);
    } else if (belongs) {
      notes = [note, ...data.notes];
    } else {
      continue;
    }
    queryClient.setQueryData(key, { ...data, notes });
  }
  const paged = queryClient.getQueriesData<InfiniteData<NotesPage>>({
    queryKey: [...NOTES_QUERY_KEY, "pages"],
  });
  for (const [key, data] of paged) {
    if (!data) continue;
    const params = (key[2] ?? {}) as ListNotesInput;
    const belongs = belongsIn(params, note);
    const next = upsertInPages(data, note, belongs, Boolean(params.q));
    if (next) queryClient.setQueryData(key, next);
  }
  // Mark them stale too, so the next look at a list fetches the truth.
  void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY, refetchType: "none" });
}

/**
 * A new note, made here at once and queued: it is in the lists straight away,
 * with or without a connection. A thought parked during focus is linked to
 * its task here too.
 */
export const useCreateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      title?: string;
      content?: string;
      source?: "focus";
      taskId?: string;
      projectIds?: string[];
    }) => {
      const now = new Date();
      const note: NoteRecord = {
        id: randomUUID(),
        title: body.title ?? "",
        content: body.content ?? "",
        archived: false,
        source: body.source ?? null,
        createdAt: now,
        updatedAt: now,
        projectIds: body.projectIds ?? [],
      };
      outbox.enqueue({
        kind: "note.create",
        body: {
          id: note.id,
          createdAt: now,
          title: note.title,
          content: note.content,
          ...(body.source ? { source: body.source } : {}),
          ...(body.taskId ? { taskId: body.taskId } : {}),
          ...(body.projectIds?.length ? { projectIds: body.projectIds } : {}),
        },
      });
      upsertNoteInLists(queryClient, note);
      if (body.taskId) {
        const taskId = body.taskId;
        queryClient.setQueriesData<{ tasks: TaskRecord[] }>({ queryKey: ["tasks"] }, (old) =>
          old?.tasks
            ? {
                ...old,
                tasks: old.tasks.map((task) =>
                  task.id === taskId ? { ...task, noteIds: [...(task.noteIds ?? []), note.id] } : task,
                ),
              }
            : old,
        );
      }
      return { note };
    },
  });
};

/** A change to a note (its words, its areas, archived), made here and queued. */
export const useUpdateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      id: string;
      title?: string;
      content?: string;
      archived?: boolean;
      projectIds?: string[];
    }) => {
      outbox.enqueue({ kind: "note.update", body });
      const current = findCachedNote(queryClient, body.id);
      if (!current) return { note: null };
      const { id: _id, ...changes } = body;
      const note: NoteRecord = { ...current, ...changes, updatedAt: new Date() };
      upsertNoteInLists(queryClient, note);
      return { note };
    },
  });
};

export const useDeleteNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { id: string }) => {
      outbox.enqueue({ kind: "note.delete", body });
      removeNoteFromLists(queryClient, body.id);
      return { deleted: true as const };
    },
  });
};

/**
 * Lists kept on the phone from before carried each note's rich text. It moves
 * to the phone's own store for it (noteDocs), so those notes still open
 * exactly as written offline, and the lists drop it. Runs once the kept data
 * is loaded at start; afterwards there is nothing left to move.
 */
export async function moveDocsOutOfLists(queryClient: QueryClient): Promise<void> {
  const docs = new Map<string, { doc: unknown; content: string }>();
  const strip = (notes: NoteRecord[]) => {
    if (!notes.some((note) => note.doc !== undefined)) return null;
    return notes.map((note) => {
      if (note.doc) docs.set(note.id, { doc: note.doc, content: note.content });
      return withoutDoc(note);
    });
  };
  const cache = queryClient.getQueryCache();
  for (const query of cache.findAll({ queryKey: [...NOTES_QUERY_KEY, "list"] })) {
    const data = query.state.data as { notes: NoteRecord[] } | undefined;
    const notes = data && strip(data.notes);
    if (notes) queryClient.setQueryData(query.queryKey, { ...data, notes }, { updatedAt: query.state.dataUpdatedAt });
  }
  for (const query of cache.findAll({ queryKey: [...NOTES_QUERY_KEY, "pages"] })) {
    const data = query.state.data as InfiniteData<NotesPage> | undefined;
    if (!data) continue;
    let changed = false;
    const pages = data.pages.map((page) => {
      const notes = strip(page.notes);
      if (!notes) return page;
      changed = true;
      return { ...page, notes };
    });
    if (changed) queryClient.setQueryData(query.queryKey, { ...data, pages }, { updatedAt: query.state.dataUpdatedAt });
  }
  if (docs.size) await noteDocs.saveMissing(docs);
}

/** Take a note out of every cached list. */
export function removeNoteFromLists(queryClient: QueryClient, id: string) {
  for (const [key, data] of queryClient.getQueriesData<{ notes: NoteRecord[] }>({ queryKey: [...NOTES_QUERY_KEY, "list"] })) {
    if (data?.notes.some((note) => note.id === id)) {
      queryClient.setQueryData(key, { ...data, notes: data.notes.filter((note) => note.id !== id) });
    }
  }
  for (const [key, data] of queryClient.getQueriesData<InfiniteData<NotesPage>>({ queryKey: [...NOTES_QUERY_KEY, "pages"] })) {
    if (!data) continue;
    queryClient.setQueryData(key, {
      ...data,
      pages: data.pages.map((page) => ({ ...page, notes: page.notes.filter((note) => note.id !== id) })),
    });
  }
}

export const useReindexNotes = () => {
  return useMutation({
    mutationFn: (body: { noteId?: string }) => postNotesReindex(body),
    onError: () => {},
  });
};

export { getNote };

/**
 * The note as the lists already hold it, if any list has it: the whole
 * record, text included, so the editor can open it without waiting.
 */
export function findCachedNote(queryClient: QueryClient, id: string): NoteRecord | null {
  const cached = queryClient.getQueriesData<{ notes?: NoteRecord[]; pages?: NotesPage[] }>({
    queryKey: NOTES_QUERY_KEY,
  });
  let best: NoteRecord | null = null;
  for (const [, data] of cached) {
    if (!data) continue;
    const lists = data.pages ? data.pages.map((page) => page.notes) : data.notes ? [data.notes] : [];
    for (const notes of lists) {
      const found = notes.find((note) => note.id === id);
      // The freshest copy, if several lists hold it.
      if (found && (!best || found.updatedAt > best.updatedAt)) best = found;
    }
  }
  return best;
}
