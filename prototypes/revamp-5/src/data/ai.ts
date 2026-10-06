import { useDevice } from "../state/device";
import { useDataMode, useOnline } from "./sage";

/**
 * AI help, decided on 2026-10-06: it reads what you write only when you've
 * said yes (the opening screens, or Settings), and only through AI companies
 * that keep nothing (the server asks for zero data retention). When it's off,
 * nothing is sent to an AI: Sage's own questions and text stand in.
 *
 * The samples never send anything anywhere, so looking around they show the
 * AI features unless AI help was turned off on this phone.
 */
export function useAiOn(): boolean {
  const demo = useDataMode((state) => state.mode) === "demo";
  const ai = useDevice((state) => state.ai);
  return ai === "on" || (demo && ai === null);
}

/** AI help can answer now: it's on and, for your account, the phone has a connection. */
export function useAiReady(): boolean {
  const on = useAiOn();
  const online = useOnline();
  const demo = useDataMode((state) => state.mode) === "demo";
  return on && (demo || online);
}

/** The same, outside render (an action, a callback). */
export function aiOn(): boolean {
  const ai = useDevice.getState().ai;
  return ai === "on" || (useDataMode.getState().mode === "demo" && ai === null);
}

/** What the opening screens and the once-only question say. */
export const AI_CHOICE = {
  title: "Gentle help",
  body: "With AI help on, Clarity finds the tasks in what you write, asks questions that go a little deeper, and offers a word when one is hard to find. To do that, what it reads is sent to AI companies that don't keep it or use it for training.",
  later: "You can change this any time in Settings.",
};
