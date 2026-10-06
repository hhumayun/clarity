import { useSage } from "./sage";

/** One task, note or task's focus history, from whichever source the app is showing. */
export const useTask = (id: string | undefined) => useSage((state) => state.tasks.find((task) => task.id === id));
export const useNote = (id: string | undefined) => useSage((state) => state.notes.find((note) => note.id === id));
export const useFocusHistory = (id: string | undefined) => useSage((state) => (id ? state.focus[id] : undefined));
