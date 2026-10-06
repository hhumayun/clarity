import React, { Children, Fragment, isValidElement } from "react";
import { ScrollView, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeProvider";
import { edge, pad, radius, space, type TypeName } from "../theme/tokens";
import { Button } from "./Button";
import { CardRow } from "./Card";
import { Chip } from "./Chip";
import { Icon, type IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { Txt, useType } from "./Txt";

/**
 * The inside of a native sheet (a formSheet route), Rosebud's way: on the
 * grey page, a centred title and at most a line under it, then the choices
 * on a white card. The system draws the grabber and handles the drag. The
 * action, if any, is a check at the top right.
 */
export function SheetFrame({
  title,
  description,
  children,
  scroll,
  action,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
  scroll?: boolean;
  /** A check at the top right; `label` is what a screen reader says. */
  action?: { label: string; onPress: () => void; icon?: IconName };
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const head = (
    <View style={styles.head}>
      <View style={styles.side} />
      <View style={styles.titles}>
        <Txt variant="title2" center accessibilityRole="header">
          {title}
        </Txt>
        {description ? (
          <Txt variant="subhead" tone="ink3" center numberOfLines={2}>
            {description}
          </Txt>
        ) : null}
      </View>
      <View style={styles.side}>{action ? <IconButton icon={action.icon ?? "check"} label={action.label} tone="ink" onPress={action.onPress} /> : null}</View>
    </View>
  );
  const padding = { paddingBottom: Math.max(insets.bottom, space[4]) + space[2] };
  if (scroll) {
    return (
      <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={[styles.body, padding]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {head}
        <View style={styles.content}>{children}</View>
      </ScrollView>
    );
  }
  return (
    <View style={[styles.body, padding, { backgroundColor: colors.page }]}>
      {head}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

/** A small grey caption over a group inside a sheet: an icon and a word. */
export function SheetLabel({ icon, title }: { icon: IconName; title: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.label}>
      <Icon name={icon} size={15} color={colors.ink3} weight="semibold" />
      <Txt variant="footnote" tone="ink3" weight="semibold" accessibilityRole="header">
        {title}
      </Txt>
    </View>
  );
}

/** A row of choices: white pills on the page, the chosen one takes an ink edge. */
export function ChoiceChips<T>({
  choices,
  selected,
  onChoose,
  style,
}: {
  choices: { label: string; value: T }[];
  selected?: (value: T) => boolean;
  onChoose: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.chips, style]}>
      {choices.map((choice) => (
        <Chip key={choice.label} label={choice.label} selected={selected ? selected(choice.value) : false} onPress={() => onChoose(choice.value)} />
      ))}
    </View>
  );
}

/** Rows on one white card, a hairline between them. */
export function SheetList({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const items = Children.toArray(children).filter((child) => isValidElement(child));
  return (
    <View style={[styles.list, { backgroundColor: colors.card, boxShadow: colors.cardShadow }]}>
      {items.map((child, i) => (
        <Fragment key={isValidElement(child) && child.key != null ? child.key : i}>
          {i > 0 ? <View style={[styles.rule, { backgroundColor: colors.hairline }]} /> : null}
          {child}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One row of a sheet: a line icon, one word, and at the end a value, the
 * accent's check for what's chosen, or a chevron. Destructive rows go red
 * and keep their word.
 */
export function SheetRow({
  icon,
  label,
  detail,
  value,
  selected,
  chevron,
  danger,
  trailing,
  onPress,
  role = "button",
  hint,
}: {
  icon?: IconName;
  label: string;
  detail?: React.ReactNode;
  value?: string;
  selected?: boolean;
  chevron?: boolean;
  danger?: boolean;
  trailing?: React.ReactNode;
  /** Without it the row is plain, for rows whose actions are their own buttons. */
  onPress?: () => void;
  role?: "button" | "checkbox" | "radio";
  hint?: string;
}) {
  const { colors, accent } = useTheme();
  const content = (
    <>
      {icon ? (
        <View style={styles.slot}>
          <Icon name={icon} size={20} color={danger ? colors.danger : colors.ink2} weight="medium" />
        </View>
      ) : null}
      <View style={styles.words}>
        <Txt variant="row" tone={danger ? "danger" : "ink"} numberOfLines={1}>
          {label}
        </Txt>
        {typeof detail === "string" ? (
          <Txt variant="footnote" tone="ink3" numberOfLines={1}>
            {detail}
          </Txt>
        ) : (
          detail
        )}
      </View>
      {trailing ? (
        trailing
      ) : value ? (
        <Txt variant="subhead" tone="ink3" numberOfLines={1} style={styles.value}>
          {value}
        </Txt>
      ) : selected ? (
        <View style={[styles.chosen, { backgroundColor: accent.solid }]}>
          <Icon name="check" size={13} color={accent.on} weight="bold" />
        </View>
      ) : null}
      {chevron ? <Icon name="forward" size={14} color={colors.ink3} weight="semibold" /> : null}
    </>
  );
  return onPress ? (
    <CardRow onPress={onPress} accessibilityRole={role} accessibilityLabel={label} accessibilityHint={hint} aria-checked={role === "button" ? undefined : !!selected} style={styles.row}>
      {content}
    </CardRow>
  ) : (
    <View style={[styles.row, styles.plain]}>{content}</View>
  );
}

/** A plain text field: a white well, the caret in the accent. */
export function TextField({ variant = "callout", style, ...rest }: TextInputProps & { variant?: TypeName }) {
  const { colors, accent } = useTheme();
  const sized = useType(variant);
  return (
    <TextInput
      placeholderTextColor={colors.ink3}
      selectionColor={accent.solid}
      cursorColor={accent.solid}
      {...rest}
      style={[sized, styles.field, { color: colors.ink, backgroundColor: colors.card }, style]}
    />
  );
}

/** The sheet's main action, full width in the accent, and an optional quiet one under it. */
export function SheetButtons({
  primary,
  secondary,
}: {
  primary: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean; icon?: IconName };
  secondary?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.buttons}>
      <Button label={primary.label} icon={primary.icon} variant={primary.danger ? "danger" : "primary"} disabled={primary.disabled} onPress={primary.onPress} />
      {secondary ? <Button label={secondary.label} variant="plain" size="md" onPress={secondary.onPress} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: space[6], gap: space[5] },
  head: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: edge - 6 },
  side: { width: 44, alignItems: "flex-end" },
  titles: { flex: 1, gap: space[1] },
  content: { paddingHorizontal: edge, gap: space[4] },
  label: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  list: { borderRadius: radius.card, borderCurve: "continuous", overflow: "hidden" },
  rule: { height: 1 },
  row: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 10 },
  plain: { paddingHorizontal: pad },
  slot: { width: 24, alignItems: "center", justifyContent: "center" },
  words: { flex: 1, gap: 2 },
  value: { maxWidth: 140 },
  chosen: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  field: { height: 50, borderRadius: radius.button, borderCurve: "continuous", paddingHorizontal: pad, paddingVertical: 0, outlineWidth: 0 },
  buttons: { gap: space[1], marginTop: space[1] },
});
