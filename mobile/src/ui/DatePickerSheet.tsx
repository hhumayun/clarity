import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { atNoon } from "../lib/dates";
import { spacing } from "../theme";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

type Props = {
  open: boolean;
  value: Date | null;
  onClose: () => void;
  onSelect: (date: Date | null) => void;
};

/**
 * The platform's own date picker. On Android it is a dialog of its own, so it
 * is rendered bare; on iOS it is an inline calendar, so it sits in a sheet
 * with explicit Done and Clear actions rather than relying on a tap outside.
 */
export function DatePickerSheet({ open, value, onClose, onSelect }: Props) {
  const { colors, dark } = useAppTheme();

  // Midday, matching the quick options, so a stored day cannot slide backwards
  // across a timezone.
  const normalize = (date: Date) =>
    atNoon(date.getFullYear(), date.getMonth(), date.getDate());

  const handleChange = (event: DateTimePickerEvent, date?: Date) => {
    if (event.type === "dismissed") {
      onClose();
      return;
    }
    if (date) onSelect(normalize(date));
    // Android's dialog closes itself once a day is chosen; iOS keeps the
    // calendar up so the choice can be adjusted before Done.
    if (Platform.OS !== "ios") onClose();
  };

  if (!open) return null;

  if (Platform.OS !== "ios") {
    return (
      <DateTimePicker
        value={value ?? new Date()}
        mode="date"
        display="default"
        onChange={handleChange}
      />
    );
  }

  return (
    <Sheet open={open} title="Pick a date" onClose={onClose}>
      <View style={styles.picker}>
        <DateTimePicker
          value={value ?? new Date()}
          mode="date"
          display="inline"
          accentColor={colors.primary}
          themeVariant={dark ? "dark" : "light"}
          onChange={handleChange}
        />
      </View>
      <Button size="lg" onPress={onClose}>
        Done
      </Button>
      <Button
        variant="secondary"
        onPress={() => {
          onSelect(null);
          onClose();
        }}
      >
        Clear date
      </Button>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // The inline calendar draws its own padding; this just keeps it off the
  // sheet's edges on narrow screens.
  picker: { marginHorizontal: -spacing[2] },
});
