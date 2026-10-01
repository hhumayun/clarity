/**
 * Helpers for records made on the phone, possibly while offline, and sent
 * later by its outbox. They bring their own id, so a retried create (an
 * answer lost on a bad connection) finds the record already there instead of
 * making a second one.
 */

/** A time the phone says something happened, never later than now. */
export function notInFuture(date: Date | undefined, now: Date = new Date()): Date {
  if (!date || Number.isNaN(date.getTime())) return now;
  return date.getTime() > now.getTime() ? now : date;
}
