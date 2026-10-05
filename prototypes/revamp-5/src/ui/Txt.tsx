import React from "react";
import { Text, type TextProps } from "react-native";
import { useStore } from "../store/store";
import { useTheme } from "../theme/ThemeProvider";
import { face, type, type TypeName, type Weight } from "../theme/tokens";

export type Tone = "ink" | "ink2" | "ink3" | "accent" | "onAccent" | "onSoft" | "onDeep" | "warm" | "danger";

/** "Larger text" in Settings: every size grows by the same step (body 17 → 20). */
export const LARGE_TEXT = 20 / 17;

/** A ramp style, grown with "Larger text". Text fields use it too, so what you type matches what you read. */
export function useType(variant: TypeName) {
  const large = useStore((state) => state.prefs.largeText);
  const base = type[variant];
  return large ? { ...base, fontSize: Math.round(base.fontSize * LARGE_TEXT), lineHeight: Math.round(base.lineHeight * LARGE_TEXT) } : base;
}

/** The colour of a tone in the current theme and accent. */
export function useTone(): (tone: Tone) => string {
  const { colors, accent } = useTheme();
  return (tone) => {
    switch (tone) {
      case "accent":
        return accent.text;
      case "onAccent":
        return accent.on;
      case "onSoft":
        return accent.onSoft;
      case "onDeep":
        return accent.onDeep;
      default:
        return colors[tone];
    }
  };
}

/**
 * All text goes through the ramp: a variant and a tone, never loose sizes.
 * `weight` swaps the face (custom fonts don't synthesise bold), and
 * `center` is the common case of a centred line.
 */
export function Txt({
  variant = "body",
  tone = "ink",
  weight,
  center,
  style,
  ...rest
}: TextProps & { variant?: TypeName; tone?: Tone; weight?: Weight; center?: boolean }) {
  const sized = useType(variant);
  const color = useTone()(tone);
  return <Text {...rest} style={[sized, { color }, weight ? { fontFamily: face[weight] } : null, center ? { textAlign: "center" } : null, style]} />;
}
