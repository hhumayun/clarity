import { useCallback } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { areaMarks } from "../theme/tokens";
import { useStore } from "./store";

/** An area's mark (the square beside its name, a dot in the week) in the current theme; ink 3 for none. */
export function useAreaColor(): (name: string | null | undefined) => string {
  const { dark, colors } = useTheme();
  const areas = useStore((state) => state.areas);
  return useCallback(
    (name) => {
      const area = name ? areas.find((item) => item.name === name) : undefined;
      return area ? areaMarks[dark ? "dark" : "light"][area.hue % 8] : colors.ink3;
    },
    [areas, dark, colors.ink3],
  );
}

export const useTask = (id: string | undefined) => useStore((state) => state.tasks.find((task) => task.id === id));
export const useNote = (id: string | undefined) => useStore((state) => state.notes.find((note) => note.id === id));
export const useFocusHistory = (id: string | undefined) => useStore((state) => (id ? state.focus[id] : undefined));
