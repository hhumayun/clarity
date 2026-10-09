import { attachmentError } from "./endpointError";

/**
 * A per-user brake on calls (docs/photos-server.md, 5.1): a sliding
 * one-minute window kept in memory, per server instance. A restart resets it
 * and two instances would each allow the limit; the database's row and
 * pending limits are the real accounting. Backend only.
 */

const WINDOW_MS = 60_000;
const IDLE_SWEEP_MS = 10 * 60_000;

const calls = new Map<string, number[]>();
let idleTimer: ReturnType<typeof setInterval> | null = null;

/** Forgets users with no call in the last minute, so the map can't grow without end. */
function forgetIdle() {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, times] of calls) {
    if (times.length === 0 || times[times.length - 1] <= cutoff) calls.delete(key);
  }
}

/**
 * Counts one call for this user in the named window, or throws
 * AttachmentError(429, "RATE_LIMITED") when `perMinute` calls were already
 * made in the last minute. A refused call isn't counted.
 */
export function takeToken(bucketName: string, userId: number, perMinute: number): void {
  if (!idleTimer) {
    idleTimer = setInterval(forgetIdle, IDLE_SWEEP_MS);
    // Node's timer has unref (the DOM typings in tsconfig say number): don't
    // keep the process alive just for this.
    (idleTimer as unknown as { unref?: () => void }).unref?.();
  }
  const key = `${bucketName}:${userId}`;
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  const times = (calls.get(key) ?? []).filter((at) => at > cutoff);
  if (times.length >= perMinute) {
    calls.set(key, times);
    throw attachmentError("RATE_LIMITED");
  }
  times.push(now);
  calls.set(key, times);
}
