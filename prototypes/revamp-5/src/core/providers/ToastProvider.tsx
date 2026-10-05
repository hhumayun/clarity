import React, { createContext, useContext, useMemo } from "react";
import type { IconName } from "../../ui/Icon";
import { useAcknowledge } from "../../ui/Acknowledgement";

/**
 * The main app's toasts, said Sage's way. The core code calls
 * `useToast().show(message)` as it does in the main app. The message appears
 * in the acknowledgement capsule under the top of the screen, with an icon
 * that fits it: a repeat for "Next: Tue", a cross for a change that couldn't
 * be saved, a dot for anything else.
 */
type ToastContextValue = { show: (message: string) => void };

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

function iconFor(message: string): IconName {
  if (/^next\b/i.test(message)) return "repeat";
  if (/couldn['’]t|could not|failed/i.test(message)) return "close";
  return "dot";
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const acknowledge = useAcknowledge();
  const value = useMemo<ToastContextValue>(() => ({ show: (message) => acknowledge(message, iconFor(message)) }), [acknowledge]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}
