/**
 * Quick-add parsing: reads the day and time a person typed into a one-line
 * task, so "Call Dr. Lee tomorrow at 3pm" becomes the title "Call Dr. Lee",
 * tomorrow, 15:00.
 *
 * Self-contained on purpose: no imports and only erasable TypeScript, so the
 * same file runs under Metro and directly under Node's type stripping (see
 * parseTask.test.ts).
 */

export type Day = string;

export type ParsedTask = {
  /** The task's words with the date and time words taken out. */
  title: string;
  /** The day the words name, or the default day when only a time was given; null when nothing was found and there is no default. */
  day: Day | null;
  /** Minutes after midnight, or null. */
  time: number | null;
  /** True when the day or time came from the words (so the UI can show a sparkle). */
  fromText: boolean;
  /** Human label of what was understood, for the date chip: "Tomorrow, 3:00 pm", "Fri 9 Oct", "Today, 9:30 am", or null. */
  label: string | null;
};

export function parseTask(text: string, now: Date, defaultDay?: Day | null): ParsedTask {
  const today = makeDay(now.getFullYear(), now.getMonth(), now.getDate());
  const fallback = defaultDay || null;
  const trimmed = text.trim();
  if (trimmed.length < 4) {
    return {
      title: trimmed,
      day: fallback,
      time: null,
      fromText: false,
      label: fallback ? dayLabel(fallback, today) : null,
    };
  }

  const ctx = scan(trimmed, today);
  const dayHit = findDay(ctx);
  const timeHit = findTime(ctx, dayHit);

  let time = timeHit ? timeHit.minutes : null;
  // "tonight at 9:30" means the evening.
  if (time !== null && timeHit?.clock && dayHit?.tonight && time >= 60 && time < 720) time += 720;

  let day = dayHit ? dayHit.day : null;
  if (day === null && time !== null) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    day = fallback ?? (time > nowMinutes ? today : addDays(today, 1));
  }
  if (day === null) day = fallback;

  const hits: Span[] = [];
  if (dayHit) hits.push(dayHit);
  if (timeHit) hits.push(timeHit);

  return {
    title: buildTitle(ctx, hits),
    day,
    time,
    fromText: dayHit !== null || timeHit !== null,
    label: day === null ? null : dayLabel(day, today) + (time === null ? "" : `, ${timeLabel(time)}`),
  };
}

