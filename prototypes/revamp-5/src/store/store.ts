import { create } from "zustand";
import { addDays, dateOf, dayOf, today, type Day } from "../lib/dates";
import { parseTask } from "../lib/parseTask";
import { emptyHistory, type Area, type Block, type FocusHistory, type Note, type Outcome, type Repeat, type Suggestion, type Task } from "./model";
import { seed } from "./seed";

export type FindResult = "found" | "none" | "nothing-new" | "failed";
type NewTask = { title: string; area: string; day: Day | null; time: number | null; noteId?: string | null };

type State = {
  areas: Area[];
  tasks: Task[];
  notes: Note[];
  focus: Record<string, FocusHistory>;
  /** Minutes of focus since midnight. */
  focusToday: number;
  /** "Find tasks" results waiting for a yes or no, kept with their note. */
  suggestions: Record<string, Suggestion[]>;
  /** Notes already searched, so a second look can say "nothing new". */
  searched: Record<string, boolean>;
  /** The day Today is showing. */
  viewDay: Day;
  /** A task just added, so its row can glow where it lands. */
  lastAdded: string | null;
  /** Titles of deleted tasks: "Find tasks" never offers them again. */
  deleted: string[];
  /** Notes written from Today's question, by day: the card shows that day as written. */
  pages: Record<Day, string>;
  /** The area picked for a note that isn't saved yet. */
  draftArea: string | null;

  setViewDay: (day: Day) => void;
  setDraftArea: (area: string | null) => void;
  addTask: (task: NewTask) => string;
  updateTask: (id: string, patch: Partial<Omit<Task, "id">>) => void;
  /** Ticks a task off, or on again. A repeating task moves to its next day instead; that day is returned. */
  setDone: (id: string, done: boolean) => Day | null;
  /** Moves a task to a day; Catch up also records the first day it was planned for. */
  moveTask: (id: string, day: Day | null, options?: { record?: boolean }) => void;
  deleteTask: (id: string) => void;
  clearCompleted: (area?: string | null) => number;
  linkNote: (taskId: string, noteId: string) => void;
  unlinkNote: (taskId: string, noteId: string) => void;

  addArea: (name: string) => string | null;
  renameArea: (from: string, to: string) => boolean;
  deleteArea: (name: string, moveTo: string | null) => void;

  recordFocus: (taskId: string, minutes: number, outcome: Outcome, leftOff: string) => void;
  parkThought: (taskId: string, text: string) => string;
  /**
   * A new note from its text, or from questions and the answers written to
   * them (each question becomes a quote above its answer). `page` marks it
   * as today's page.
   */
  addNote: (note: { title: string; body?: string; segments?: { question: string | null; answer: string }[]; area: string | null; page?: boolean }) => string;
  setNoteArea: (noteId: string, area: string | null) => void;
  /**
   * A note written or edited on its page: its words as Markdown, with what the
   * lists show worked out by the page (src/data/adapt.ts, noteFacts). A new id
   * makes the note; today's page (`page`) becomes the day's page.
   */
  writeNote: (note: { id: string; title: string; typedTitle: string; markdown: string; excerpt: string; blocks: Block[]; words: number; area: string | null; page?: boolean }) => void;
  /** Archived notes leave the lists. */
  archiveNote: (noteId: string) => void;
  deleteNote: (noteId: string) => void;

  /** Looks for tasks in a note's words: at once in the samples, through the AI for an account (which can fail). */
  findTasks: (noteId: string) => FindResult | Promise<FindResult>;
  toggleSuggestion: (noteId: string, key: string) => void;
  dismissSuggestions: (noteId: string) => void;
  addSuggestions: (noteId: string) => number;
  /** Adds one found task from its card; the card stays, ticked. */
  addSuggestion: (noteId: string, key: string) => void;
  /** "Not now" on one found task. */
  skipSuggestion: (noteId: string, key: string) => void;

  /** Back to the sample data, as when the app opened. */
  reset: () => void;
};

