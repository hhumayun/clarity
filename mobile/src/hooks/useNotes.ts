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

export const NOTES_QUERY_KEY = ["notes"] as const;

function invalidateNotes(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: NOTES_QUERY_KEY });
}

export const useNotes = (params: ListNotesInput) => {
  return useQuery({
    queryKey: [...NOTES_QUERY_KEY, "list", params],
    queryFn: () => getNotesList(params),
    placeholderData: (previous) => previous,
  });
};

export const useCreateNote = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title?: string; content?: string; source?: "focus" }) =>
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
