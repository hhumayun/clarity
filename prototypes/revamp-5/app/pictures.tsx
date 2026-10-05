import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Hourglass, Magnifier, Notebook, Sprout, Tea } from "../src/art/Pictures";
import { TimeOfDay } from "../src/art/TimeOfDay";
import { useTheme } from "../src/theme/ThemeProvider";
import { edge, radius, space, type Phase } from "../src/theme/tokens";
import { IconButton } from "../src/ui/IconButton";
import { Txt } from "../src/ui/Txt";

const DAY: { phase: Phase; label: string }[] = [
  { phase: "dawn", label: "Dawn: the sun rises" },
  { phase: "day", label: "Day: it turns behind a cloud" },
  { phase: "dusk", label: "Dusk: it sets as birds cross" },
  { phase: "night", label: "Night: the moon rocks, stars twinkle" },
];

/** All of Clarity's small pictures on one page, each doing its one quiet thing. Opened from Settings. */
export default function PicturesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const tile = (key: string, picture: React.ReactNode, label: string) => (
    <View key={key} style={[styles.tile, { backgroundColor: colors.card }]}>
      <View style={styles.picture}>{picture}</View>
      <Txt variant="footnote" tone="ink2" center>
        {label}
      </Txt>
    </View>
  );
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <IconButton icon="back" label="Back" tone="ink" onPress={() => router.back()} />
        <Txt variant="headline" style={styles.title}>
          Pictures
        </Txt>
        <View style={styles.side} />
      </View>
      <ScrollView contentContainerStyle={[styles.grid, { paddingBottom: insets.bottom + space[10] }]} showsVerticalScrollIndicator={false}>
        {DAY.map(({ phase, label }) => tile(phase, <TimeOfDay phase={phase} size={110} />, label))}
        {tile("hourglass", <Hourglass size={84} />, "Focus: the sand runs, the glass turns")}
        {tile("sprout", <Sprout size={104} />, "All clear: a sprout grows")}
        {tile("tea", <Tea size={88} />, "A quiet moment: steam rises")}
        {tile("magnifier", <Magnifier size={104} />, "Search: a glass drifts over a page")}
        {tile("notebook", <Notebook size={88} />, "No notes: a pencil writes")}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", paddingHorizontal: edge - 10, paddingBottom: space[1] },
  title: { flex: 1, textAlign: "center" },
  side: { width: 44 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space[3], paddingHorizontal: edge, paddingTop: space[3] },
  tile: { width: "47.5%", flexGrow: 1, alignItems: "center", gap: space[2], paddingVertical: space[5], paddingHorizontal: space[3], borderRadius: radius.card, borderCurve: "continuous" },
  picture: { height: 110, alignItems: "center", justifyContent: "center" },
});
