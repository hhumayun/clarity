import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

let started = false;

/**
 * Tell React Query when the phone is online (from NetInfo) and when the app
 * is in front (from AppState). Offline, queries pause and keep showing what
 * they have, instead of failing; back online, they refresh by themselves.
 */
export function startNetworkWatch() {
  if (started) return;
  started = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      // Unknown reachability (null) counts as online; only a definite no is offline.
      setOnline(state.isConnected !== false && state.isInternetReachable !== false);
    }),
  );
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener("change", (status) => handleFocus(status === "active"));
    return () => subscription.remove();
  });
}

/** Whether the phone has a connection right now. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
