import { useStore } from "./store";

export const useTask = (id: string | undefined) => useStore((state) => state.tasks.find((task) => task.id === id));
export const useNote = (id: string | undefined) => useStore((state) => state.notes.find((note) => note.id === id));
export const useFocusHistory = (id: string | undefined) => useStore((state) => (id ? state.focus[id] : undefined));
