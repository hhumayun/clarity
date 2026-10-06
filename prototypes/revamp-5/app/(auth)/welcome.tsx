import { useAuth as useClerkAuth, useSSO } from "@clerk/clerk-expo";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TimeOfDay } from "../../src/art/TimeOfDay";
import { authMessage } from "../../src/auth/errors";
import { useAuth } from "../../src/core/providers/AuthProvider";
import { useDevice } from "../../src/state/device";
import { arriveSlow } from "../../src/theme/motion";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, face, space } from "../../src/theme/tokens";
import { Button, type ButtonState } from "../../src/ui/Button";
import { FieldError } from "../../src/ui/AuthPage";
import { GoogleMark } from "../../src/ui/GoogleMark";
import { tick } from "../../src/ui/haptics";
import { Txt } from "../../src/ui/Txt";

/**
 * The door, as Rosebud hangs its own: the name and one line of promise in
 * the middle, the ways in stacked at the foot. Today's picture for the hour
 * sits over the name. One "Continue with email" serves both new and
 * returning people; the next step works out which. "Look around first"
 * opens the sample notes, with no account.
 */
export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, phase } = useTheme();
  const setDemo = useDevice((state) => state.setDemo);
  const { startSSOFlow } = useSSO();
  const { isSignedIn, signOut } = useClerkAuth();
  const { authState } = useAuth();
  const [google, setGoogle] = useState<ButtonState>("idle");
  const [error, setError] = useState("");

  // Android opens the Google page faster when the browser is warmed first.
  useEffect(() => {
    if (process.env.EXPO_OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => void WebBrowser.coolDownAsync();
  }, []);

  // Signed in with Clerk, but the server turned the session down.
  const refused = isSignedIn && authState.type === "unauthenticated" ? authState.errorMessage : undefined;

  const withGoogle = async () => {
    setError("");
    setGoogle("busy");
    try {
      const { createdSessionId, setActive } = await startSSOFlow({ strategy: "oauth_google", redirectUrl: Linking.createURL("/") });
      if (createdSessionId && setActive) {
        setGoogle("done");
        await setActive({ session: createdSessionId });
        return;
      }
      setGoogle("idle");
    } catch (failure) {
      setGoogle("idle");
      setError(authMessage(failure, "Google sign-in didn't finish. Try again, or use your email."));
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.page, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space[3]) + space[2] }]}>
      <View style={styles.hero}>
        <Animated.View entering={arriveSlow}>
          <TimeOfDay phase={phase} size={168} />
        </Animated.View>
        <Txt accessibilityRole="header" style={[styles.name, { color: colors.ink }]}>
          clarity
        </Txt>
        <Txt variant="callout" tone="ink2" center style={styles.promise}>
          A calm place to write, and to see what to do next.
        </Txt>
      </View>
      <View style={styles.actions}>
        <FieldError message={refused ? `We couldn't open your account just now: ${refused}` : error} />
        {refused ? (
          <Button label="Sign out and start again" variant="secondary" onPress={() => void signOut()} />
        ) : (
          <>
            <Button label="Continue with Google" variant="secondary" mark={<GoogleMark />} state={google} onPress={() => void withGoogle()} />
            <Button label="Continue with email" onPress={() => router.push("/email")} />
          </>
        )}
        <Button
          label="Look around first"
          variant="plain"
          size="md"
          onPress={() => {
            tick();
            setDemo(true);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: edge },
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: space[3] },
  name: { fontFamily: face.heavy, fontSize: 36, lineHeight: 42, letterSpacing: -0.9, marginTop: space[2] },
  promise: { maxWidth: 280 },
  actions: { gap: space[3] },
});
