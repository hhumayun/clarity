import { PHOTO_ID } from "./attachmentLimits";

/**
 * Finding the photos a note names, and taking them out of text
 * (docs/photos-server.md, 6.1). A photo is named as `![](attachment:<id>)` in
 * a note's Markdown and as an image node with `attrs.src = "attachment:<id>"`
 * in its rich text. Pure functions; safe anywhere.
 */

/** Loose on purpose: a token broken by hand in the web app's textarea still names its photo. */
const IN_TEXT = /attachment:([A-Za-z0-9-]{8,64})/g;
const PREFIX = "attachment:";

/** Photo ids named anywhere in a note's Markdown, even in a broken token. */
export function attachmentIdsInText(content: string): Set<string> {
  const ids = new Set<string>();
  if (typeof content !== "string" || !content.includes(PREFIX)) return ids;
  for (const match of content.matchAll(IN_TEXT)) ids.add(match[1]);
  return ids;
}

/**
 * Photo ids in the rich text: every node of type "image" whose attrs.src
 * starts with "attachment:". Walks `content` arrays without recursion. A
 * string doc (stored double-encoded, before migration 015) is parsed first;
 * anything unreadable gives an empty set.
 */
export function attachmentIdsInDoc(doc: unknown): Set<string> {
  const ids = new Set<string>();
  let root = doc;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {
      return ids;
    }
  }
  if (!root || typeof root !== "object") return ids;
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const { type, attrs, content } = node as { type?: unknown; attrs?: unknown; content?: unknown };
    if (type === "image" && attrs && typeof attrs === "object") {
      const src = (attrs as { src?: unknown }).src;
      if (typeof src === "string" && src.startsWith(PREFIX)) {
        const id = src.slice(PREFIX.length);
        if (PHOTO_ID.test(id)) ids.add(id);
      }
    }
    if (Array.isArray(content)) for (const child of content) stack.push(child);
  }
  return ids;
}

/** The union of both: what the note names. */
export function attachmentIdsOf(content: string, doc: unknown): Set<string> {
  const ids = attachmentIdsInText(content);
  for (const id of attachmentIdsInDoc(doc)) ids.add(id);
  return ids;
}

/**
 * Puts photos back at the end of a note: a `![](attachment:<id>)` paragraph
 * each in the Markdown, a top-level image node each in the rich text (the
 * shape Sage's editor keeps, editor/extensions.ts liftPhotos). A null doc
 * stays null; a double-encoded one is read first; an unreadable one is left
 * as it is (the Markdown still names the photos).
 */
export function appendPhotos(content: string, doc: unknown, ids: string[]): { content: string; doc: unknown } {
  if (ids.length === 0) return { content, doc };
  const nextContent =
    content.trimEnd() + (content.trim() ? "\n\n" : "") + ids.map((id) => `![](attachment:${id})`).join("\n\n");
  if (doc === null || doc === undefined) return { content: nextContent, doc: doc ?? null };
  let root = doc;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root);
    } catch {
      return { content: nextContent, doc };
    }
  }
  if (!root || typeof root !== "object" || Array.isArray(root)) return { content: nextContent, doc };
  const existing = (root as { content?: unknown }).content;
  const nextDoc = {
    ...(root as Record<string, unknown>),
    content: [
      ...(Array.isArray(existing) ? existing : []),
      ...ids.map((id) => ({ type: "image", attrs: { src: `attachment:${id}` } })),
    ],
  };
  return { content: nextContent, doc: nextDoc };
}

/** Text with every photo taken out, for AI models, previews and hashes. */
export function withoutAttachments(text: string): string {
  if (typeof text !== "string" || !text.includes(PREFIX)) return text;
  return text
    .replace(/!\[[^\]]*\]\(attachment:[^)]*\)/g, "")
    .replace(/attachment:[A-Za-z0-9-]{8,64}/g, "")
    .replace(/\n{3,}/g, "\n\n");
}
