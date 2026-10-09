/**
 * When the last API request arrived, so periodic work (the photo sweep,
 * helpers/attachmentSweep.tsx) runs only after real use and an idle server
 * never wakes the database (Neon suspends it after a few idle minutes).
 * Holds no database code, so server.ts can import it before anything else
 * loads. Backend only.
 */
let lastAt = 0;

/** Called by server.ts for every /_api request. */
export function noteApiActivity(): void {
  lastAt = Date.now();
}

/** Epoch ms of the last API request in this process, 0 before the first. */
export function lastApiActivityAt(): number {
  return lastAt;
}
