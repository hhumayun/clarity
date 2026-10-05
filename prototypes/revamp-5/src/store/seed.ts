import { addDays, dateOf, today, weekend, type Day } from "../lib/dates";
import type { Area, FocusHistory, Note, Suggestion, Task } from "./model";

/**
 * Sample content, laid out around today so the prototype always looks
 * lived-in: tasks for today, a few that slipped, the week ahead, and some
 * already done.
 */
export function seed(now = new Date()) {
  const t = today();
  const at = (day: Day, minutes: number) => {
    const date = dateOf(day);
    date.setMinutes(minutes);
    return date.getTime();
  };
  const endOfMonth = (() => {
    const date = dateOf(t);
    return addDays(t, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate() - date.getDate());
  })();
  const past = now.getTime() - 86_400_000 * 9;

  const areas: Area[] = [
    { name: "Health", hue: 1 },
    { name: "Home", hue: 2 },
    { name: "Mind", hue: 3 },
    { name: "People", hue: 4 },
    { name: "Work", hue: 0 },
  ];

  const notes: Note[] = [
    {
      id: "slow-morning",
      title: "Slow morning",
      excerpt: "Coffee on the step before anyone else was up. I want more mornings like this, with the phone in another room.",
      area: "Mind",
      day: t,
      time: "7:40",
      words: 142,
      blocks: [
        { kind: "p", text: "Coffee on the step before anyone else was up. I want more mornings like this, with the phone in another room and nothing to answer yet." },
        { kind: "p", text: "Three things that would make today feel well spent:" },
        { kind: "check", text: "Finish the editor spec", done: true },
        { kind: "check", text: "Walk at lunch, no podcast" },
        { kind: "check", text: "Call Mum back before seven" },
        { kind: "quote", text: "The days are long, but the years are short." },
        { kind: "p", text: "Noticing how much calmer the week feels when the first hour is mine. I should protect it on busy days too." },
      ],
    },
    {
      id: "kitchen-shelves",
      title: "Kitchen shelves",
      excerpt: "Measure the alcove again: 84 cm, not 80. Ask Sam about the brackets; the oak offcuts might be enough.",
      area: "Home",
      day: t,
      time: "12:15",
      words: 64,
      blocks: [
        { kind: "p", text: "Measure the alcove again: 84 cm, not 80. Ask Sam about the brackets tomorrow; the oak offcuts might be enough for two shelves." },
        { kind: "p", text: "Need to check the offcuts at the weekend before buying anything new." },
      ],
    },
    {
      id: "parked-vat",
      title: "Does the quote include VAT?",
      excerpt: "Check before sending the brief. If not, the budget line moves by a fifth.",
      area: "Work",
      day: t,
      time: "10:20",
      words: 18,
      source: "focus",
    },
    {
      id: "q4-plan",
      title: "What matters this quarter",
      excerpt: "Ship the editor, quieten onboarding, and stop saying yes to work that only looks urgent.",
      area: "Work",
      day: addDays(t, -1),
      time: "16:05",
      words: 388,
      blocks: [
        { kind: "p", text: "Ship the editor by the end of the month, quieten onboarding next week, and stop saying yes to work that only looks urgent." },
        { kind: "p", text: "Send the brief to Ana today, short and with the budget up front." },
      ],
    },
    {
      id: "canal-run",
      title: "Run along the canal",
      excerpt: "Felt easy for the first time in weeks. 5.2 km in 31 minutes, and I could have kept going.",
      area: "Health",
      day: addDays(t, -1),
      time: "8:20",
      words: 96,
      blocks: [
        { kind: "p", text: "Felt easy for the first time in weeks. 5.2 km in 31 minutes, and I could have kept going." },
        { kind: "p", text: "Try 6 km on Saturday, and book a physio session about the knee." },
      ],
    },
    {
      id: "call-mum",
      title: "Call with Mum",
      excerpt: "She's thinking about the move again. Listen first; don't fix. Send her the photos from June.",
      area: "People",
      day: addDays(t, -2),
      time: "19:30",
      words: 120,
      blocks: [
        { kind: "p", text: "She's thinking about the move again. Listen first; don't fix." },
        { kind: "p", text: "Send her the photos from June, and ask about the move dates next week." },
      ],
    },
    {
      id: "book-idea",
      title: "A story told in to-do lists",
      excerpt: "Each list a little more honest than the last, until the final one has a single item on it.",
      area: "Mind",
      day: addDays(t, -2),
      time: "22:10",
      words: 210,
    },
    {
      id: "garden",
      title: "The garden in October",
      excerpt: "Bulbs in before the frost: thirty tulips and a bag of alliums. Wrap the fig by the end of the month.",
      area: "Home",
      day: addDays(t, -4),
      time: "10:00",
      words: 78,
      blocks: [
        { kind: "p", text: "Bulbs in before the frost: thirty tulips and a bag of alliums. Buy the bulbs tomorrow." },
        { kind: "p", text: "Wrap the fig by the end of the month." },
      ],
    },
  ];

  let n = 0;
  const task = (fields: Partial<Task> & Pick<Task, "title" | "area">): Task => ({
    id: `t${++n}`,
    details: "",
    done: false,
    doneAt: null,
    day: null,
    time: null,
    remind: null,
    repeat: null,
    noteIds: fields.foundIn ? [fields.foundIn] : [],
    foundIn: null,
    createdAt: past + n * 3_600_000,
    movedFrom: null,
    ...fields,
  });

  const tasks: Task[] = [
    // Today
    task({ title: "Send the brief to Ana", area: "Work", day: t, time: 15 * 60, remind: 15, foundIn: "q4-plan", noteIds: ["q4-plan", "parked-vat"], details: "Short, with the budget up front." }),
    task({ title: "Walk at lunch, no podcast", area: "Health", day: t, time: 12 * 60 + 30, remind: 0, repeat: "weekdays", foundIn: "slow-morning" }),
    task({ title: "Call Mum back", area: "People", day: t, time: 18 * 60 + 30, foundIn: "slow-morning", noteIds: ["slow-morning", "call-mum"] }),
    task({ title: "Book the dentist", area: "Health", day: t }),
    // Slipped
    task({ title: "Renew the passport", area: "Home", day: addDays(t, -2), details: "The photo booth at the station takes cards now." }),
    task({ title: "Return the library books", area: "Mind", day: addDays(t, -3) }),
    task({ title: "Pay the window cleaner", area: "Home", day: addDays(t, -1) }),
    task({ title: "Expenses for September", area: "Work", day: addDays(t, -6) }),
    // This week
    task({ title: "Ask Sam about the brackets", area: "Home", day: addDays(t, 1), foundIn: "kitchen-shelves" }),
    task({ title: "Draft the onboarding copy", area: "Work", day: addDays(t, 2), time: 10 * 60, remind: 30 }),
    task({ title: "Buy the tulip bulbs", area: "Home", day: addDays(t, 3), foundIn: "garden" }),
    task({ title: "Book a physio session", area: "Health", day: addDays(t, 5), foundIn: "canal-run" }),
    // Later
    task({ title: "Send Mum the photos from June", area: "People", day: addDays(t, 9), foundIn: "call-mum" }),
    task({ title: "Wrap the fig", area: "Home", day: endOfMonth > addDays(t, 7) ? endOfMonth : addDays(t, 12), foundIn: "garden" }),
    // No date
    task({ title: "Outline chapter one", area: "Mind", foundIn: "book-idea" }),
    task({ title: "Look into a standing desk", area: "Work" }),
    // Done
    task({ title: "Finish the editor spec", area: "Work", day: t, done: true, doneAt: at(t, 9 * 60 + 40), foundIn: "slow-morning" }),
    task({ title: "Reply to the landlord", area: "Home", day: t, done: true, doneAt: at(t, 9 * 60 + 10) }),
    task({ title: "Morning run", area: "Health", day: t, done: true, doneAt: at(t, 7 * 60 + 5) }),
    task({ title: "Order the oak offcuts", area: "Home", day: addDays(t, -1), done: true, doneAt: at(addDays(t, -1), 17 * 60), foundIn: "kitchen-shelves" }),
  ];

  const byTitle = (title: string) => tasks.find((item) => item.title === title)!.id;
  const focus: Record<string, FocusHistory> = {
    [byTitle("Send the brief to Ana")]: {
      sessions: 1,
      minutes: 15,
      lastAt: at(addDays(t, -1), 16 * 60 + 30),
      leftOff: "Outline done. Next: the budget section.",
      outcome: "progress",
    },
    [byTitle("Finish the editor spec")]: { sessions: 2, minutes: 40, lastAt: at(t, 9 * 60 + 35), leftOff: null, outcome: "finished" },
    [byTitle("Renew the passport")]: {
      sessions: 1,
      minutes: 10,
      lastAt: at(addDays(t, -3), 11 * 60),
      leftOff: "Not sure which form is the right one.",
      outcome: "stuck",
    },
  };

  /** What "Find tasks" turns up in the sample notes. */
  const found: Record<string, Omit<Suggestion, "key" | "picked">[]> = {
    "slow-morning": [
      { title: "Protect the first hour on busy days", area: "Mind", day: null, time: null },
      { title: "Leave the phone in another room tonight", area: "Mind", day: t, time: 21 * 60 },
    ],
    "kitchen-shelves": [
      { title: "Measure the alcove again", area: "Home", day: t, time: null },
      { title: "Check the oak offcuts", area: "Home", day: weekend(t), time: null },
    ],
    "q4-plan": [
      { title: "Ship the editor", area: "Work", day: endOfMonth, time: null },
      { title: "Quieten onboarding", area: "Work", day: addDays(t, 7), time: null },
      { title: "Say no to one urgent-looking request", area: "Work", day: null, time: null },
    ],
    "canal-run": [{ title: "Run 6 km", area: "Health", day: weekend(t), time: null }],
    "call-mum": [{ title: "Ask Mum about the move dates", area: "People", day: addDays(t, 7), time: null }],
    "book-idea": [{ title: "Write the first list", area: "Mind", day: null, time: null }],
    garden: [{ title: "Plant the alliums", area: "Home", day: weekend(t), time: null }],
  };

  return { areas, notes, tasks, focus, found, focusToday: 25 };
}