const initial = seed();
const sameName = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
let ids = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++ids}`;
const clock = (date = new Date()) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;

/** The next day a repeating task falls on, always after today. */
export function nextRepeat(day: Day, repeat: Repeat): Day {
  const t = today();
  let next = day;
  const step = (from: Day): Day => {
    if (repeat === "daily") return addDays(from, 1);
    if (repeat === "weekly") return addDays(from, 7);
    if (repeat === "weekdays") {
      let d = addDays(from, 1);
      while ([0, 6].includes(dateOf(d).getDay())) d = addDays(d, 1);
      return d;
    }
    const date = dateOf(from);
    const target = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), last));
    return dayOf(target);
  };
  do next = step(next);
  while (next <= t);
  return next;
}

/** Sentences that read like something to do, for notes the sample data doesn't cover. */
function extract(note: Note, areas: Area[]): Omit<Suggestion, "key" | "picked">[] {
  const text = (note.blocks ?? [{ kind: "p" as const, text: note.excerpt }])
    .filter((block) => block.kind !== "check" || !block.done)
    .map((block) => block.text)
    .join(" ");
  const verbs =
    "call|email|text|send|buy|book|pay|ask|write|finish|fix|plan|check|clean|renew|return|order|schedule|reply|measure|plant|wrap|draft|review|prepare|post|pick|collect|cancel|sort|tidy|print|ring|message|visit|fill|submit|update|try";
  const cue = new RegExp(`\\b(?:need to|have to|must|should|remember to|don't forget to|going to)\\s+(.+)`, "i");
  const starts = new RegExp(`^(?:${verbs})\\b`, "i");
  const area = note.area ?? areas[0]?.name ?? "General";
  const out: Omit<Suggestion, "key" | "picked">[] = [];
  for (const raw of text.split(/(?<=[.!?;])\s+|\n+/)) {
    const sentence = raw.trim().replace(/[.!?;]+$/, "");
    if (!sentence) continue;
    const match = sentence.match(cue);
    const phrase = match ? match[1] : starts.test(sentence) ? sentence : null;
    if (!phrase || phrase.split(/\s+/).length > 14) continue;
    const parsed = parseTask(phrase, new Date(), null);
    const title = parsed.title.charAt(0).toUpperCase() + parsed.title.slice(1);
    if (title.length < 3) continue;
    out.push({ title, area, day: parsed.day, time: parsed.time });
  }
  return out.slice(0, 6);
}

