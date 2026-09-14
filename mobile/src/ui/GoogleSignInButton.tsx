import { useSSO } from "@clerk/clerk-expo";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, spacing, type Colors } from "../theme";
import { Button } from "./Button";

export function GoogleSignInButton({
  onError,
}: {
  onError: (message: string) => void;
}) {
  const { startSSOFlow } = useSSO();
  const { colors, scale } = useAppTheme();
  const styles = makeStyles(colors, scale);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const onPress = async () => {
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl: Linking.createURL("/"),
      });
      if (createdSessionId) {
        await setActive?.({ session: createdSessionId });
        return;
      }
      onError("Google sign-in didn't finish. Please try again.");
    } catch (error) {
      const first = (error as { errors?: { message?: string }[] } | null)?.errors?.[0]
        ?.message;
      onError(first || "Couldn't sign in with Google. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="lg" loading={busy} onPress={() => void onPress()}>
        Continue with Google
      </Button>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.or}>or</Text>
        <View style={styles.line} />
      </View>
    </>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[3],
    },
    line: { flex: 1, height: 1, backgroundColor: colors.border },
    or: {
      fontFamily: fonts.base,
      fontSize: 14 * scale,
      color: colors.mutedForeground,
    },
  });
}
