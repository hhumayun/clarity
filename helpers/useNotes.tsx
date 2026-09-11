import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  getNotesList,
  type InputType as ListInput,
} from "../endpoints/notes/list_GET.schema";
import { getNote } from "../endpoints/notes/get_GET.schema";
import { postNoteCreate } from "../endpoints/notes/create_POST.schema";
import { postNoteUpdate } from "../endpoints/notes/update_POST.schema";
import { postNoteDelete } from "../endpoints/notes/delete_POST.schema";
import { postNotesReindex } from "../endpoints/notes/reindex_POST.schema";

export const NOTES_QUERY_KEY = ["notes"] as const;

function invalidateNotes(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
}

export const useNotes = (params: ListInput) => {
  return useQuery({
    queryKey: [...NOTES_QUERY_KEY, "list", params],
    queryFn: () => getNotesList(params),
    // Keep the previous list on screen while a new search runs, so the page
    // never blinks empty as the writer types.
    placeholderData: (previous) => previous,
  });
};

export const useNote = (id: string | null) => {
  return useQuery({
    queryKey: [...NOTES_QUERY_KEY, "detail", id],
    queryFn: () => getNote({ id: id as string }),
    enabled: Boolean(id),
    staleTime: 0,
  });
};

export const useCreateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof postNoteCreate>[0]) =>
      postNoteCreate(input),
    onSuccess: () => invalidateNotes(queryClient),
  });
};

export const useUpdateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof postNoteUpdate>[0]) =>
      postNoteUpdate(input),
    onSuccess: () => invalidateNotes(queryClient),
  });
};

export const useDeleteNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof postNoteDelete>[0]) =>
      postNoteDelete(input),
    onSuccess: () => invalidateNotes(queryClient),
  });
};

/**
 * Entity indexing runs on its own, after typing settles — it must never make
 * a save or a suggestion wait, and a failure is silent by design.
 */
export const useReindexNotes = () => {
  return useMutation({
    mutationFn: (input: Parameters<typeof postNotesReindex>[0]) =>
      postNotesReindex(input),
    onError: () => {
      // Indexing only improves later suggestions; nothing to tell the writer.
    },
  });
};