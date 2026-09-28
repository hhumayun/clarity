import * as chrono from "chrono-node";

/**
 * Reading a due date out of a line of text, with chrono-node rather than a
 * model: instant, free, and the same answer every time. The phone has a
 * copy in mobile/src/lib/dueDate.ts; keep the two in step.
 */

export type DueDateReading = {
  /** The line with the date words (and a dangling "on", "by"…) taken out. */
  text: string;
  /** YYYY-MM-DD, or null when the line names no day. */
  completeBy: string | null;
  /** The words that were read as the date, as written. */
  datePhrase: string | null;
};

// Words left hanging in front of a date once it is taken out of the line.
const CONNECTORS = new Set(["on", "by", "due", "for", "before", "until", "till", "at", "over", "in"]);

// A clock time inside a date phrase: "at 2pm", "10:30", "noon".
const TIME = /(?:\bat\s+)?(?:\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\bnoon\b|\bmidnight\b|\b\d{1,2}\b(?=\s*$))/i;

const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const WEEKDAY_SHORT = "mon|tues?|wed|thu(?:rs?)?|fri|sat|sun";
const MONTH =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

// Ways of saying a day that are hard to mistake for anything else.
const PLAIN_DAY = [
  /\b(?:today|tonight|tomorrow|tmrw?)\b/,
  new RegExp(`\\b(?:${WEEKDAY})\\b`),
  new RegExp(`\\b(?:this|next|coming)\\s+(?:week|weekend|month|year|${WEEKDAY}|${WEEKDAY_SHORT})\\b`),
  /\b(?:in|within)\s+(?:.+\s)?(?:days?|weeks?|fortnights?|months?|years?)\b/,
  /\b(?:days?|weeks?|months?|years?)\s+(?:from now|from today|later|time)\b/,
  new RegExp(`\\b(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH})\\b`),
  /\b\d{1,4}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/,
  /\bthe\s+\d{1,2}(?:st|nd|rd|th)\b/,
  /\bend\s+of\b/,
];
// Words that are also ordinary words or names ("sat nav", "the march",
// "Email April") only count straight after a word that asks for a day.
const LEAD = "on|by|before|until|till|due|for|in|during|this|next|early|late|mid|of";
const LED_DAY = [
  new RegExp(`\\b(?:${LEAD})\\s+(?:${WEEKDAY_SHORT})\\b`),
  new RegExp(`\\b(?:${LEAD})\\s+(?:${MONTH})\\b`),
  /\b(?:(?:at|on|by|over|for)\s+the|this|next)\s+weekend\b/,
];

/**
 * Whether chrono's match is really a day and not a word that happens to look
 * like one: "now", "a day out", "for 2 hours", "sun hat" are not due dates.
 */
function readsAsDueDate(phrase: string, before: string): boolean {
  const lead = before.trim().split(" ").slice(-2).join(" ");
  const context = `${lead} ${phrase}`.toLowerCase();
  const own = phrase.toLowerCase();
  return PLAIN_DAY.some((re) => re.test(own)) || LED_DAY.some((re) => re.test(context));
}

function isoDay(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** chrono's English parser, plus two phrases it misses or misreads. */
const reader = chrono.casual.clone();
// "by the 30th", "on the 2nd": that day of this month, or next month once it
// has passed. Only after a word like "on" or "by": "the 2nd instalment" is not a date.
reader.parsers.push({
  pattern: () => /\b(?:on|by|before|until|till|due|for)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b/i,
  extract: (context, match) => {
    const day = Number(match[1]);
    if (day < 1 || day > 31) return null;
    const ref = context.refDate;
    let year = ref.getFullYear();
    let month = ref.getMonth();
    if (day < ref.getDate()) month += 1;
    // A month without that day (the 31st in September) moves on to one with it.
    for (let tries = 0; tries < 3; tries++) {
      const candidate = new Date(year, month, day, 12);
      if (candidate.getDate() === day) {
        return { day, month: candidate.getMonth() + 1, year: candidate.getFullYear() };
      }
      month += 1;
    }
    return null;
  },
});
// "by May": chrono leaves "May" alone, as it is nearly always the verb. After
// a word that asks for a day it is the month, from its first day.
reader.parsers.push({
  pattern: () => /\b(?:by|in|before|until|till|during|for|early|mid|late)\s+(may)\b/i,
  extract: (context) => {
    const ref = context.refDate;
    const year = ref.getMonth() > 4 ? ref.getFullYear() + 1 : ref.getFullYear();
    return { day: 1, month: 5, year };
  },
});
// "end of the month": its last day. (chrono reads it as "a month from now".)
reader.parsers.push({
  pattern: () => /\b(?:the\s+)?end\s+of\s+(?:the\s+|this\s+)?month\b/i,
  extract: (context) => {
    const ref = context.refDate;
    const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0, 12);
    return { day: last.getDate(), month: last.getMonth() + 1, year: last.getFullYear() };
  },
});

/**
 * The first day the line names, read against `today` (the writer's own day).
 * A bare weekday is the next one, counting today; a time on its own ("at
 * 3pm") names no day and is left in the line.
 */
export function readDueDate(line: string, today: Date): DueDateReading {
  const raw = line.trim().replace(/\s+/g, " ");
  const results = reader.parse(raw, today, { forwardDate: true });
  const found = results.find(
    (r) =>
      (r.start.isCertain("day") || r.start.isCertain("weekday") || r.start.isCertain("month")) &&
      readsAsDueDate(r.text, raw.slice(0, r.index)),
  );
  if (!found) return { text: raw, completeBy: null, datePhrase: null };

  // chrono reads "at 2pm on the 2nd" as one phrase. The day is the due date;
  // the time is part of the task, so it stays in the line.
  const time = found.start.isCertain("hour") ? TIME.exec(found.text)?.[0] ?? "" : "";

  let before = raw.slice(0, found.index).replace(/\s+$/, "");
  const after = raw.slice(found.index + found.text.length).replace(/^\s+/, "");
  // Take a connector left hanging in front of the date with it: "on", or
  // "at the" before "weekend".
  const words = before.split(" ");
  const tail = words.slice(-2).map((word) => word.toLowerCase());
  if (tail.length === 2 && tail[1] === "the" && CONNECTORS.has(tail[0])) before = words.slice(0, -2).join(" ");
  else if (CONNECTORS.has(tail[tail.length - 1] ?? "")) before = words.slice(0, -1).join(" ");
  let text = [before, time, after].filter(Boolean).join(" ").replace(/\s+([,.;:!?])/g, "$1").replace(/^[,;:\s]+|[,;:\s]+$/g, "");
  // A line that began with the date keeps its capital.
  if (text && /^[A-Z]/.test(raw) && found.index === 0) text = text.charAt(0).toUpperCase() + text.slice(1);

  return {
    text: text || raw,
    completeBy: isoDay(found.start.date()),
    datePhrase: raw.slice(found.index, found.index + found.text.length),
  };
}

/** The writer's day (YYYY-MM-DD) as a local date at noon, to read against. */
export function dayAtNoon(isoDayString: string): Date {
  const [y, m, d] = isoDayString.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}
