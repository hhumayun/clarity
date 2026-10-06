import type { NoteRecord, ProjectRecord, TaskFocusSummary, TaskRecord } from "../core/types";

type FocusSummary = { todaySeconds: number; tasks: TaskFocusSummary[] };
import { displayTitle, plainText } from "../core/lib/notesList";
import { linkedNoteIds } from "../core/lib/taskLinks";
import { dateOf, dayOf, type Day } from "../lib/dates";
import type { Area, Block, FocusHistory, Note, Task } from "../store/model";

/**
 * Between the server's records and the shape Sage's screens read. Pure
 * functions, both ways: records to the view model for showing, and Sage's
 * values (a day, minutes) to what the server takes for saving.
 */

/** A task as it may come back from the phone's copy, where a date can still be a string. */
type LiveTask = Omit<TaskRecord, "completedAt" | "movedFrom"> & { completedAt?: Date | string | null; movedFrom?: Date | string | null };

const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

export function toArea(project: ProjectRecord): Area {
  // Areas carry no colour in this design; the hue is the model's, unused.
  return { name: project.name, hue: 0 };
}

export const byName = (a: Area, b: Area) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** "HH:MM" to minutes after midnight. */
export function minutesOf(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes after midnight to "HH:MM", as the server keeps a task's time. */
export function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** A day as the server keeps a task's day: that date at local noon, so it never slips across midnight. */
export function noonOf(day: Day): Date {
  const date = dateOf(day);
  date.setHours(12, 0, 0, 0);
  return date;
}

export function toTask(record: LiveTask): Task {
  const done = record.status === "done";
  // Done before migration 014 had no done time: the last change is the best guess.
  const doneAt = done ? asDate(record.completedAt ?? record.updatedAt).getTime() : null;
  return {
    id: record.id,
    title: record.text,
    details: record.description ?? "",
    done,
    doneAt,
    area: record.projectName,
    day: record.completeBy ? dayOf(asDate(record.completeBy)) : null,
    time: record.completeBy && record.dueTime ? minutesOf(record.dueTime) : null,
    remind: record.remindBefore ?? null,
    repeat: record.remindRepeat ?? null,
    remindOnce: record.remindOnce ?? false,
    noteIds: linkedNoteIds(record),
    foundIn: record.noteId,
    createdAt: asDate(record.createdAt).getTime(),
    movedFrom: record.movedFrom ? dayOf(asDate(record.movedFrom)) : null,
  };
}

/** Markdown's inline marks taken off, for a line shown as plain words. */
function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])([*_])(\S(?:.*?\S)?)\2(?=[\s).,;:!?]|$)/g, "$1$3")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, "$1")
    .trim();
}

/**
 * A note's Markdown as the blocks Sage's note page draws until the editor
 * arrives: questions (quotes), checklist rows, and paragraphs. Headings and
 * list items read as paragraphs; nothing is dropped.
 */
