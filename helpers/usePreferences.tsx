import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPreferences } from "../endpoints/preferences_GET.schema";
import { postPreferences } from "../endpoints/preferences_POST.schema";
import { postClearPersonalization } from "../endpoints/account/clear_personalization_POST.schema";

export const PREFERENCES_QUERY_KEY = ["preferences"] as const;

export const usePreferences = () => {
  return useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: () => getPreferences(),
  });
};

export const useUpdatePreferences = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof postPreferences>[0]) =>
      postPreferences(input),
    onSuccess: (data) => {
      queryClient.setQueryData(PREFERENCES_QUERY_KEY, data);
    },
  });
};

export const useClearPersonalization = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postClearPersonalization({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY });
    },
  });
};