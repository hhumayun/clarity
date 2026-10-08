import { fills } from "./fills";
import { frontpage } from "./frontpage";
import { lamplight } from "./lamplight";
import { margin } from "./margin";
import { sky } from "./sky";
import type { Look } from "./types";

/**
 * The round-3 looks for Today's rows, by id (see types.ts). Each is in its
 * own file here; the web build picks one with `?rows=<id>`. Goes, but for
 * the one chosen, once the user chooses.
 */
export const looks: Record<string, Look> = { frontpage, lamplight, margin, fills, sky };
