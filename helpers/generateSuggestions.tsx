import { aiChatJson, DEFAULT_MODEL } from "./ai";
import { db } from "./db";
import type { EntityType } from "./schema";
import { isPersonalizationEnabled } from "./isPersonalizationEnabled";
import { parseModelJson } from "./parseModelJson";
import {
  ENTITY_TYPE_WEIGHTS,
  normalizeEntity,
} from "./noteEntityIndex";
import {
  SUGGESTION_CATEGORIES,
  isSuggestionCategory,
  type CompletionSuggestion,
  type Suggestion,
} from "./suggestionCategories";
import { reflectionQuestions } from "./reflectionQuestions";

/**
 * Adaptive sentence-starter suggestions. Personalization (accepted/dismissed
 * history + entity-matched related notes) is best-effort and never blocks the
 * writer: any failure falls back to an empty bubble row plus a local
 * reflection question. Backend only.
 *
 * Accepted phrases are deliberately NOT fed back into the prompt. Doing so was
 * self-reinforcing: accepting a stem raised its count, which kept it in the
 * top eight, which had it suggested again. Measured over five runs on one
 * note, sending them made 28 of 30 stems verbatim replays and cut distinct
 * stems from 27 to 10. Dismissals are still sent — that filter only ever
 * removes phrases — and related-note excerpts still provide topic context,
 * since neither causes the loop.
 */

const MAX_SUGGESTION_LEN = 60;
const MAX_RELATED_NOTES = 3;
// Keep enough related-note context to capture a later, more specific mention,
// while preserving room to finish the excerpt at a sentence boundary.
const EXCERPT_TARGET = 900;
const EXCERPT_MAX = 1_000;
const ENTITY_DICTIONARY_LIMIT = 4_000;
const RECENT_EVENT_SAMPLE = 200;

export type SuggestionsResult = {
  suggestions: Suggestion[];
  completionSuggestions: CompletionSuggestion[];
  reflectionQuestion: string;
};

type Excerpt = { title: string; excerpt: string };

/** A fast flash model keeps this short, structured suggestion task responsive. */
const MODEL = DEFAULT_MODEL;

async function askForStems(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  return aiChatJson({
    model: MODEL,
    systemPrompt,
    userPrompt,
    maxOutputTokens: 2_000,
  });
}

type Context = {
  frequentPhrases: string[];
  dismissedPhrases: string[];
  excerpts: Excerpt[];
};

const EMPTY_CONTEXT: Context = {
  frequentPhrases: [],
  dismissedPhrases: [],
  excerpts: [],
};

async function loadHistory(
  userId: number,
): Promise<Pick<Context, "frequentPhrases" | "dismissedPhrases">> {
  const events = await db
    .selectFrom("suggestionEvents")
    .select(["suggestionText", "action"])
    .where("userId", "=", userId)
    .where("action", "in", ["accepted", "dismissed"])
    .orderBy("createdAt", "desc")
    .limit(RECENT_EVENT_SAMPLE)
    .execute();

  const accepted = new Map<string, number>();
  const dismissed: string[] = [];
  for (const event of events) {
    if (event.action === "accepted") {
      accepted.set(
        event.suggestionText,
        (accepted.get(event.suggestionText) ?? 0) + 1,
      );
    } else if (dismissed.length < 10 && !dismissed.includes(event.suggestionText)) {
      dismissed.push(event.suggestionText);
    }
  }

  const frequentPhrases = [...accepted.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([text]) => text);

  return { frequentPhrases, dismissedPhrases: dismissed };
}

/**
 * Entity-based retrieval: match the writing context against the user's entity
 * dictionary (alias-aware), union with the current note's own entities, then
 * rank other notes by shared-entity weight and recency. No model call here —
 * matching is plain string work.
 */