export const useStore = create<State>()((set, get) => ({
  areas: initial.areas,
  tasks: initial.tasks,
  notes: initial.notes,
  focus: initial.focus,
  focusToday: initial.focusToday,
  suggestions: {},
  searched: {},
  viewDay: today(),
  lastAdded: null,
  deleted: [],
  pages: {},
  draftArea: null,

  setViewDay: (day) => set({ viewDay: day }),
  setDraftArea: (area) => set({ draftArea: area }),

  addTask: ({ title, area, day, time, noteId }) => {
    const id = newId("task");
    const task: Task = {
      id,
      title: title.trim().slice(0, 500),
      details: "",
      done: false,
      doneAt: null,
      area,
      day,
      time: day ? time : null,
      remind: null,
      repeat: null,
      noteIds: noteId ? [noteId] : [],
      foundIn: noteId ?? null,
      createdAt: Date.now(),
      movedFrom: null,
    };
    set((state) => ({ tasks: [...state.tasks, task], lastAdded: id }));
    setTimeout(() => get().lastAdded === id && set({ lastAdded: null }), 2_500);
    return id;
  },

  updateTask: (id, patch) => set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) })),

  setDone: (id, done) => {
    const task = get().tasks.find((item) => item.id === id);
    if (!task) return null;
    if (done && task.repeat && task.day) {
      const next = nextRepeat(task.day, task.repeat);
      // A reminder for this time only doesn't come back with it.
      get().updateTask(id, task.remindOnce ? { day: next, remind: null, remindOnce: false } : { day: next });
      return next;
    }
    get().updateTask(id, { done, doneAt: done ? Date.now() : null });
    return null;
  },

  moveTask: (id, day, options) => {
    const task = get().tasks.find((item) => item.id === id);
    if (!task) return;
    get().updateTask(id, {
      day,
      time: day ? task.time : null,
      remind: day ? task.remind : null,
      repeat: day ? task.repeat : null,
      movedFrom: options?.record && task.day && !task.movedFrom ? task.day : task.movedFrom,
    });
  },

  deleteTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
      deleted: [...state.deleted, ...state.tasks.filter((task) => task.id === id).map((task) => task.title.toLowerCase())],
    })),

  clearCompleted: (area) => {
    const gone = get().tasks.filter((task) => task.done && (!area || task.area === area));
    set((state) => ({ tasks: state.tasks.filter((task) => !gone.includes(task)) }));
    return gone.length;
  },

  linkNote: (taskId, noteId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (!task || task.noteIds.includes(noteId)) return;
    get().updateTask(taskId, { noteIds: [...task.noteIds, noteId] });
  },

  unlinkNote: (taskId, noteId) => {
    const task = get().tasks.find((item) => item.id === taskId);
    if (!task) return;
    get().updateTask(taskId, { noteIds: task.noteIds.filter((id) => id !== noteId), foundIn: task.foundIn === noteId ? null : task.foundIn });
  },

  addArea: (name) => {
    const clean = name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!clean) return null;
    const existing = get().areas.find((area) => sameName(area.name, clean));
    if (existing) return existing.name;
    const used = new Set(get().areas.map((area) => area.hue));
    const hue = [5, 6, 7, 0, 1, 2, 3, 4].find((h) => !used.has(h)) ?? get().areas.length % 8;
    set((state) => ({ areas: [...state.areas, { name: clean, hue }].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })) }));
    return clean;
  },

  renameArea: (from, to) => {
    const clean = to.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!clean || get().areas.some((area) => area.name !== from && sameName(area.name, clean))) return false;
    set((state) => ({
      areas: state.areas.map((area) => (area.name === from ? { ...area, name: clean } : area)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
      tasks: state.tasks.map((task) => (task.area === from ? { ...task, area: clean } : task)),
      notes: state.notes.map((note) => (note.area === from ? { ...note, area: clean } : note)),
    }));
    return true;
  },

  deleteArea: (name, moveTo) =>
    set((state) => ({
      areas: state.areas.filter((area) => area.name !== name),
      tasks: moveTo ? state.tasks.map((task) => (task.area === name ? { ...task, area: moveTo } : task)) : state.tasks.filter((task) => task.area !== name),
      notes: state.notes.map((note) => (note.area === name ? { ...note, area: null } : note)),
    })),

  recordFocus: (taskId, minutes, outcome, leftOff) => {
    const before = get().focus[taskId] ?? emptyHistory();
    set((state) => ({
      focusToday: state.focusToday + minutes,
      focus: {
        ...state.focus,
        [taskId]: {
          sessions: before.sessions + 1,
          minutes: before.minutes + minutes,
          lastAt: Date.now(),
          leftOff: leftOff.trim() || (outcome === "finished" ? null : before.leftOff),
          outcome,
        },
      },
    }));
    if (outcome === "finished") get().setDone(taskId, true);
  },

  parkThought: (taskId, text) => {
    const task = get().tasks.find((item) => item.id === taskId);
    const clean = text.trim();
    const firstLine = clean.split("\n")[0];
    const id = newId("note");
    const note: Note = {
      id,
      title: firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine,
      excerpt: clean,
      area: task?.area ?? null,
      day: today(),
      time: clock(),
      words: clean.split(/\s+/).length,
      source: "focus",
    };
    set((state) => ({ notes: [note, ...state.notes] }));
    if (task) get().linkNote(taskId, id);
    return id;
  },

  addNote: ({ title, body, segments, area, page }) => {
    const id = newId("note");
    const parts = segments ?? [{ question: null, answer: body ?? "" }];
    const text = parts.map((part) => part.answer.trim()).filter(Boolean).join("\n");
    const blocks: NonNullable<Note["blocks"]> = [];
    for (const part of parts) {
      if (!part.answer.trim()) continue;
      if (part.question) blocks.push({ kind: "quote", text: part.question });
      for (const line of part.answer.trim().split(/\n+/)) blocks.push({ kind: "p", text: line });
    }
    const first = parts.find((part) => part.answer.trim())?.question;
    const note: Note = {
      id,
      title: title.trim() || first || text.split("\n")[0].slice(0, 60) || "Untitled",
      excerpt: text.replace(/\s+/g, " ").slice(0, 160),
      blocks,
      area,
      day: today(),
      time: clock(),
      words: text ? text.split(/\s+/).length : 0,
    };
    set((state) => ({ notes: [note, ...state.notes], pages: page ? { ...state.pages, [today()]: id } : state.pages }));
    return id;
  },

  setNoteArea: (noteId, area) => set((state) => ({ notes: state.notes.map((note) => (note.id === noteId ? { ...note, area } : note)) })),

  writeNote: ({ id, title, typedTitle, markdown, excerpt, blocks, words, area, page }) =>
    set((state) => {
      const facts = { title, typedTitle, markdown, excerpt, blocks, words };
      if (state.notes.some((note) => note.id === id)) {
        return { notes: state.notes.map((note) => (note.id === id ? { ...note, ...facts } : note)) };
      }
      const note: Note = { id, ...facts, area, day: today(), time: clock() };
      return { notes: [note, ...state.notes], pages: page ? { ...state.pages, [today()]: id } : state.pages };
    }),

  archiveNote: (noteId) => get().deleteNote(noteId),

  deleteNote: (noteId) =>
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== noteId),
      pages: Object.fromEntries(Object.entries(state.pages).filter(([, id]) => id !== noteId)),
      tasks: state.tasks.map((task) => (task.noteIds.includes(noteId) ? { ...task, noteIds: task.noteIds.filter((id) => id !== noteId) } : task)),
    })),

  findTasks: (noteId) => {
    const state = get();
    const note = state.notes.find((item) => item.id === noteId);
    if (!note) return "none";
    if (state.searched[noteId] && !(state.suggestions[noteId]?.length)) return "nothing-new";
    const known = new Set([...state.tasks.map((task) => task.title.toLowerCase()), ...state.deleted]);
    const source = initial.found[noteId] ?? extract(note, state.areas);
    const fresh = source.filter((item) => !known.has(item.title.toLowerCase()));
    set((s) => ({
      searched: { ...s.searched, [noteId]: true },
      suggestions: { ...s.suggestions, [noteId]: fresh.map((item, i) => ({ ...item, key: `${noteId}-${i}`, picked: true })) },
    }));
    return fresh.length ? "found" : "none";
  },

  toggleSuggestion: (noteId, key) =>
    set((state) => ({
      suggestions: {
        ...state.suggestions,
        [noteId]: (state.suggestions[noteId] ?? []).map((item) => (item.key === key ? { ...item, picked: !item.picked } : item)),
      },
    })),

  dismissSuggestions: (noteId) => set((state) => ({ suggestions: { ...state.suggestions, [noteId]: [] } })),

  addSuggestions: (noteId) => {
    const picked = (get().suggestions[noteId] ?? []).filter((item) => item.picked);
    for (const item of picked) {
      if (!get().areas.some((area) => area.name === item.area)) get().addArea(item.area);
      get().addTask({ title: item.title, area: item.area, day: item.day, time: item.time, noteId });
    }
    set((state) => ({ suggestions: { ...state.suggestions, [noteId]: [] } }));
    return picked.length;
  },

  addSuggestion: (noteId, key) => {
    const item = (get().suggestions[noteId] ?? []).find((suggestion) => suggestion.key === key);
    if (!item || item.added) return;
    if (!get().areas.some((area) => area.name === item.area)) get().addArea(item.area);
    get().addTask({ title: item.title, area: item.area, day: item.day, time: item.time, noteId });
    set((state) => ({
      suggestions: { ...state.suggestions, [noteId]: (state.suggestions[noteId] ?? []).map((suggestion) => (suggestion.key === key ? { ...suggestion, added: true } : suggestion)) },
    }));
  },

  skipSuggestion: (noteId, key) =>
    set((state) => ({ suggestions: { ...state.suggestions, [noteId]: (state.suggestions[noteId] ?? []).filter((suggestion) => suggestion.key !== key) } })),


  reset: () => {
    const fresh = seed();
    set({
      areas: fresh.areas,
      tasks: fresh.tasks,
      notes: fresh.notes,
      focus: fresh.focus,
      focusToday: fresh.focusToday,
      suggestions: {},
      searched: {},
      viewDay: today(),
      lastAdded: null,
      deleted: [],
      pages: {},
    });
  },
}));
