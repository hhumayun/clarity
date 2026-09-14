import { useRouter } from "expo-router";
import { Lock, MessageCircle, PenLine } from "lucide-react-native";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../../src/theme";
import { Button } from "../../src/ui/Button";

const STEPS = [
  {
    Icon: PenLine,
    title: "Write freely",
    body: "Your notes save by themselves as you type. Nothing to remember, nothing to lose.",
  },
  {
    Icon: MessageCircle,
    title: "Gentle word help",
    body: "When a word is hard to find, look just below what you are writing. Tap a bubble to add it — or simply ignore them.",
  },
  {
    Icon: Lock,
    title: "Private by default",
    body: "Your notes belong to you. The app learns the phrases you like to offer better help — you can turn this off or clear it any time in Settings.",
  },
] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const { colors, scale, completeOnboarding } = useAppTheme();
  const styles = makeStyles(colors, scale);
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const { Icon } = current;

  const finish = () => {
    completeOnboarding();
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.stage}>
        <View style={styles.iconRing}>
          <Icon size={36} color={colors.primary} />
        </View>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.body}>{current.body}</Text>
      </View>
      <View style={styles.dots}>
        {STEPS.map((item, index) => (
          <View key={item.title} style={[styles.dot, index === step && styles.dotActive]} />
        ))}
      </View>
      <View style={styles.actions}>
        <Button size="lg" onPress={() => (isLast ? finish() : setStep(step + 1))}>
          {isLast ? "Start writing" : "Next"}
        </Button>
        {!isLast ? (
          <Button variant="ghost" size="lg" onPress={finish}>
            Skip
          </Button>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: colors.background,
      padding: spacing[6],
      justifyContent: "space-between",
    },
    stage: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing[4] },
    iconRing: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 32 * scale,
      color: colors.foreground,
      textAlign: "center",
    },
    body: {
      fontFamily: fonts.base,
      fontSize: 18 * scale,
      lineHeight: 28 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    dots: { flexDirection: "row", justifyContent: "center", gap: spacing[2] },
    dot: {
      width: 8,
      height: 8,
      borderRadius: radius.full,
      backgroundColor: colors.border,
    },
    dotActive: { backgroundColor: colors.primary, width: 22 },
    actions: { gap: spacing[2] },
  });
}
