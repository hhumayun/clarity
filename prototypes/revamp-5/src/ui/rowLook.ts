/**
 * How Today's task rows look, while the user chooses (2026-10-07, see
 * /root/projects/uximprove/tasks): "now", as they were; round 2's "card",
 * "sequence" and "journal" (drawn in TaskRow); and round 3's looks, each in
 * its own file (src/ui/rows). The web build takes `?rows=<id>` (for
 * screenshots); otherwise "now". This goes once one is chosen.
 */
export type RowLook = "now" | "card" | "sequence" | "journal" | (string & {});

export const rowLook: RowLook = (() => {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return "now";
  const asked = new URLSearchParams(window.location.search).get("rows");
  return asked && /^[a-z]+$/.test(asked) ? asked : "now";
})();

/** Rows of a day's tasks (Today, another day) in one of the calmer looks. */
export const calmRows = (variant: string) => rowLook !== "now" && (variant === "today" || variant === "day");