// ---------------------------------------------------------------------------
// Days: "yyyy-mm-dd" strings in local time. Months are 0-11 inside this file.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The Day for a year, month and date; out-of-range values roll over like Date does. */
function makeDay(year: number, month: number, date: number): Day {
  const d = new Date(year, month, date);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function splitDay(day: Day): [number, number, number] {
  const [y, m, d] = day.split("-").map(Number);
  return [y, m - 1, d];
}

function addDays(day: Day, n: number): Day {
  const [y, m, d] = splitDay(day);
  return makeDay(y, m, d + n);
}

/** Same date n months on, clamped to the end of a shorter month (31 Jan + 1 month = 28 Feb). */
function addMonths(day: Day, n: number): Day {
  const [y, m, d] = splitDay(day);
  const first = new Date(y, m + n, 1);
  const year = first.getFullYear();
  const month = first.getMonth();
  return makeDay(year, month, Math.min(d, daysInMonth(year, month)));
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** 0 = Sunday … 6 = Saturday. */
function weekdayOf(day: Day): number {
  const [y, m, d] = splitDay(day);
  return new Date(y, m, d).getDay();
}

/** Whole days from `a` to `b`, positive when `b` is later. */
function daysBetween(a: Day, b: Day): number {
  const [ay, am, ad] = splitDay(a);
  const [by, bm, bd] = splitDay(b);
  return Math.round((Date.UTC(by, bm, bd) - Date.UTC(ay, am, ad)) / 86_400_000);
}

/** Monday of next week (weeks start on Monday). */
function nextMonday(today: Day): Day {
  return addDays(today, 7 - ((weekdayOf(today) + 6) % 7));
}

/** The coming Saturday, or today when it already is the weekend. */
function weekendOf(today: Day): Day {
  const wd = weekdayOf(today);
  return wd === 6 || wd === 0 ? today : addDays(today, 6 - wd);
}

/** The first Saturday after the weekend `weekendOf` gives. */
function nextWeekendOf(today: Day): Day {
  return weekdayOf(today) === 0 ? addDays(today, 6) : addDays(weekendOf(today), 7);
}

/** The given date this month, or next month once it has passed; clamped to short months. */
function dateThisOrNextMonth(today: Day, date: number): Day | null {
  if (date < 1 || date > 31) return null;
  const [y, m] = splitDay(today);
  const thisMonth = makeDay(y, m, Math.min(date, daysInMonth(y, m)));
  if (thisMonth >= today) return thisMonth;
  const next = new Date(y, m + 1, 1);
  const year = next.getFullYear();
  const month = next.getMonth();
  return makeDay(year, month, Math.min(date, daysInMonth(year, month)));
}

/** A month and date in the given year, or else the next time it comes round (so "Oct 3" after 3 Oct is next year's). */
function monthDate(today: Day, month: number, date: number, year: string | undefined): Day | null {
  if (date < 1 || date > 31) return null;
  if (year) {
    const y = Number(year);
    return date <= daysInMonth(y, month) ? makeDay(y, month, date) : null;
  }
  const thisYear = splitDay(today)[0];
  // A few years of look-ahead only matters for 29 February.
  for (let y = thisYear; y <= thisYear + 8; y++) {
    if (date > daysInMonth(y, month)) continue;
    const day = makeDay(y, month, date);
    if (day >= today) return day;
  }
  return null;
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Tomorrow", "Friday" (2–6 days ahead), else "Fri 9 Oct", with the year when it isn't this year. */
function dayLabel(day: Day, today: Day): string {
  const n = daysBetween(today, day);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  const [y, m, d] = splitDay(day);
  const weekday = WEEKDAY_NAMES[weekdayOf(day)];
  if (n >= 2 && n <= 6) return weekday;
  const label = `${weekday.slice(0, 3)} ${d} ${MONTH_NAMES[m]}`;
  return y === splitDay(today)[0] ? label : `${label} ${y}`;
}

/** "3:00 pm", "9:30 am", "12:00 pm" (noon), "12:00 am" (midnight). */
function timeLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(m)} ${h < 12 ? "am" : "pm"}`;
}

// ---------------------------------------------------------------------------
// Words and patterns. Patterns run on lower-cased text, anchored at the start
// of a word; `matchAt` also checks the match ends where a word ends.

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, weds: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
};

const NUMBERS: Record<string, number> = {
  a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Words that let "sat", "sun" and "the 25th" count as days. */
const DAY_CUES = new Set(["on", "by", "this", "next", "until", "till", "before", "due", "for"]);
/** Words dropped from the title when the cut leaves them dangling ("Book the dentist on [friday]"). */
const DANGLING = new Set(["on", "by", "due", "for", "before", "until", "till", "at"]);
/** "in" and "over" are dropped only along with "the" ("over the weekend"): alone they are usually part of the verb ("log in", "come over"). */
const DANGLING_BEFORE_THE = new Set(["on", "by", "due", "for", "before", "until", "till", "at", "in", "over"]);
/** Cue words left hanging at the very end, after the last cut ("Call Mum tomorrow at"). */
const TRAILING_CUES = /^(?:[\s,;:.!?–—-]*(?:on|by|due|for|before|until|till|at|over|in|the)(?![a-z0-9]))+[\s,;:.!?–—-]*$/;

function alt(words: string[]): string {
  return [...words].sort((a, b) => b.length - a.length).join("|");
}

/** The end of a word: no letter or digit next, not even after an apostrophe, dot, colon, slash or hyphen. */
const B = String.raw`(?![a-z0-9]|['’.:/_@–-][a-z0-9])`;
const WEEKDAY = alt(Object.keys(WEEKDAYS));
const MONTH = alt(Object.keys(MONTHS));
const MONTH_NOT_MAY = alt(Object.keys(MONTHS).filter((w) => w !== "may"));
const NUMBER = `(\\d{1,3}|${alt(Object.keys(NUMBERS))})`;
const UNIT = "(days?|weeks?|fortnights?|months?)";
const ORD = "(?:st|nd|rd|th)";
const YEAR_AFTER = String.raw`(?:,?\s+((?:19|20|21)\d\d)${B})?`;
/** After a day number: not "3 pm" or "3:30", which are times. */
const NOT_A_TIME = String.raw`(?!\s*(?:[ap]\.?m(?![a-z])|[:.]\d))`;
const NO_MERIDIEM = String.raw`(?!\s*[ap]\.?m(?![a-z]))`;

function pattern(source: string): RegExp {
  return new RegExp("^" + source);
}

const RE_TODAY = pattern(String.raw`(today|tonight|tomorrow|tmrw|tmr)${B}`);
const RE_DAY_AFTER = pattern(String.raw`(?:the\s+)?day\s+after\s+(?:tomorrow|tmrw|tmr)${B}`);
const RE_WEEKDAY = pattern(
  String.raw`(?:(this|next)\s+)?(coming\s+)?(${WEEKDAY})${B}(?:,?\s+(this|next)\s+week${B})?`,
);
const RE_WEEK = pattern(String.raw`(this|next)\s+week${B}`);
const RE_WEEKEND = pattern(String.raw`(?:(this|next)\s+|(?:at|over)\s+the\s+)?(?:coming\s+)?weekend${B}`);
const RE_NEXT_MONTH = pattern(String.raw`next\s+month${B}`);
const RE_END_OF_MONTH = pattern(String.raw`end\s+of\s+(?:(the|this|next)\s+)?month${B}`);
const RE_IN_N = pattern(String.raw`in\s+${NUMBER}\s+${UNIT}${B}(?:['’]?\s+time${B})?`);
const RE_N_FROM_NOW = pattern(String.raw`${NUMBER}\s+${UNIT}\s+from\s+now${B}`);
const RE_FORTNIGHT = pattern(String.raw`fortnight${B}`);
const RE_DAY_MONTH = pattern(String.raw`(?:the\s+)?(\d{1,2})${ORD}?(?:\s+of)?\s+(${MONTH})${B}${YEAR_AFTER}`);
const RE_MONTH_DAY = pattern(String.raw`(${MONTH})\s+(?:the\s+)?(\d{1,2})${ORD}?${B}${NOT_A_TIME}${YEAR_AFTER}`);
const RE_ISO = pattern(String.raw`((?:19|20|21)\d\d)-(\d{1,2})-(\d{1,2})${B}`);
const RE_NTH = pattern(String.raw`(?:the\s+)?(\d{1,2})${ORD}${B}`);
const RE_IN_MONTH = pattern(
  String.raw`(?:in|by)\s+(${MONTH_NOT_MAY})${B}(?:\s+((?:19|20|21)\d\d)${B})?(?!\s+(?:the\s+)?\d)`,
);
const RE_MERIDIEM = pattern(String.raw`(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*([ap])(?:\.m\.?|m)${B}`);
const RE_NAMED_TIME = pattern(String.raw`(?:at\s+)?(?:12\s+)?(noon|midday|midnight)${B}`);
const RE_AT_CLOCK = pattern(String.raw`at\s+(\d{1,2})[:.](\d{2})${B}${NO_MERIDIEM}`);
const RE_CLOCK = pattern(String.raw`(\d{1,2}):(\d{2})${B}${NO_MERIDIEM}`);

// ---------------------------------------------------------------------------
// Scanning

type Token = { start: number; end: number; word: string };
type Ctx = {
  text: string;
  lower: string;
  tokens: Token[];
  /** Index of the token each character belongs to, or -1. */
  owner: number[];
  today: Day;
};
type Span = { start: number; end: number };
type DayHit = Span & { day: Day; tonight?: boolean };
type TimeHit = Span & { minutes: number; clock: boolean };
type Match = Span & { m: RegExpExecArray };

/** Apostrophes, dots, colons and the like join a word when a letter or digit follows: "Mum's", "3:30", "12/10", "2026-10-12". */
const JOINERS = "'’.:/_@–-";

function isWordChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  return (c >= "0" && c <= "9") || c.toLowerCase() !== c.toUpperCase();
}

function scan(text: string, today: Day): Ctx {
  let lower = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i].toLowerCase();
    lower += c.length === 1 ? c : text[i]; // keep positions lined up with the original
  }
  const tokens: Token[] = [];
  const owner = new Array<number>(text.length).fill(-1);
  let i = 0;
  while (i < text.length) {
    if (!isWordChar(text[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < text.length && (isWordChar(text[i]) || (JOINERS.includes(text[i]) && isWordChar(text[i + 1])))) i++;
    for (let k = start; k < i; k++) owner[k] = tokens.length;
    tokens.push({ start, end: i, word: lower.slice(start, i) });
  }
  return { text, lower, tokens, owner, today };
}

function matchAt(ctx: Ctx, ti: number, re: RegExp): Match | null {
  const start = ctx.tokens[ti].start;
  const m = re.exec(ctx.lower.slice(start));
  if (!m) return null;
  const end = start + m[0].length;
  // Whole words only: "friday" but not "fridays", "friday's" or "12/10".
  if (end < ctx.text.length && ctx.owner[end] !== -1 && ctx.owner[end - 1] !== -1) return null;
  return { start, end, m };
}

/** The word right before token `ti`, when only spaces separate them. */
function previousWord(ctx: Ctx, ti: number): string {
  if (ti === 0) return "";
  const prev = ctx.tokens[ti - 1];
  return /^\s+$/.test(ctx.text.slice(prev.end, ctx.tokens[ti].start)) ? prev.word : "";
}

// ---------------------------------------------------------------------------
// Days

function dayMonthRule(ctx: Ctx, ti: number): DayHit | null {
  const r = matchAt(ctx, ti, RE_DAY_MONTH);
  const day = r && monthDate(ctx.today, MONTHS[r.m[2]], Number(r.m[1]), r.m[3]);
  return r && day ? { start: r.start, end: r.end, day } : null;
}

function monthDayRule(ctx: Ctx, ti: number): DayHit | null {
  const r = matchAt(ctx, ti, RE_MONTH_DAY);
  const day = r && monthDate(ctx.today, MONTHS[r.m[1]], Number(r.m[2]), r.m[3]);
  return r && day ? { start: r.start, end: r.end, day } : null;
}

function isoRule(ctx: Ctx, ti: number): DayHit | null {
  const r = matchAt(ctx, ti, RE_ISO);
  if (!r) return null;
  const [year, month, date] = [Number(r.m[1]), Number(r.m[2]) - 1, Number(r.m[3])];
  if (month < 0 || month > 11 || date < 1 || date > daysInMonth(year, month)) return null;
  return { start: r.start, end: r.end, day: makeDay(year, month, date) };
}

/** After "the 2nd": an ordinary word ("floor", "time") means an ordinal, not a date. */
const NOUN_AFTER = /^\s+(?!(?:and|or|then|at|from|to|by|before|until|till|next|this|noon|midday|midnight)(?![a-z]))[a-z]/;

/** "the 25th": needs a cue word before it ("by the 25th") unless it follows a weekday ("Friday the 9th"). */
function nthRule(ctx: Ctx, ti: number, afterWeekday: boolean): DayHit | null {
  if (!afterWeekday && !DAY_CUES.has(previousWord(ctx, ti))) return null;
  const r = matchAt(ctx, ti, RE_NTH);
  if (!r) return null;
  // "on the 2nd floor", "for the 1st time" — unless the phrase opens the task ("On the 25th pay rent").
  if (!afterWeekday && ti > 1 && NOUN_AFTER.test(ctx.lower.slice(r.end))) return null;
  const day = dateThisOrNextMonth(ctx.today, Number(r.m[1]));
  return day ? { start: r.start, end: r.end, day } : null;
}

/** A date right after a weekday, so "Fri 9 Oct" and "Friday the 9th" read as one phrase. */
function dateAfter(ctx: Ctx, end: number): DayHit | null {
  const ti = ctx.tokens.findIndex((t) => t.start >= end);
  if (ti === -1 || !/^\s*,?\s*$/.test(ctx.text.slice(end, ctx.tokens[ti].start))) return null;
  return dayMonthRule(ctx, ti) ?? monthDayRule(ctx, ti) ?? isoRule(ctx, ti) ?? nthRule(ctx, ti, true);
}

function shift(today: Day, count: string, unit: string): Day {
  const n = /^\d/.test(count) ? Number(count) : NUMBERS[count];
  if (unit.startsWith("month")) return addMonths(today, n);
  return addDays(today, n * (unit.startsWith("fortnight") ? 14 : unit.startsWith("week") ? 7 : 1));
}

const DAY_RULES: Array<(ctx: Ctx, ti: number) => DayHit | null> = [
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_TODAY);
    if (!r) return null;
    const word = r.m[1];
    const isToday = word === "today" || word === "tonight";
    return { start: r.start, end: r.end, day: isToday ? ctx.today : addDays(ctx.today, 1), tonight: word === "tonight" };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_DAY_AFTER);
    return r && { start: r.start, end: r.end, day: addDays(ctx.today, 2) };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_WEEKDAY);
    if (!r) return null;
    const [, before, coming, name, after] = r.m;
    const date = after ? null : dateAfter(ctx, r.end);
    if (date) return { start: r.start, end: date.end, day: date.day };
    // "sun hat", "sat nav": the short forms only count after a cue word.
    if ((name === "sat" || name === "sun") && !before && !coming && !after && !DAY_CUES.has(previousWord(ctx, ti))) {
      return null;
    }
    const target = WEEKDAYS[name];
    const day =
      before === "next" || after === "next"
        ? addDays(nextMonday(ctx.today), (target + 6) % 7)
        : addDays(ctx.today, (target - weekdayOf(ctx.today) + 7) % 7);
    return { start: r.start, end: r.end, day };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_WEEK);
    return r && { start: r.start, end: r.end, day: r.m[1] === "next" ? nextMonday(ctx.today) : ctx.today };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_WEEKEND);
    return r && { start: r.start, end: r.end, day: r.m[1] === "next" ? nextWeekendOf(ctx.today) : weekendOf(ctx.today) };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_NEXT_MONTH);
    if (!r) return null;
    const [y, m] = splitDay(ctx.today);
    return { start: r.start, end: r.end, day: makeDay(y, m + 1, 1) };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_END_OF_MONTH);
    if (!r) return null;
    const [y, m] = splitDay(ctx.today);
    return { start: r.start, end: r.end, day: makeDay(y, m + (r.m[1] === "next" ? 2 : 1), 0) };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_IN_N) ?? matchAt(ctx, ti, RE_N_FROM_NOW);
    return r && { start: r.start, end: r.end, day: shift(ctx.today, r.m[1], r.m[2]) };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_FORTNIGHT);
    return r && { start: r.start, end: r.end, day: addDays(ctx.today, 14) };
  },
  dayMonthRule,
  monthDayRule,
  isoRule,
  (ctx, ti) => nthRule(ctx, ti, false),
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_IN_MONTH);
    if (!r) return null;
    const month = MONTHS[r.m[1]];
    const thisYear = splitDay(ctx.today)[0];
    let day = makeDay(r.m[2] ? Number(r.m[2]) : thisYear, month, 1);
    if (!r.m[2] && day < ctx.today) day = makeDay(thisYear + 1, month, 1);
    return { start: r.start, end: r.end, day };
  },
];

