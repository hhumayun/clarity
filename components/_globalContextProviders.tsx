import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClerkProvider } from "@clerk/clerk-react";
import { ThemeModeProvider } from "../helpers/themeMode";
import { AuthProvider } from "../helpers/useAuth";
import { ClaritySettingsProvider } from "../helpers/useClaritySettings";
import { TooltipProvider } from "./Tooltip";
import { SonnerToaster } from "./SonnerToaster";
import { ScrollToHashElement } from "./ScrollToHashElement";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute "fresh" window
    },
  },
});

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export const GlobalContextProviders = ({
  children,
}: {
  children: ReactNode;
}) => {
  if (!clerkPublishableKey) {
    return (
      <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Missing Clerk configuration</h1>
        <p>
          Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in your <code>.env</code>{" "}
          file and restart the dev server.
        </p>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <QueryClientProvider client={queryClient}>
        <ThemeModeProvider>
          <AuthProvider>
            <ClaritySettingsProvider>
              <ScrollToHashElement />
              <TooltipProvider>
                {children}
                <SonnerToaster />
              </TooltipProvider>
            </ClaritySettingsProvider>
          </AuthProvider>
        </ThemeModeProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
};
