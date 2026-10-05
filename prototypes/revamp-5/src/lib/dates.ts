/**
 * Days as the prototype thinks of them: a plain "yyyy-mm-dd" string in the
 * phone's own time zone, so a task planned for Friday stays on Friday.
 */
export type Day = string;

export function dayOf(date: Date): Day {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateOf(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function today(): Day {
  return dayOf(new Date());
}

export function addDays(day: Day, n: number): Day {
  const date = dateOf(day);
  date.setDate(date.getDate() + n);
  return dayOf(date);
}

/** Whole days from `a` to `b`: positive when `b` is later. */
export function daysBetween(a: Day, b: Day): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86_400_000);
}

/** Monday of the week `day` falls in. */
export function weekStart(day: Day): Day {
  const date = dateOf(day);
  return addDays(day, -((date.getDay() + 6) % 7));
}

/** The coming Saturday, or today when it already is the weekend. */
export function weekend(from: Day = today()): Day {
  const weekday = dateOf(from).getDay();
  if (weekday === 6 || weekday === 0) return from;
  return addDays(from, 6 - weekday);
}

/** Next Monday. */
export function nextWeek(from: Day = today()): Day {
  return addDays(weekStart(from), 7);
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Tomorrow", "Yesterday", "Friday" (this week), else "Mon 12 Oct". */
export function dayLabel(day: Day, from: Day = today()): string {
  const n = daysBetween(from, day);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  const date = dateOf(day);
  if (n > 1 && n < 7) return weekdays[date.getDay()];
  return `${weekdays[date.getDay()].slice(0, 3)} ${date.getDate()} ${months[date.getMonth()]}`;
}

/** A long heading for a day: "Sunday 4 October". */
export function longDay(day: Day): string {
  return dateOf(day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** "2 days late", "a week late", or null when the day hasn't passed. */
export function lateLabel(day: Day, from: Day = today()): string | null {
  const n = daysBetween(day, from);
  if (n <= 0) return null;
  if (n === 1) return "Yesterday";
  if (n < 7) return `${n} days late`;
  if (n < 14) return "A week late";
  return `${Math.floor(n / 7)} weeks late`;
}

/** "9:30" from minutes after midnight. */
export function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

/** "25 min", "1 h 10 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The "Weekend" choice: the coming Saturday, or next week's when it's already the weekend. */
export function nextWeekend(from: Day = today()): Day {
  const weekday = dateOf(from).getDay();
  if (weekday === 6) return addDays(from, 7);
  if (weekday === 0) return addDays(from, 6);
  return addDays(from, 6 - weekday);
}

/** The quick day choices offered wherever a task is moved, as the app has them. */
export function dayChoices(from: Day = today()): { label: string; day: Day | null }[] {
  return [
    { label: "Today", day: from },
    { label: "Tomorrow", day: addDays(from, 1) },
    { label: "Weekend", day: nextWeekend(from) },
    { label: "Next week", day: addDays(from, 7) },
    { label: "No date", day: null },
  ];
}
