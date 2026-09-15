import { useSignUp } from "@clerk/clerk-expo";
import { Link } from "expo-router";
import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { fonts, spacing, type Colors } from "../../src/theme";
import { Button } from "../../src/ui/Button";
import { GoogleSignInButton } from "../../src/ui/GoogleSignInButton";
import { Input } from "../../src/ui/Input";

export default function RegisterScreen() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!isLoaded) return;
    setBusy(true);
    setError("");
    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err) {
      setError(clerkMessage(err) || "Couldn't create the account. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!isLoaded) return;
    setBusy(true);
    setError("");
    try {
      const result = await signUp.attemptEmailAddressVerification({ code: code.trim() });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("Please enter the code from your email.");
      }
    } catch (err) {
      setError(clerkMessage(err) || "That code did not work. Please try again.");
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
            Your notes stay yours. Nothing is shared with anyone else.
          </Text>
          {pendingVerification ? (
            <>
              <Text style={styles.tagline}>Enter the code we emailed to {email}.</Text>
              <Input
                keyboardType="number-pad"
                placeholder="Verification code"
                value={code}
                onChangeText={setCode}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button size="lg" loading={busy} onPress={() => void verify()}>
                Verify email
              </Button>
            </>
          ) : (
            <>
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
                autoComplete="new-password"
                placeholder="Password"
                value={password}
                onChangeText={setPassword}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button size="lg" loading={busy} onPress={() => void submit()}>
                Create account
              </Button>
            </>
          )}
          <Text style={styles.switch}>
            Already have an account? <Link href="/login" style={styles.link}>Sign in</Link>
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

function makeStyles(colors: Colors, scale: number) {
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