/** The first day phrase in the text; at one spot the longest reading wins ("next friday" over "friday"). */
function findDay(ctx: Ctx): DayHit | null {
  for (let ti = 0; ti < ctx.tokens.length; ti++) {
    let best: DayHit | null = null;
    for (const rule of DAY_RULES) {
      const hit = rule(ctx, ti);
      if (hit && (!best || hit.end > best.end)) best = hit;
    }
    if (best) return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Times

function clockAt(ctx: Ctx, ti: number, re: RegExp): TimeHit | null {
  const r = matchAt(ctx, ti, re);
  if (!r) return null;
  const hour = Number(r.m[1]);
  const minute = Number(r.m[2]);
  if (hour > 23 || minute > 59) return null;
  return { start: r.start, end: r.end, minutes: hour * 60 + minute, clock: true };
}

/** A bare "9:30" counts only right next to the day phrase: "tomorrow 9:30", "9:30 on friday". */
function nextTo(ctx: Ctx, time: Span, day: Span): boolean {
  if (time.start >= day.end) return /^[\s,]+$/.test(ctx.text.slice(day.end, time.start));
  if (time.end <= day.start) {
    return /^[\s,]+(?:(?:on|by|due|for|before|until|till|the)\s+)*$/.test(ctx.lower.slice(time.end, day.start));
  }
  return false;
}

const TIME_RULES: Array<(ctx: Ctx, ti: number, day: DayHit | null) => TimeHit | null> = [
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_MERIDIEM);
    if (!r) return null;
    const hour = Number(r.m[1]);
    const minute = r.m[2] ? Number(r.m[2]) : 0;
    if (hour < 1 || hour > 12 || minute > 59) return null;
    return { start: r.start, end: r.end, minutes: ((hour % 12) + (r.m[3] === "p" ? 12 : 0)) * 60 + minute, clock: false };
  },
  (ctx, ti) => {
    const r = matchAt(ctx, ti, RE_NAMED_TIME);
    return r && { start: r.start, end: r.end, minutes: r.m[1] === "midnight" ? 0 : 720, clock: false };
  },
  (ctx, ti) => clockAt(ctx, ti, RE_AT_CLOCK),
  (ctx, ti, day) => {
    const hit = day && clockAt(ctx, ti, RE_CLOCK);
    return hit && day && nextTo(ctx, hit, day) ? hit : null;
  },
];

