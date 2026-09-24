import { useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../src/providers/AuthProvider";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors, type ThemeMode } from "../../src/theme";
import { Button } from "../../src/ui/Button";
import { ConfirmModal } from "../../src/ui/ConfirmModal";
import { Switch } from "../../src/ui/Switch";

export default function SettingsScreen() {
  const router = useRouter();
  const { authState, logout } = useAuth();
  const { colors, scale, xlText, setXlText, mode, setMode } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const email = authState.type === "authenticated" ? authState.user.email : "";

  const appearanceOptions: { label: string; value: ThemeMode }[] = [
    { label: "Light", value: "light" },
    { label: "Dark", value: "dark" },
    { label: "Match device", value: "auto" },
  ];

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Back to your notes"
          onPress={() => router.back()}
        >
          <ChevronLeft size={26} color={colors.foreground} />
        </Button>
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Reading comfort</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Extra large text</Text>
              <Text style={styles.settingHint}>Makes all text in the app bigger.</Text>
            </View>
            <Switch value={xlText} onValueChange={setXlText} accessibilityLabel="Extra large text" />
          </View>
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>Appearance</Text>
            <Text style={styles.settingHint}>Choose light, dark, or follow your device.</Text>
          </View>
          <View style={styles.choiceRow}>
            {appearanceOptions.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => setMode(option.value)}
                style={[styles.choice, mode === option.value && styles.choiceActive]}
              >
                <Text style={[styles.choiceText, mode === option.value && styles.choiceTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Privacy</Text>
          <Pressable style={styles.linkRow} onPress={() => router.push("/privacy")}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Privacy & personalization</Text>
              <Text style={styles.settingHint}>
                Control word suggestions, export or delete your data.
              </Text>
            </View>
            <ChevronRight size={22} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Account</Text>
          {email ? <Text style={styles.settingHint}>Signed in as {email}</Text> : null}
          <Button variant="secondary" size="lg" onPress={() => setConfirmLogout(true)}>
            Log out
          </Button>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>About</Text>
          <Text style={styles.settingHint}>
            Clarity Notes is a calm writing space with gentle word help. It is a writing aid, not a
            medical tool.
          </Text>
        </View>
      </ScrollView>

      <ConfirmModal
        open={confirmLogout}
        title="Log out?"
        description="Your notes stay safely saved to your account."
        confirmLabel="Log out"
        cancelLabel="Stay signed in"
        loading={loggingOut}
        onClose={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          try {
            await logout();
            router.replace("/login");
          } finally {
            setLoggingOut(false);
            setConfirmLogout(false);
          }
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[2] },
    title: { fontFamily: fonts.display, fontSize: 28 * scale, color: colors.foreground },
    content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[12] },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      gap: spacing[3],
    },
    cardTitle: { fontFamily: fonts.baseSemi, fontSize: 13 * scale, color: colors.mutedForeground },
    settingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
    settingText: { flex: 1, gap: 4 },
    settingLabel: { fontFamily: fonts.baseSemi, fontSize: 17 * scale, color: colors.foreground },
    settingHint: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    choiceRow: { flexDirection: "row", gap: spacing[2] },
    choice: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: spacing[2],
    },
    choiceActive: { backgroundColor: colors.accent, borderColor: colors.primary },
    choiceText: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground, textAlign: "center" },
    choiceTextActive: { color: colors.accentForeground, fontFamily: fonts.baseSemi },
    linkRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  });
}
