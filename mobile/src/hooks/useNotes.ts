import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getNote,
  getNoteCounts,
  getNotesList,
  getNotesPage,
  postNoteCreate,
  postNoteDelete,
  postNoteUpdate,
  postNotesReindex,
  type ListNotesInput,
  type NotesPage,
} from "../api/notes";

import type { NoteRecord } from "../types";

export const NOTES_QUERY_KEY = ["notes"] as const;

function invalidateNotes(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
}

export const useNotes = (params: ListNotesInput, opts: { enabled?: boolean } = {}) => {
  return useQuery({
    queryKey: [...NOTES_QUERY_KEY, "list", params],
    queryFn: () => getNotesList(params),
    enabled: opts.enabled ?? true,
    placeholderData: (previous) => previous,
  });
};

/** Notes per page of the Notes list; older pages load as you scroll. */
export const NOTES_PAGE_SIZE = 50;

/** The Notes list in pages, newest written first. */
export const useNotesPages = (params: ListNotesInput, opts: { enabled?: boolean } = {}) => {
  return useInfiniteQuery({
    queryKey: [...NOTES_QUERY_KEY, "pages", params],
    queryFn: ({ pageParam }) => getNotesPage({ ...params, limit: NOTES_PAGE_SIZE, cursor: pageParam }),
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
 * Put a note the editor just saved into every cached list it belongs in, so
 * it shows the moment you go back rather than after the next fetch. The
 * editor saves through the API directly (it debounces its own writes), so
 * nothing else would tell the lists. Lists filtered by a search are only
 * updated in place, never added to: whether a note matches a search is the
 * server's call, and the refetch on return settles it.
 */
export function upsertNoteInLists(queryClient: QueryClient, note: NoteRecord) {
  const lists = queryClient.getQueriesData<{ notes: NoteRecord[] }>({
    queryKey: [...NOTES_QUERY_KEY, "list"],
  });
  for (const [key, data] of lists) {
    if (!data) continue;
    const params = (key[2] ?? {}) as ListNotesInput;
    const index = data.notes.findIndex((n) => n.id === note.id);
    const belongs =
      Boolean(params.archived) === note.archived &&
      !params.q &&
      (!params.from || note.createdAt >= params.from) &&
      (!params.to || note.createdAt < params.to);
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
    const belongs =
      Boolean(params.archived) === note.archived &&
      !params.q &&
      (!params.from || note.createdAt >= params.from) &&
      (!params.to || note.createdAt < params.to);
    const next = upsertInPages(data, note, belongs, Boolean(params.q));
    if (next) queryClient.setQueryData(key, next);
  }
  // Mark them stale too, so the next look at a list fetches the truth.
  void queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY, refetchType: "none" });
}

export const useCreateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; content?: string; source?: "focus"; projectIds?: string[] }) =>
      postNoteCreate(body),
    onSuccess: () => invalidateNotes(queryClient),
  });
};

export const useUpdateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      id: string;
      title?: string;
      content?: string;
      archived?: boolean;
      projectIds?: string[];
    }) => postNoteUpdate(body),
    onSuccess: () => invalidateNotes(queryClient),
  });
};

export const useDeleteNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string }) => postNoteDelete(body),
    onSuccess: () => invalidateNotes(queryClient),
  });
};

export const useReindexNotes = () => {
  return useMutation({
    mutationFn: (body: { noteId?: string }) => postNotesReindex(body),
    onError: () => {},
  });
};

export { getNote, postNoteCreate, postNoteUpdate };
