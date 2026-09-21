/**
 * Calendar helpers with no React Native imports, so they can be reasoned
 * about — and tested — on their own.
 */

// Written out rather than taken from Intl: month names are the only
// locale-sensitive text in the picker, and a fixed table cannot be affected
// by whether the JS engine happens to ship full ICU data.
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const WEEKDAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}`;
}

/** First of the month, used as the picker's view cursor. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Step the view cursor. Built from a Date rather than by adding to the month
 * index so December and January roll the year for us.
 */
export function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

/**
 * Day numbers laid out in whole weeks, starting Sunday. Leading nulls push the
 * 1st under its weekday; trailing nulls pad the last row so the grid keeps its
 * shape.
 */
export function monthGrid(year: number, month: number): Array<number | null> {
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dayCount }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