export async function loadEntityExcerpts(
  userId: number,
  noteId: string | undefined,
  contextText: string,
): Promise<Excerpt[]> {
  const entityRows = await db
    .selectFrom("noteEntities")
    .selectAll()
    .where("userId", "=", userId)
    .orderBy("createdAt", "desc")
    .limit(ENTITY_DICTIONARY_LIMIT)
    .execute();
  if (entityRows.length === 0) return [];

  const haystack = ` ${normalizeEntity(contextText)} `;
  const mentioned = (term: string): boolean => {
    const normalized = normalizeEntity(term);
    return normalized.length >= 2 && haystack.includes(` ${normalized} `);
  };

  const matchedNames = new Set<string>();
  for (const row of entityRows) {
    if (noteId && row.noteId === noteId) {
      // The current note's own entities always count as context.
      matchedNames.add(row.normalizedName);
    } else if (
      !matchedNames.has(row.normalizedName) &&
      [row.name, ...row.aliases].some(mentioned)
    ) {
      matchedNames.add(row.normalizedName);
    }
  }
  if (matchedNames.size === 0) return [];

  const scores = new Map<
    string,
    { score: number; matches: typeof entityRows }
  >();
  for (const row of entityRows) {
    if (noteId && row.noteId === noteId) continue;
    if (!matchedNames.has(row.normalizedName)) continue;
    const weight = ENTITY_TYPE_WEIGHTS[row.type as EntityType] ?? 1;
    const entry = scores.get(row.noteId) ?? { score: 0, matches: [] };
    entry.score += weight;
    entry.matches.push(row);
    scores.set(row.noteId, entry);
  }
  if (scores.size === 0) return [];

  const notes = await db
    .selectFrom("notes")
    .select(["id", "title", "content", "updatedAt"])
    .where("userId", "=", userId)
    .where("archived", "=", false)
    .where("id", "in", [...scores.keys()])
    .execute();

  // Recency is a genuine score component (halving over ~30 days), mild
  // enough that shared people and places still dominate.
  const now = Date.now();
  const totalScore = (note: { id: string; updatedAt: Date }): number => {
    const ageDays = Math.max(0, (now - note.updatedAt.getTime()) / 86_400_000);
    return (scores.get(note.id)?.score ?? 0) + 1 / (1 + ageDays / 30);
  };

  return notes
    .sort((a, b) => {
      const diff = totalScore(b) - totalScore(a);
      if (diff !== 0) return diff;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, MAX_RELATED_NOTES)
    .map((note) => {
      const matches = (scores.get(note.id)?.matches ?? []).sort(
        (a, b) =>
          (ENTITY_TYPE_WEIGHTS[b.type as EntityType] ?? 1) -
          (ENTITY_TYPE_WEIGHTS[a.type as EntityType] ?? 1),
      );
      const terms = matches.flatMap((m) => [m.name, ...m.aliases]);
      return { title: note.title, excerpt: excerptAround(note.content, terms) };
    })
    .filter((e) => e.title.trim().length > 0 || e.excerpt.trim().length > 0);
}

/** Word-boundary search, so entity "Ann" never matches inside "annual". */
function findMention(content: string, term: string): number {
  const t = term.trim();
  if (t.length < 2) return -1;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    const match = re.exec(content);
    return match ? match.index : -1;
  } catch {
    return content.toLowerCase().indexOf(t.toLowerCase());
  }
}

/**
 * Cut a sentence-aligned window around the first mention of the strongest
 * matched entity, rather than always taking the start of the note.
 */
function excerptAround(content: string, terms: string[]): string {
  if (content.length <= EXCERPT_MAX) return content;

  let pos = -1;
  for (const term of terms) {
    const i = findMention(content, term);
    if (i !== -1) {
      pos = i;
      break;
    }
  }
  if (pos === -1) return content.slice(0, EXCERPT_TARGET);

  let start = Math.max(0, pos - Math.floor(EXCERPT_TARGET / 2));
  for (let i = start; i < pos - 1; i++) {
    if (".!?\n".includes(content[i]) && i + 1 - start <= 120) {
      start = i + 1;
    }
  }
  let end = Math.min(content.length, Math.max(pos + 40, start + EXCERPT_TARGET));
  while (end < content.length && end - start < EXCERPT_MAX) {
    if (".!?\n".includes(content[end])) {
      end += 1;
      break;
    }
    end += 1;
  }
  return content.slice(start, end).trim();
}

const SYSTEM_PROMPT = `You help people who sometimes have trouble finding words while writing personal notes.
Given the text a person has written so far, offer two kinds of short word help: phrases that complete the current unfinished sentence, and sentence-starter stems that open the next sentence. Also offer one gentle reflective question.

Current-sentence completions:
- Return exactly 5 short fragments in "complete" when the cursor is inside an unfinished sentence.
- Each fragment is 1 to 5 everyday words and must attach naturally DIRECTLY after the final words at the cursor.
- Use casing and grammar that fit that exact position. Do not repeat words already written and do not start a new sentence.
- If the text is empty or already ends in . ! ? or a paragraph break, return an empty "complete" array.

The three moods:
- "deeper" — reflect on meaning or feeling (e.g. "It mattered because", "What I realized was")
- "continue" — keep the story going (e.g. "Then", "After that,")
- "forward" — look ahead (e.g. "Tomorrow I want to", "Next time I will")

Rules:
- Each stem is 1 to 5 everyday words. Plain, warm, simple language.
- Stems are openers, not full sentences — they invite the writer to finish the thought.
- Each must read naturally as the start of the writer's NEXT sentence, fitting what they wrote.
- Stems must clearly connect to THIS writer's words — echo their subject, moment, or feeling when natural. Never offer filler that could fit any note.
- If the writer stopped mid-sentence, favor stems that would also read well right after their unfinished thought is completed.
- Give exactly 2 stems per mood. Vary them; no near-duplicates.
- Never repeat a phrase the writer dismissed.
- Never give advice or corrections.
- The question is one short, gentle, open question about what they just wrote — curious, never probing or clinical.
- Respond ONLY with JSON:
{"complete": ["...", "...", "...", "...", "..."], "deeper": ["...", "..."], "continue": ["...", "..."], "forward": ["...", "..."], "question": "..."}`;

