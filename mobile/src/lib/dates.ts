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
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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

/**
 * A due day the server sent as a Date whose UTC calendar day is the day
 * (task extraction sends noon UTC), re-pinned to local noon. Reading it with
 * local getters instead would slide it to the day before west of UTC.
 */
export function dueDayAtLocalNoon(date: Date): Date {
  return atNoon(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** "Today", "Tomorrow", else "Fri 25 Sep" — for a chip that names a due day. */
export function dateChipLabel(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return "Today";
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (isSameDay(date, tomorrow)) return "Tomorrow";
  return formatShortDate(date);
}

/** "Tuesday, September 22". */
export function formatLongDate(date: Date): string {
  return `${WEEKDAYS_LONG[date.getDay()]}, ${MONTHS_LONG[date.getMonth()]} ${date.getDate()}`;
}

/** "Sun, Sep 13" — the day a task was planned for. */
export function formatPlannedDate(date: Date): string {
  return `${WEEKDAYS_SHORT[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "Sunday, Sep 13". */
export function formatPlannedDateLong(date: Date): string {
  return `${WEEKDAYS_LONG[date.getDay()]}, ${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "Thu". */
export function formatWeekdayShort(date: Date): string {
  return WEEKDAYS_SHORT[date.getDay()];
}

/** "2:10 pm". */
export function formatClockTime(date: Date): string {
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
}

/** Today plus `days`, at noon. */
export function daysFromToday(days: number, now: Date = new Date()): Date {
  return atNoon(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

/**
 * The coming Saturday. On a Saturday or Sunday that means next week's, since
 * "the weekend" offered as another day should never be today.
 */
export function nextWeekend(now: Date = new Date()): Date {
  const day = now.getDay();
  const ahead = day === 6 ? 7 : 6 - day;
  return daysFromToday(ahead, now);
}
