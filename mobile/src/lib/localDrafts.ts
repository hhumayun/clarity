import AsyncStorage from "@react-native-async-storage/async-storage";

export type LocalDraft = { title: string; content: string; at: number };

const keyFor = (key: string) => `clarity:draft:${key}`;

export const localDrafts = {
  async save(key: string, draft: LocalDraft): Promise<void> {
    try {
      await AsyncStorage.setItem(keyFor(key), JSON.stringify(draft));
    } catch {
      // Best effort.
    }
  },

  async load(key: string): Promise<LocalDraft | null> {
    try {
      const raw = await AsyncStorage.getItem(keyFor(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as LocalDraft;
      return typeof parsed?.content === "string" ? parsed : null;
    } catch {
      return null;
    }
  },

  async clear(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(keyFor(key));
    } catch {
      // Best effort.
    }
  },
};
