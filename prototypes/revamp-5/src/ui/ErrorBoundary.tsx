import type { ErrorBoundaryProps } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { accents, dark, light, radius, space, type } from "../theme/tokens";

/**
 * When a screen fails: a calm page instead of a red one, and a way back in.
 * It can't count on the app's providers, so it reads the system's light or
 * dark and uses sage.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const night = useColorScheme() === "dark";
  const colors = night ? dark : light;
  const accent = accents.sage[night ? "dark" : "light"];
  return (
    <View style={[styles.page, { backgroundColor: colors.page }]}>
      <Text style={[type.title2, styles.center, { color: colors.ink }]}>Something went wrong</Text>
      <Text style={[type.callout, styles.center, { color: colors.ink2 }]}>What you wrote is kept on this phone. Try again, and if it keeps happening, close the app and open it again.</Text>
      <Pressable onPress={() => void retry()} accessibilityRole="button" style={({ pressed }) => [styles.button, { backgroundColor: accent.solid, opacity: pressed ? 0.85 : 1 }]}>
        <Text style={[type.headline, { color: accent.on }]}>Try again</Text>
      </Pressable>
      {__DEV__ ? <Text style={[type.footnote, styles.center, { color: colors.ink3 }]}>{error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: space[8], gap: space[3] },
  center: { textAlign: "center", maxWidth: 340 },
  button: { marginTop: space[3], height: 50, paddingHorizontal: 28, borderRadius: radius.button, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
});
