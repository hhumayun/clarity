// @ts-nocheck -- imports with a ".ts" extension, which only Node's type stripping understands.
// Run from the project root: /opt/node24/bin/node src/lib/parseTask.test.ts
// Plain script, no test framework. Metro never loads this file.
import { parseTask } from "./parseTask.ts";

const SUN = new Date(2026, 9, 4, 10, 0); // Sunday 4 Oct 2026, 10:00 (the fixed "now")
const WED = new Date(2026, 9, 7, 14, 0); // Wednesday 7 Oct 2026, 14:00
const SAT = new Date(2026, 9, 10, 9, 0); // Saturday 10 Oct 2026, 09:00
const LATE = new Date(2026, 9, 4, 22, 30); // Sunday 4 Oct 2026, 22:30
const DEC = new Date(2026, 11, 20, 12, 0); // Sunday 20 Dec 2026, 12:00
const JAN31 = new Date(2027, 0, 31, 9, 0); // Sunday 31 Jan 2027, 09:00

let passed = 0;
let failed = 0;

function when(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One assertion per expected field. */
function check(input, expected, now = SUN, defaultDay = undefined) {
  const actual = parseTask(input, now, defaultDay);
  for (const [key, want] of Object.entries(expected)) {
    if (actual[key] === want) {
      passed++;
    } else {
      failed++;
      const ctx = `now ${when(now)}${defaultDay ? `, default ${defaultDay}` : ""}`;
      console.log(
        `FAIL ${JSON.stringify(input)} (${ctx}) ${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual[key])}`,
      );
    }
  }
}

const NOTHING = { day: null, time: null, fromText: false, label: null };

// --- The examples from the brief --------------------------------------------
check("Call Dr. Lee tomorrow at 3pm", { title: "Call Dr. Lee", day: "2026-10-05", time: 900, fromText: true, label: "Tomorrow, 3:00 pm" });
check("Book the dentist on friday at 10am", { title: "Book the dentist", day: "2026-10-09", time: 600, label: "Friday, 10:00 am" });
check("Pay rent by the 25th", { title: "Pay rent", day: "2026-10-25", time: null, label: "Sun 25 Oct" });
check("tomorrow call Mum", { title: "Call Mum", day: "2026-10-05", label: "Tomorrow" });

// --- Under 4 characters: not read at all ----------------------------------------
check("tmr", { title: "tmr", ...NOTHING });
check("tmr", { title: "tmr", day: "2026-10-09", time: null, fromText: false, label: "Friday" }, SUN, "2026-10-09");
check("  3pm  ", { title: "3pm", ...NOTHING });
check("Fri", { title: "Fri", day: "2026-10-04", fromText: false, label: "Today" }, SUN, "2026-10-04");
check("tmrw", { title: "", day: "2026-10-05", fromText: true, label: "Tomorrow" });

// --- today / tonight / tomorrow ---------------------------------------------------
check("Call Mum today", { title: "Call Mum", day: "2026-10-04", label: "Today" });
check("Pub quiz tonight", { title: "Pub quiz", day: "2026-10-04" });
check("Bins out tmrw", { title: "Bins out", day: "2026-10-05" });
check("Bins out tmr", { title: "Bins out", day: "2026-10-05" });
check("Ring the bank TOMORROW", { title: "Ring the bank", day: "2026-10-05" });
check("Call Mum the day after tomorrow", { title: "Call Mum", day: "2026-10-06", label: "Tuesday" });
check("Review today's notes", { title: "Review today's notes", ...NOTHING });

// --- Weekdays (now = Sunday 4 Oct) ------------------------------------------------
check("Dentist friday", { title: "Dentist", day: "2026-10-09", label: "Friday" });
check("Dentist fri", { day: "2026-10-09" });
check("Gym on tue", { title: "Gym", day: "2026-10-06", label: "Tuesday" });
check("Gym tues", { day: "2026-10-06" });
check("Report thurs", { day: "2026-10-08" });
check("Report thur", { day: "2026-10-08" });
check("Report thu", { day: "2026-10-08" });
check("Swim wed", { day: "2026-10-07" });
check("Standup mon", { day: "2026-10-05", label: "Tomorrow" });
check("Lunch on sat", { title: "Lunch", day: "2026-10-10", label: "Saturday" });
check("Roast on sun", { title: "Roast", day: "2026-10-04", label: "Today" });
check("Lunch sun", { title: "Lunch sun", ...NOTHING });
check("Picnic sat", { title: "Picnic sat", ...NOTHING });
check("Brunch on Sunday", { title: "Brunch", day: "2026-10-04" });
check("Brunch this sunday", { day: "2026-10-04" });
check("Brunch next sunday", { day: "2026-10-11", label: "Sun 11 Oct" });
check("Dentist this coming friday", { title: "Dentist", day: "2026-10-09" });
check("Call Fridays", { title: "Call Fridays", ...NOTHING });
check("Prep for friday's meeting", { title: "Prep for friday's meeting", day: null });

// --- Weekdays (now = Wednesday 7 Oct) --------------------------------------------
check("Dentist friday", { day: "2026-10-09", label: "Friday" }, WED);
check("Dentist this friday", { day: "2026-10-09" }, WED);
check("Dentist next friday", { title: "Dentist", day: "2026-10-16", label: "Fri 16 Oct" }, WED);
check("Dentist friday next week", { title: "Dentist", day: "2026-10-16" }, WED);
check("Team lunch wednesday", { day: "2026-10-07", label: "Today" }, WED);
check("Team lunch next wednesday", { day: "2026-10-14", label: "Wed 14 Oct" }, WED);
check("Gym monday", { day: "2026-10-12", label: "Monday" }, WED);
check("Submit report until next friday", { title: "Submit report", day: "2026-10-16" }, WED);

// --- Weeks and weekends ---------------------------------------------------------
check("Plan trip next week", { title: "Plan trip", day: "2026-10-05", label: "Tomorrow" });
check("Tidy desk this week", { title: "Tidy desk", day: "2026-10-04" });
check("Plan trip next week", { day: "2026-10-12", label: "Monday" }, WED);
check("Clean car at the weekend", { title: "Clean car", day: "2026-10-04" }); // Sunday: today
check("Clean car next weekend", { day: "2026-10-10", label: "Saturday" });
check("Clean car this weekend", { day: "2026-10-10", label: "Saturday" }, WED);
check("Read over the weekend", { title: "Read", day: "2026-10-10" }, WED);
check("Wash car in the weekend", { title: "Wash car", day: "2026-10-10" }, WED);
check("Clean car weekend", { day: "2026-10-10" }, WED);
check("Clean car next weekend", { day: "2026-10-17", label: "Sat 17 Oct" }, WED);
check("Clean car weekend", { day: "2026-10-10", label: "Today" }, SAT);
check("Clean car next weekend", { day: "2026-10-17", label: "Sat 17 Oct" }, SAT);
check("Park run on sat", { title: "Park run", day: "2026-10-10" }, SAT);
check("Park run next sat", { day: "2026-10-17" }, SAT);
check("Roast sunday", { day: "2026-10-11", label: "Tomorrow" }, SAT);

// --- Months -----------------------------------------------------------------------
check("Book flights next month", { title: "Book flights", day: "2026-11-01", label: "Sun 1 Nov" });
check("Pay invoice by the end of the month", { title: "Pay invoice", day: "2026-10-31", label: "Sat 31 Oct" });
check("Invoices end of month", { title: "Invoices", day: "2026-10-31" });
check("Invoices end of this month", { day: "2026-10-31" });
check("Renew insurance next month", { day: "2027-01-01", label: "Fri 1 Jan 2027" }, DEC);
check("Expenses end of the month", { day: "2026-12-31", label: "Thu 31 Dec" }, DEC);

// --- in N days / weeks / months -----------------------------------------------------
check("Follow up in 3 days", { title: "Follow up", day: "2026-10-07", label: "Wednesday" });
check("Follow up in three days", { day: "2026-10-07" });
check("Review in two weeks", { title: "Review", day: "2026-10-18", label: "Sun 18 Oct" });
check("Review in 2 weeks' time", { title: "Review", day: "2026-10-18" });
check("Review in a week", { title: "Review", day: "2026-10-11" });
check("Review in a fortnight", { title: "Review", day: "2026-10-18" });
check("Review fortnight", { title: "Review", day: "2026-10-18" });
check("Call back 3 days from now", { title: "Call back", day: "2026-10-07" });
check("Call back two weeks from now", { title: "Call back", day: "2026-10-18" });
check("Renew in 2 months", { day: "2026-12-04", label: "Fri 4 Dec" });
check("Renew in twelve days", { day: "2026-10-16", label: "Fri 16 Oct" });
check("Renew in a month", { day: "2027-02-28" }, JAN31); // 31 Jan + 1 month clamps to 28 Feb

// --- Month-day dates --------------------------------------------------------------
check("Dentist Oct 12", { title: "Dentist", day: "2026-10-12", label: "Mon 12 Oct" });
check("Dentist October 12th", { day: "2026-10-12" });
check("Dentist 12 Oct", { title: "Dentist", day: "2026-10-12" });
check("Dentist 12th of October", { title: "Dentist", day: "2026-10-12" });
check("Dentist 12 October", { day: "2026-10-12" });
check("Dentist on the 12th of October", { title: "Dentist", day: "2026-10-12" });
check("Dentist Oct 4", { day: "2026-10-04", label: "Today" });
check("Dentist Oct 3", { day: "2027-10-03", label: "Sun 3 Oct 2027" }); // passed: next year
check("Party Jan 4", { title: "Party", day: "2027-01-04", label: "Mon 4 Jan 2027" });
check("Party May 5", { title: "Party", day: "2027-05-05", label: "Wed 5 May 2027" });
check("Party 5th of May", { day: "2027-05-05" });
check("Party Jan 4", { day: "2027-01-04", label: "Mon 4 Jan 2027" }, DEC);
check("Dentist 2026-10-12", { title: "Dentist", day: "2026-10-12" });
check("Dentist Feb 30", { title: "Dentist Feb 30", ...NOTHING });
check("Fri 9 Oct dentist", { title: "Dentist", day: "2026-10-09" });
check("Dentist Friday the 16th", { title: "Dentist", day: "2026-10-16" });
check("Dentist Friday, October 16", { title: "Dentist", day: "2026-10-16" });

// Numeric slash dates are ambiguous: skipped entirely.
check("Dentist 12/10", { title: "Dentist 12/10", ...NOTHING });
check("Dentist 12/10 at 3pm", { title: "Dentist 12/10", day: "2026-10-04", time: 900 });

// --- "the 25th" and month names after in/by ---------------------------------------
check("Pay rent on the 3rd", { title: "Pay rent", day: "2026-11-03", label: "Tue 3 Nov" }); // passed: next month
check("Pay rent the 25th", { title: "Pay rent the 25th", ...NOTHING }); // no cue word
check("Book flights by March", { title: "Book flights", day: "2027-03-01", label: "Mon 1 Mar 2027" });
check("Plant bulbs in June", { title: "Plant bulbs", day: "2027-06-01" });
check("Book party in December", { day: "2026-12-01", label: "Tue 1 Dec" });
check("Finish by May", { title: "Finish by May", ...NOTHING }); // "may" needs a day number

// --- Must not be read as dates -------------------------------------------------------
check("Do it now", { title: "Do it now", ...NOTHING });
check("Buy a sun hat", { title: "Buy a sun hat", ...NOTHING });
check("Fix the sat nav", { title: "Fix the sat nav", ...NOTHING });
check("Join the march", { title: "Join the march", ...NOTHING });
check("I may go", { title: "I may go", ...NOTHING });
check("Email April", { title: "Email April", ...NOTHING });
check("March on", { title: "March on", ...NOTHING });
check("Mayday drill", { title: "Mayday drill", ...NOTHING });
check("Afternoon tea", { title: "Afternoon tea", ...NOTHING });
check("Say c'mon", { title: "Say c'mon", ...NOTHING });

// --- Times ----------------------------------------------------------------------------
check("Call at 3pm", { title: "Call", day: "2026-10-04", time: 900, fromText: true, label: "Today, 3:00 pm" });
check("Call 3 pm", { title: "Call", time: 900 });
check("Call 3:30pm", { time: 930 });
check("Call 3:30 p.m.", { title: "Call", time: 930 });
check("Call at 3.30pm", { time: 930 });
check("Call 11am", { time: 660, day: "2026-10-04" });
check("Lunch at noon", { title: "Lunch", time: 720, label: "Today, 12:00 pm" });
check("Check oven midnight", { title: "Check oven", time: 0, day: "2026-10-05", label: "Tomorrow, 12:00 am" });
check("Call at 9:30", { time: 570, day: "2026-10-05", label: "Tomorrow, 9:30 am" }); // 9:30 has passed
check("Call at 15:45", { time: 945, day: "2026-10-04", label: "Today, 3:45 pm" });
check("Call at 12am", { time: 0 });
check("Call at 12pm", { time: 720 });
check("Call at 9am", { time: 540, day: "2026-10-05", label: "Tomorrow, 9:00 am" });
check("Call at 5", { title: "Call at 5", ...NOTHING });
check("Gym 7:30", { title: "Gym 7:30", ...NOTHING });
check("Gym tomorrow 7:30", { title: "Gym", day: "2026-10-05", time: 450 });
check("Gym 7:30 tomorrow", { title: "Gym", day: "2026-10-05", time: 450 });
check("Gym 9:30 on friday", { title: "Gym", day: "2026-10-09", time: 570 });
check("Standup today at 9:30", { title: "Standup", day: "2026-10-04", time: 570, label: "Today, 9:30 am" });
check("Drinks tonight at 9:30", { title: "Drinks", day: "2026-10-04", time: 1290, label: "Today, 9:30 pm" });
check("Pay £9.30 tomorrow", { title: "Pay £9.30", day: "2026-10-05", time: null });
check("Dentist Oct 12 at 9:30", { title: "Dentist", label: "Mon 12 Oct, 9:30 am" });
check("Call at 13pm", { title: "Call at 13pm", ...NOTHING });

// Time but no day: the default day, else today if still ahead, else tomorrow.
check("Call at 3pm", { day: "2026-10-12", time: 900, fromText: true, label: "Mon 12 Oct, 3:00 pm" }, SUN, "2026-10-12");
check("Call at 9pm", { day: "2026-10-05", label: "Tomorrow, 9:00 pm" }, LATE);
check("Call at 11pm", { day: "2026-10-04", label: "Today, 11:00 pm" }, LATE);
check("Check oven midnight", { day: "2026-10-05", label: "Tomorrow, 12:00 am" }, LATE);
check("Call at 9pm", { day: "2026-10-09", label: "Friday, 9:00 pm" }, LATE, "2026-10-09");

// --- First phrase wins ------------------------------------------------------------------
check("Dentist friday or saturday", { title: "Dentist or saturday", day: "2026-10-09" });
check("Call at 3pm or 4pm", { title: "Call or 4pm", time: 900 });

// --- Default day --------------------------------------------------------------------------
check("Buy milk", { title: "Buy milk", day: "2026-10-05", time: null, fromText: false, label: "Tomorrow" }, SUN, "2026-10-05");
check("Buy milk", { title: "Buy milk", ...NOTHING });
check("Buy milk friday", { day: "2026-10-09", fromText: true }, SUN, "2026-10-12");

// --- Title cleanup ------------------------------------------------------------------------
check("Call Mum, tomorrow", { title: "Call Mum" });
check("Essay due by friday", { title: "Essay" });
check("Essay due friday", { title: "Essay" });
check("Tomorrow - call Mum", { title: "Call Mum" });
check("Call Mum tomorrow, then Dad", { title: "Call Mum, then Dad" });
check("On friday call mum", { title: "Call mum" });
check("buy milk tomorrow", { title: "buy milk" }); // lower-case start kept when the start wasn't cut
check("Call Mum tomorrow at", { title: "Call Mum" });
check("Clean car over the weekend", { title: "Clean car" });
check("Log in tomorrow", { title: "Log in" });
check("Prep slides for the 3pm meeting", { title: "Prep slides for the meeting", time: 900 });
check("Call Mum (tomorrow) about Xmas", { title: "Call Mum about Xmas" });
check("Call   Mum   tomorrow", { title: "Call Mum" });
check("Dentist @ 3pm", { title: "Dentist", time: 900 });
check("Report due 5pm friday", { title: "Report", day: "2026-10-09", time: 1020, label: "Friday, 5:00 pm" });
check("Book the 9am slot", { title: "Book the slot", time: 540, day: "2026-10-05" });
check("Vet Tuesday 14:30", { title: "Vet", day: "2026-10-06", time: 870, label: "Tuesday, 2:30 pm" });

// --- Edge cases: "sat"/"sun" before a date, ordinals that aren't dates --------------------
check("Sat 10 Oct BBQ", { title: "BBQ", day: "2026-10-10" }); // the label's own format reads back
check("Sun 11 Oct roast", { title: "Roast", day: "2026-10-11" });
check("On the 25th pay rent", { title: "Pay rent", day: "2026-10-25" });
check("Pay rent by 25th", { title: "Pay rent", day: "2026-10-25" });
check("Drop parcel on the 2nd floor", { title: "Drop parcel on the 2nd floor", ...NOTHING });
check("Try for the 1st time", { title: "Try for the 1st time", ...NOTHING });

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
