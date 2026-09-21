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
