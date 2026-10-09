import { onlineManager, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useRef, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { useAuth } from "../providers/AuthProvider";
import { useToast } from "../providers/ToastProvider";
import { photoLedger } from "../../editor/photoLedger";
import { checkPhotoRoom, configureRunner, kick } from "./runner";
import { outbox } from "./store";

/**
 * Starts the outbox for whoever is signed in, and sends it whenever there is
 * a chance: once it is loaded, on reconnecting, and on coming back to the app.
 */
export function SyncProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const { authState } = useAuth();
  const userId = authState.type === "authenticated" ? String(authState.user.id) : null;

  useEffect(() => {
    configureRunner({ queryClient, notify: (message) => toastRef.current.show(message) });
  }, [queryClient]);

  useEffect(() => {
    // With the outbox, the photos only this phone has (revamp 5), for the sign-out warning.
    if (userId) void Promise.all([outbox.load(userId), photoLedger.load(userId)]).then(kick);
  }, [userId]);

  useEffect(
    () =>
      onlineManager.subscribe((online) => {
        if (online) kick();
      }),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") {
        kick();
        void checkPhotoRoom();
      }
    });
    return () => subscription.remove();
  }, []);

  return <>{children}</>;
}

/** How many changes are waiting to reach the server; `{ photos: false }` leaves photos out (revamp 5). */
export function usePendingCount(options?: { photos?: boolean }): number {
  const photos = options?.photos !== false;
  return useSyncExternalStore(outbox.subscribe, () => outbox.pendingCount({ photos }));
}

/** Whether something ("note:<id>", "task:<id>") still has changes waiting. */
export function useIsPending(subject: string | null): boolean {
  return useSyncExternalStore(outbox.subscribe, () => (subject ? outbox.isPending(subject) : false));
}
