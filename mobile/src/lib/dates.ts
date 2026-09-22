/**
 * Date helpers with no React Native imports, so they can be reasoned about —
 * and tested — on their own.
 */

// Written out rather than taken from Intl: these are the only locale-sensitive
// strings here, and a fixed table cannot be affected by whether the JS engine
// happens to ship full ICU data.
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Noon, so a stored date cannot slide to the previous day across timezones. */
export function atNoon(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12, 0, 0, 0);
}

export function isSameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Fri 25 Sep" — short enough to sit inside a chip. */
export function formatShortDate(date: Date): string {
  return `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

/** The calendar day as YYYY-MM-DD in the device's own timezone. */
export function localIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A YYYY-MM-DD read as a local day at noon; null if malformed or not a real day. */
export function fromIsoDay(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = atNoon(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localIsoDay(date) === iso ? date : null;
}

/** "Today", "Tomorrow", else "Fri 25 Sep" — for a chip that names a due day. */
export function dateChipLabel(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return "Today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  return formatShortDate(date);
}