/** The first time phrase outside the day phrase. */
function findTime(ctx: Ctx, day: DayHit | null): TimeHit | null {
  for (let ti = 0; ti < ctx.tokens.length; ti++) {
    let best: TimeHit | null = null;
    for (const rule of TIME_RULES) {
      const hit = rule(ctx, ti, day);
      if (hit && (!best || hit.end > best.end)) best = hit;
    }
    if (best && !(day && best.start < day.end && day.start < best.end)) return best;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Title

function buildTitle(ctx: Ctx, hits: Span[]): string {
  const { text, lower, tokens, owner } = ctx;
  const n = text.length;
  const cut = new Array<boolean>(n).fill(false);
  const cutRange = (from: number, to: number) => {
    for (let i = from; i < to; i++) cut[i] = true;
  };
  for (const hit of hits) cutRange(hit.start, hit.end);

  /** The word just before `pos`, with only spaces between. */
  const wordBefore = (pos: number): Token | null => {
    let i = pos - 1;
    while (i >= 0 && !cut[i] && /\s/.test(text[i])) i--;
    if (i < 0 || cut[i] || owner[i] === -1) return null;
    return tokens[owner[i]];
  };
  /** Whether a kept word follows the cut ending at `end`. */
  const wordAfter = (end: number): boolean => {
    let i = end;
    while (i < n && (cut[i] || /\s/.test(text[i]))) i++;
    return i < n && owner[i] !== -1;
  };

  // Drop cue words left dangling before each cut: "on [friday]", "by [the 25th]", "due by [friday]".
  for (const hit of hits) {
    let pos = hit.start;
    const take = (t: Token) => {
      cutRange(t.start, pos);
      pos = t.start;
    };
    // "Dentist @ 3pm"
    let at = pos - 1;
    while (at >= 0 && !cut[at] && /\s/.test(text[at])) at--;
    if (at >= 0 && !cut[at] && text[at] === "@") {
      cutRange(at, pos);
      pos = at;
    }
    let w = wordBefore(pos);
    if (w && w.word === "the") {
      if (wordAfter(hit.end)) continue; // "for the [3pm] meeting": "the" belongs to "meeting"
      take(w);
      w = wordBefore(pos);
      if (!w || !DANGLING_BEFORE_THE.has(w.word)) continue;
    } else if (!w || !DANGLING.has(w.word)) {
      continue;
    }
    take(w);
    const due = w.word === "due" ? null : wordBefore(pos);
    if (due && due.word === "due") take(due);
  }

  // And cue words left hanging at the very end: "Call Mum [tomorrow] at".
  let last = n - 1;
  while (last >= 0 && !cut[last]) last--;
  if (last >= 0 && TRAILING_CUES.test(lower.slice(last + 1))) cutRange(last + 1, n);

  // Stitch the kept pieces together, tidying the seams.
  const pieces: string[] = [];
  let piece = "";
  for (let i = 0; i < n; i++) {
    if (!cut[i]) piece += text[i];
    else if (i === 0 || !cut[i - 1]) {
      pieces.push(piece);
      piece = "";
    }
  }
  pieces.push(piece);

  let title = "";
  for (const p of pieces) {
    let left = title.trimEnd();
    let right = p.trimStart();
    if (/[(\[]$/.test(left) && /^[)\]]/.test(right)) {
      left = left.slice(0, -1).trimEnd(); // "Call Mum (tomorrow)" leaves no "()"
      right = right.slice(1).trimStart();
    }
    if (!left || !right) title = left + right;
    else if (/^[,.;:!?)\]]/.test(right)) title = left.replace(/[\s,;:–—-]+$/, "") + right;
    else if (/[–—-]$/.test(left) && /^[–—-]/.test(right)) title = `${left} ${right.replace(/^[–—-]+\s*/, "")}`;
    else title = `${left} ${right}`;
  }
  title = title.replace(/\s+/g, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "");

  // A capital first letter stays capital; so does the new first word when the start was taken out.
  const startCut = tokens.length > 0 && cut[tokens[0].start];
  const first = text.charAt(0);
  if (title && (startCut || first !== first.toLowerCase())) title = title.charAt(0).toUpperCase() + title.slice(1);
  return title;
}
