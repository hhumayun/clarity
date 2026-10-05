import AsyncStorage from "@react-native-async-storage/async-storage";
import { kbOf, perfNow, perfRecord } from "./perf";

/**
 * Each opened note's rich text, kept on the phone apart from the lists. The
 * lists carry only the Markdown (for previews and search), so the copy of
 * them kept for offline stays small. A note opened before still opens exactly
 * as written, offline too.
 *
 * Kept with the Markdown it was saved with: it is only used while the note's
 * text still matches, so a note changed elsewhere since never opens from a
 * stale copy.
 */
const PREFIX = "clarity:doc:";

type Stored = { doc: unknown; content: string };

export const noteDocs = {
  async save(id: string, doc: unknown, content: string): Promise<void> {
    try {
      const started = perfNow();
      const text = JSON.stringify({ doc, content } satisfies Stored);
      await AsyncStorage.setItem(PREFIX + id, text);
      perfRecord("rich copy write", perfNow() - started, kbOf(text));
    } catch {
      // Best effort: the server has it.
    }
  },
  /** The note's rich text, if it was kept for exactly this Markdown. */
  async load(id: string, content: string): Promise<unknown | null> {
    try {
      const raw = await AsyncStorage.getItem(PREFIX + id);
      if (!raw) return null;
      const stored = JSON.parse(raw) as Stored;
      return stored.content === content ? (stored.doc ?? null) : null;
    } catch {
      return null;
    }
  },
  /** Several at once, each only where none is kept yet (moving them out of the lists). */
  async saveMissing(entries: Map<string, Stored>): Promise<void> {
    try {
      const keys = [...entries.keys()].map((id) => PREFIX + id);
      const kept = new Set((await AsyncStorage.multiGet(keys)).filter(([, value]) => value != null).map(([key]) => key));
      const pairs: [string, string][] = [];
      for (const [id, stored] of entries) {
        if (!kept.has(PREFIX + id)) pairs.push([PREFIX + id, JSON.stringify(stored)]);
      }
      if (pairs.length) await AsyncStorage.multiSet(pairs);
    } catch {
      // Best effort: the server has them.
    }
  },
  async remove(id: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(PREFIX + id);
    } catch {
      // Best effort.
    }
  },
  /** Signing out: none of them stay on the phone. */
  async clearAll(): Promise<void> {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
      if (keys.length) await AsyncStorage.multiRemove(keys);
    } catch {
      // Best effort.
    }
  },
};
