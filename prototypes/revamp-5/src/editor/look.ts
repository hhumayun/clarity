import { useMemo } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { edge } from "../theme/tokens";
import { useType } from "../ui/Txt";
import type { EditorLook } from "./protocol";

/** Sage's look for the editor page, resolved for the theme, the accent and larger text. */
export function useEditorLook(placeholder: string): EditorLook {
  const { colors, accent } = useTheme();
  const body = useType("body");
  const prompt = useType("prompt");
  return useMemo(
    () => ({
      placeholder,
      colors: {
        card: colors.card,
        ink: colors.ink,
        ink2: colors.ink2,
        ink3: colors.ink3,
        line: colors.line,
        sunken: colors.sunken,
        accent: accent.solid,
        onAccent: accent.on,
        accentText: accent.text,
      },
      body: { size: body.fontSize, lineHeight: body.lineHeight },
      question: { size: prompt.fontSize, lineHeight: prompt.lineHeight },
      // The same sides as Sage's pages; two lines of room under the last line.
      padding: { top: 6, side: edge + 4, bottom: body.lineHeight * 2 },
    }),
    [placeholder, colors, accent, body.fontSize, body.lineHeight, prompt.fontSize, prompt.lineHeight],
  );
}
