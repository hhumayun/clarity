/**
 * How Today's task rows look, while the user chooses (2026-10-07, see
 * /root/projects/uximprove/tasks): "now", as they were; "card", quieter rows
 * on the card; "sequence", the day's times in a column beside the tasks;
 * "journal", lines on the page with the check first. All but "now" show
 * five, then "The rest of today". The web build takes `?rows=` (for
 * screenshots); otherwise "now". This goes once one is chosen.
 */
export type RowLook = "now" | "card" | "sequence" | "journal";

const LOOKS: RowLook[] = ["now", "card", "sequence", "journal"];

export const rowLook: RowLook = (() => {
  if (process.env.EXPO_OS !== "web" || typeof window === "undefined") return "now";
  const asked = new URLSearchParams(window.location.search).get("rows");
  return LOOKS.includes(asked as RowLook) ? (asked as RowLook) : "now";
})();

/** Rows of a day's tasks (Today, another day) in one of the calmer looks. */
export const calmRows = (variant: string) => rowLook !== "now" && (variant === "today" || variant === "day");
