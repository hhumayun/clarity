import { useSignIn } from "@clerk/clerk-expo";
import { Link } from "expo-router";
import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { spacing, type Colors, type Fonts } from "../../src/theme";
import { Button } from "../../src/ui/Button";
import { GoogleSignInButton } from "../../src/ui/GoogleSignInButton";
import { Input } from "../../src/ui/Input";

export default function LoginScreen() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const { colors, fonts, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isLoaded) return;
    setBusy(true);
    setError("");
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Please finish signing in from the email we sent you.");
      }
    } catch (err) {
      setError(clerkMessage(err) || "Couldn't sign in. Check your email and password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.wordmark}>Clarity Notes</Text>
          <Text style={styles.tagline}>
            A calm place to write, with gentle help finding words.
          </Text>
          <GoogleSignInButton onError={setError} />
          <Input
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
          />
          <Input
            secureTextEntry
            autoComplete="password"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button size="lg" loading={busy} onPress={() => void submit()}>
            Sign in
          </Button>
          <Text style={styles.switch}>
            New here? <Link href="/register" style={styles.link}>Create an account</Link>
          </Text>
          <Text style={styles.disclaimer}>Clarity Notes is a writing aid, not a medical tool.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function clerkMessage(error: unknown): string {
  const first = (error as { errors?: { message?: string }[] } | null)?.errors?.[0]?.message;
  return first ?? (error instanceof Error ? error.message : "");
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1, justifyContent: "center", padding: spacing[6] },
    card: { gap: spacing[4] },
    wordmark: {
      fontFamily: fonts.display,
      fontSize: 32 * scale,
      color: colors.foreground,
    },
    tagline: {
      fontFamily: fonts.base,
      fontSize: 17 * scale,
      lineHeight: 26 * scale,
      color: colors.mutedForeground,
    },
    error: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.error },
    switch: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    link: { color: colors.primary, fontFamily: fonts.baseSemi },
    disclaimer: {
      fontFamily: fonts.base,
      fontSize: 13 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
  });
}
