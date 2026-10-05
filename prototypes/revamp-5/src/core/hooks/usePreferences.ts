import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPreferences,
  postClearPersonalization,
  postPreferences,
} from "../api/account";

export const PREFERENCES_QUERY_KEY = ["preferences"] as const;

export const usePreferences = () =>
  useQuery({
    queryKey: PREFERENCES_QUERY_KEY,
    queryFn: () => getPreferences(),
  });

export const useUpdatePreferences = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { usePersonalization: boolean }) => postPreferences(body),
    onSuccess: (data) => queryClient.setQueryData(PREFERENCES_QUERY_KEY, data),
  });
};

export const useClearPersonalization = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postClearPersonalization(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: PREFERENCES_QUERY_KEY }),
  });
};
