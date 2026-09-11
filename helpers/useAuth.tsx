import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
} from "react";
import { useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSession } from "../endpoints/auth/session_GET.schema";
import { registerTokenGetter } from "./apiFetch";
import { User } from "./User";

// React Query key for auth session. Make sure to optimistically update user infos using this.
export const AUTH_QUERY_KEY = ["auth", "session"] as const;

// Do not use this state in login/register UI because it's irrelevant. Only use it in UI that requires authentication.
// For pages that requires authentication only in parts of the UI (e.g. typical home page with a user avatar), the loading
// state should not apply to the full page, only to the parts that require authentication.
// Also, global context providers should not be blocked on auth states as it will block the whole page.
type AuthState =
  | {
      // Make sure to display a nice loading state UI when loading authentication state
      type: "loading";
    }
  | {
      type: "authenticated";
      user: User;
    }
  | {
      // Make sure to redirect to login or show auth error UI
      type: "unauthenticated";
      errorMessage?: string;
    };

type AuthContextType = {
  // Use this to display the correct UI based on auth state
  authState: AuthState;
  // Notify the auth provider that we have logged in
  onLogin: (user: User) => void;
  // Clear the auth state and perform the logout request
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Add this to components/_globalContextProviders but not any pageLayout files.
// Make sure it's within the QueryClientProvider and the ClerkProvider.
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient();
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();

  // Let apiFetch attach the Clerk session token to every /_api request.
  useEffect(() => {
    registerTokenGetter(() => getToken());
  }, [getToken]);

  const { data, error, status } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      const result = await getSession();
      if ("error" in result) {
        throw new Error(result.error);
      }
      return result.user;
    },
    retry: 1,
    enabled: isLoaded && isSignedIn === true,
    staleTime: Infinity,
  });

  const authState: AuthState =
    !isLoaded || (isSignedIn && status === "pending")
      ? { type: "loading" }
      : !isSignedIn
        ? { type: "unauthenticated" }
        : status === "error"
          ? {
              type: "unauthenticated",
              errorMessage:
                error instanceof Error ? error.message : "Session check failed",
            }
          : data
            ? { type: "authenticated", user: data }
            : { type: "unauthenticated" };

  const logout = useCallback(async () => {
    // Optimistically update UI
    queryClient.setQueryData(AUTH_QUERY_KEY, null);
    // Sign out of Clerk (clears the session token)
    await signOut();
    // Invalidate all queries after logout so previous user's state don't corrupt new user state.
    queryClient.resetQueries();
  }, [queryClient, signOut]);

  // This should only be used for login. For user profile changes, create separate endpoints and react query hooks
  // and update the data linked to AUTH_QUERY_KEY.
  const onLogin = useCallback(
    (user: User) => {
      queryClient.setQueryData(AUTH_QUERY_KEY, user);
    },
    [queryClient]
  );

  return (
    <AuthContext.Provider value={{ authState, logout, onLogin }}>
      {children}
    </AuthContext.Provider>
  );
};

// Prefer using protectedRoutes instead of this hook unless the route doesn't need to be protected (e.g. login/register)
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within a AuthProvider");
  }
  return context;
};
