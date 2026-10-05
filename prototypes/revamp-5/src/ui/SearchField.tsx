import React from "react";
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { radius, space } from "../theme/tokens";
import { Icon } from "./Icon";
import { useType } from "./Txt";

/** A white well with a magnifier, for searching inside a sheet. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, accent } = useTheme();
  const sized = useType("callout");
  return (
    <View style={[styles.field, { backgroundColor: colors.card }, style]}>
      <Icon name="search" size={18} color={colors.ink3} weight="semibold" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        selectionColor={accent.solid}
        cursorColor={accent.solid}
        autoFocus={autoFocus}
        returnKeyType="search"
        autoCorrect={false}
        style={[sized, styles.input, { color: colors.ink }]}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable onPress={() => onChangeText("")} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
          <Icon name="close" size={15} color={colors.ink3} weight="semibold" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: "row", alignItems: "center", gap: space[2], height: 48, paddingHorizontal: space[4], borderRadius: radius.button, borderCurve: "continuous" },
  input: { flex: 1, height: 48, paddingVertical: 0, outlineWidth: 0 },
});
