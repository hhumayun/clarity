import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "../theme/ThemeProvider";
import { radius } from "../theme/tokens";
import { tick } from "./haptics";
import { Icon, type IconName } from "./Icon";
import { useStretch } from "./stretch";
import { Txt } from "./Txt";

const PAD = 3;

/** With `iconOnly` the glyph stands alone and the label is what a screen reader says. */
type Option<T> = { label: string; value: T; icon?: IconName; iconOnly?: boolean };

/**
 * Two to five views of one thing: a soft track with a raised white segment
 * that stretches to the chosen one (Rosebud's plan picker). Works on the
 * page and on a card alike.
 */
export function Segmented<T extends string | number>({ options, value, onChange, accessibilityLabel }: { options: Option<T>[]; value: T; onChange: (value: T) => void; accessibilityLabel?: string }) {
  const { colors, dark } = useTheme();
  const [width, setWidth] = useState(0);
  const slot = width / options.length;
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const pill = useStretch(index, slot);
  return (
    <View style={[styles.track, { backgroundColor: dark ? "rgba(255,255,255,0.07)" : "rgba(31,29,26,0.06)" }]} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      <View style={styles.inner} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {slot > 0 ? <Animated.View style={[styles.pill, { backgroundColor: dark ? colors.raised : colors.card, boxShadow: "0px 1px 3px rgba(0,0,0,0.10)" }, pill]} /> : null}
        {options.map((option) => {
          const on = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => {
                if (!on) tick();
                onChange(option.value);
              }}
              accessibilityRole="tab"
              accessibilityLabel={option.label}
              aria-selected={on}
              style={styles.option}
            >
              {option.icon ? <Icon name={option.icon} size={option.iconOnly ? 18 : 16} color={on ? colors.ink : colors.ink3} weight="semibold" fill={on && option.iconOnly} /> : null}
              {option.iconOnly ? null : (
                <Txt variant="subhead" weight="semibold" numberOfLines={1} style={{ color: on ? colors.ink : colors.ink3 }}>
                  {option.label}
                </Txt>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 40, padding: PAD, borderRadius: radius.sm, borderCurve: "continuous" },
  inner: { flex: 1, flexDirection: "row" },
  pill: { position: "absolute", top: 0, bottom: 0, left: 0, borderRadius: radius.sm - 2, borderCurve: "continuous" },
  option: { flex: 1, flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" },
});
