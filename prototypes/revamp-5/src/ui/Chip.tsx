import React from "react";
import { StyleSheet } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { radius } from "../theme/tokens";
import { Icon, type IconName } from "./Icon";
import { PressableScale } from "./PressableScale";
import { Txt } from "./Txt";

/**
 * A choice, as a white pill on the page. Chosen, it takes an ink edge and
 * ink words. With an icon and no label it's a small round glyph. `onCard`
 * draws it on a card instead, as a pale well.
 */
export function Chip({
  label,
  icon,
  selected,
  onPress,
  onCard,
  accessibilityLabel,
}: {
  label?: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  onCard?: boolean;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const tone = selected ? colors.ink : colors.ink2;
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      aria-selected={selected}
      scaleTo={0.94}
      style={[
        styles.chip,
        label ? null : styles.round,
        { backgroundColor: onCard ? colors.sunken : colors.card, borderColor: selected ? colors.ink : onCard ? colors.sunken : colors.card },
      ]}
    >
      {icon ? <Icon name={icon} size={15} color={tone} weight="semibold" /> : null}
      {label ? (
        <Txt variant="footnote" weight={selected ? "bold" : "semibold"} style={{ color: tone }}>
          {label}
        </Txt>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, height: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderCurve: "continuous", borderWidth: 1.5 },
  round: { width: 36, paddingHorizontal: 0 },
});
