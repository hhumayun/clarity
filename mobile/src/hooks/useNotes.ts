import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getNote,
  getNotesList,
  postNoteCreate,
  postNoteDelete,
  postNoteUpdate,
  postNotesReindex,
  type ListNotesInput,
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
