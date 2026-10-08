import { createContext } from "react";

/**
 * Where a row sits, given by a look's List around renderRow: the surface it's
 * painted on (TaskRow paints the row's background from it, under the press
 * wash, so a swipe slides the right colour), and whether it's for later in
 * the day (a look may draw it quieter). Without it, the look's own surface.
 */
export type Place = {
  surface?: "card" | "quiet" | "lit" | "page" | "none";
  later?: boolean;
  /** The row is the top, bottom or whole of a rounded card: the swipe's colour and the wash follow its corners. */
  corners?: "top" | "bottom" | "all";
  /** Those corners' radius (default 18). */
  radius?: number;
};
export const RowPlace = createContext<Place | null>(null);