export function blocksOf(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  // Lines of one quote run together; a blank line or anything else ends it.
  let quoteOpen = false;
  const flush = () => {
    const text = inline(paragraph.join(" "));
    if (text) blocks.push({ kind: "p", text });
    paragraph = [];
  };
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith(">")) quoteOpen = false;
    if (!line) {
      flush();
      continue;
    }
    const check = /^[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
    if (check) {
      flush();
      blocks.push({ kind: "check", text: inline(check[2]), done: check[1].toLowerCase() === "x" });
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      const text = inline(line.replace(/^>+\s?/, ""));
      const last = blocks[blocks.length - 1];
      if (text && quoteOpen && last?.kind === "quote") last.text = `${last.text} ${text}`;
      else if (text) blocks.push({ kind: "quote", text });
      quoteOpen = !!text || quoteOpen;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const text = inline(heading[1]);
      if (text) blocks.push({ kind: "p", text });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      const text = inline(bullet[1]);
      if (text) blocks.push({ kind: "p", text: `• ${text}` });
      continue;
    }
    const numbered = /^(\d+[.)])\s+(.*)$/.exec(line);
    if (numbered) {
      flush();
      const text = inline(numbered[2]);
      if (text) blocks.push({ kind: "p", text: `${numbered[1]} ${text}` });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

export function toNote(record: NoteRecord, areaName: (projectId: string) => string | undefined): Note {
  const created = asDate(record.createdAt);
  const { title, preview } = displayTitle(record);
  const words = plainText(record.content).split(/\s+/).filter(Boolean).length;
  return {
    id: record.id,
    title,
    excerpt: preview,
    blocks: blocksOf(record.content),
    // Cards show a note's first area; a note can have several.
    area: record.projectIds.map(areaName).find((name): name is string => !!name) ?? null,
    day: dayOf(created),
    time: `${created.getHours()}:${String(created.getMinutes()).padStart(2, "0")}`,
    words,
    ...((record.source as string | null) === "focus" ? { source: "focus" as const } : {}),
  };
}

/**
 * A sample note's words as Markdown, for the editor: questions as quotes,
 * checklist rows (which run together as one list) and paragraphs.
 */
export function markdownOfBlocks(blocks: Block[]): string {
  return blocks
    .map((block, i) => {
      const line = block.kind === "check" ? `- [${block.done ? "x" : " "}] ${block.text}` : block.kind === "quote" ? `> ${block.text}` : block.text;
      if (i === 0) return line;
      return blocks[i - 1].kind === "check" && block.kind === "check" ? `\n${line}` : `\n\n${line}`;
    })
    .join("");
}

/** What the lists show for a note written on its page: its title, preview, blocks and word count. */
export function noteFacts(title: string, markdown: string): { title: string; excerpt: string; blocks: Block[]; words: number } {
  const shown = displayTitle({ title, content: markdown });
  return { title: shown.title, excerpt: shown.preview, blocks: blocksOf(markdown), words: plainText(markdown).split(/\s+/).filter(Boolean).length };
}

/**
 * Whether a page has been written on: a title, or words beyond the questions
 * it was given (a question alone isn't a note).
 */
export function hasWriting(title: string, markdown: string, asked: string[]): boolean {
  if (title.trim()) return true;
  const questions = new Set(asked.map((question) => question.trim()));
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line && !questions.has(line.replace(/^>\s?/, "").trim()));
}

/** Each day's page, the note written to Today's question (`source: "page"`): the first one that day. */
export function pagesOf(records: NoteRecord[]): Record<Day, string> {
  const pages: Record<Day, string> = {};
  const sorted = records.filter((note) => (note.source as string | null) === "page").sort((a, b) => asDate(a.createdAt).getTime() - asDate(b.createdAt).getTime());
  for (const note of sorted) {
    const day = dayOf(asDate(note.createdAt));
    pages[day] ??= note.id;
  }
  return pages;
}

export function toFocus(summary: FocusSummary | undefined): { focus: Record<string, FocusHistory>; focusToday: number } {
  const focus: Record<string, FocusHistory> = {};
  for (const item of summary?.tasks ?? []) {
    focus[item.taskId] = {
      sessions: item.sessions,
      minutes: Math.round(item.totalSeconds / 60),
      lastAt: asDate(item.lastEndedAt).getTime(),
      leftOff: item.lastLeftOff || null,
      outcome: item.lastOutcome,
    };
  }
  return { focus, focusToday: Math.round((summary?.todaySeconds ?? 0) / 60) };
}

/**
 * A new note's Markdown from Sage's note page: plain words, or each question
 * as a quote above the answer written to it.
 */
export function noteContent({ body, segments }: { body?: string; segments?: { question: string | null; answer: string }[] }): string {
  if (!segments) return (body ?? "").trim();
  return segments
    .map(({ question, answer }) => [question ? `> ${question}` : "", answer.trim()].filter(Boolean).join("\n\n"))
    .filter(Boolean)
    .join("\n\n");
}
