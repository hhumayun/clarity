import { useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { createContext, useCallback, useContext, useEffect } from "react";
import { getSession } from "../api/session";
import { clearOfflineData } from "../sync/persist";
import { registerTokenGetter } from "../api/apiFetch";
import type { User } from "../types";

export const AUTH_QUERY_KEY = ["auth", "session"] as const;

type AuthState =
  | { type: "loading" }
  | { type: "authenticated"; user: User }
  | { type: "unauthenticated"; errorMessage?: string };

type AuthContextType = {
  authState: AuthState;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();

  useEffect(() => {
    registerTokenGetter(() => getToken());
  }, [getToken]);

  const { data, error, status } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      const result = await getSession();
      if ("error" in result) {
        // The server answered, and it said no: a real sign-out.
        const rejected = new Error(result.error) as Error & { status: number };
        rejected.status = 401;
        throw rejected;
      }
      return result.user;
    },
    retry: 1,
    enabled: isLoaded && isSignedIn === true,
    staleTime: Infinity,
  });

  // No answer from the server (offline, or it is down) is not the same as
  // being signed out: with the session kept on the phone, carry on as before.
  const errorStatus = (error as { status?: unknown } | null)?.status;
  const unreachable = status === "error" && !(typeof errorStatus === "number" && errorStatus < 500);
  const authState: AuthState =
    !isLoaded || (isSignedIn && status === "pending")
      ? { type: "loading" }
      : !isSignedIn
        ? { type: "unauthenticated" }
        : status === "error" && !unreachable
          ? {
              type: "unauthenticated",
              errorMessage:
                error instanceof Error ? error.message : "Session check failed",
            }
          : data
            ? { type: "authenticated", user: data }
            : status === "error"
              ? // Never been online on this phone: nothing to show yet.
                { type: "loading" }
              : { type: "unauthenticated" };

  const logout = useCallback(async () => {
    queryClient.setQueryData(AUTH_QUERY_KEY, null);
    await signOut();
    await clearOfflineData(queryClient);
  }, [queryClient, signOut]);

  return (
    <AuthContext.Provider value={{ authState, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