function buildPrompt(
  title: string,
  textBeforeCursor: string,
  ctx: Context,
): string {
  const parts: string[] = [];
  if (title.trim()) parts.push(`Note title: "${title.trim()}"`);
  if (ctx.excerpts.length > 0) {
    parts.push(
      "Short excerpts from the writer's earlier notes (for tone and topic context only):",
      ...ctx.excerpts.map(
        (e) => `- ${e.title ? e.title + ": " : ""}${e.excerpt}`,
      ),
    );
  }
  if (ctx.dismissedPhrases.length > 0) {
    parts.push(
      `Phrases the writer recently dismissed — do NOT suggest these: ${ctx.dismissedPhrases.join("; ")}`,
    );
  }
  parts.push(
    textBeforeCursor.trim().length === 0
      ? "The writer has not started yet. Offer gentle sentence starters."
      : `The writer's text so far (ends at the cursor):\n"""${textBeforeCursor.slice(-800)}"""`,
  );
  return parts.join("\n\n");
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export async function generateSuggestions(opts: {
  userId: number;
  noteId?: string;
  title?: string;
  textBeforeCursor: string;
}): Promise<SuggestionsResult> {
  const { userId, noteId, textBeforeCursor } = opts;
  const title = opts.title ?? "";
  const localQuestion = reflectionQuestions(textBeforeCursor);

  let ctx: Context = EMPTY_CONTEXT;
  try {
    if (await isPersonalizationEnabled(userId)) {
      const [history, excerpts] = await Promise.all([
        loadHistory(userId),
        loadEntityExcerpts(userId, noteId, `${title} ${textBeforeCursor}`),
      ]);
      ctx = { ...history, excerpts };
    }
  } catch {
    // Personalization is optional — never block suggestions on it.
    console.warn("personalization context failed; continuing without it");
  }

  const raw = await askForStems(
    SYSTEM_PROMPT,
    buildPrompt(title, textBeforeCursor, ctx),
  );
  const parsed = parseModelJson(raw);

  const seen = new Set<string>();
  const dismissed = new Set(
    ctx.dismissedPhrases.map((p) => normalize(p).toLowerCase()),
  );
  const frequent = new Set(
    ctx.frequentPhrases.map((p) => normalize(p).toLowerCase()),
  );

  const suggestions: Suggestion[] = [];
  for (const category of SUGGESTION_CATEGORIES) {
    const list = Array.isArray(parsed[category])
      ? (parsed[category] as unknown[])
      : [];
    let kept = 0;
    for (const item of list) {
      if (typeof item !== "string") continue;
      const text = normalize(item);
      const key = text.toLowerCase();
      if (!text || text.length > MAX_SUGGESTION_LEN) continue;
      if (seen.has(key) || dismissed.has(key)) continue;
      if (!isSuggestionCategory(category)) continue;
      seen.add(key);
      suggestions.push({
        text,
        source: frequent.has(key) ? "history" : "ai",
        category,
      });
      if (++kept >= 2) break;
    }
  }

  const completionSuggestions: CompletionSuggestion[] = [];
  const completionList = Array.isArray(parsed.complete)
    ? (parsed.complete as unknown[])
    : [];
  for (const item of completionList) {
    if (typeof item !== "string") continue;
    const text = normalize(item);
    const key = text.toLowerCase();
    if (!text || text.length > MAX_SUGGESTION_LEN) continue;
    if (seen.has(key) || dismissed.has(key)) continue;
    seen.add(key);
    completionSuggestions.push({
      text,
      source: frequent.has(key) ? "history" : "ai",
      kind: "completion",
    });
    if (completionSuggestions.length >= 5) break;
  }

  const question =
    typeof parsed.question === "string" && parsed.question.trim().length > 0
      ? normalize(parsed.question).slice(0, 120)
      : localQuestion;

  if (suggestions.length === 0 && completionSuggestions.length === 0) {
    return {
      suggestions: [],
      completionSuggestions: [],
      reflectionQuestion: localQuestion,
    };
  }
  return { suggestions, completionSuggestions, reflectionQuestion: question };
}