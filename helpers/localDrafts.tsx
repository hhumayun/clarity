export type LocalDraft = { title: string; content: string; at: number };

/**
 * Drafts are written to this device the moment a key is pressed, before any
 * network call. Writing is never blocked by sync: if the server is
 * unreachable, the words are still here when the note is reopened.
 */
export const localDrafts = {
  save(key: string, draft: LocalDraft): void {
    try {
      window.localStorage.setItem(`clarity:draft:${key}`, JSON.stringify(draft));
    } catch {
      // Best effort.
    }
  },

  load(key: string): LocalDraft | null {
    try {
      const raw = window.localStorage.getItem(`clarity:draft:${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LocalDraft;
      return typeof parsed?.content === "string" ? parsed : null;
    } catch {
      return null;
    }
  },

  clear(key: string): void {
    try {
      window.localStorage.removeItem(`clarity:draft:${key}`);
    } catch {
      // Best effort.
    }
  },
};