import {
  Fraunces_600SemiBold,
} from "@expo-google-fonts/fraunces";
import {
  NunitoSans_400Regular,
  NunitoSans_600SemiBold,
  NunitoSans_700Bold,
} from "@expo-google-fonts/nunito-sans";
import { ClerkProvider } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Redirect, Stack, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppThemeProvider, useAppTheme } from "../src/providers/AppThemeProvider";
import { AuthProvider, useAuth } from "../src/providers/AuthProvider";
import { ToastProvider } from "../src/providers/ToastProvider";
import { fonts } from "../src/theme";

export { ErrorBoundary } from "expo-router";

WebBrowser.maybeCompleteAuthSession();
SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());
  const [loaded, error] = useFonts({
    NunitoSans_400Regular,
    NunitoSans_600SemiBold,
    NunitoSans_700Bold,
    Fraunces_600SemiBold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) void SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  if (!publishableKey) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingTitle}>Missing Clerk key</Text>
        <Text style={styles.missingBody}>
          Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to mobile/.env, then restart Expo.
        </Text>
      </View>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AppThemeProvider>
            <AuthProvider>
              <ToastProvider>
                <RootNav />
              </ToastProvider>
            </AuthProvider>
          </AppThemeProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function RootNav() {
  const { authState } = useAuth();
  const { colors, dark, onboardingDone, ready } = useAppTheme();
  const segments = useSegments();

  if (!ready || authState.type === "loading") {
    return (
      <View style={[styles.boot, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const inAuthGroup = segments[0] === "(auth)";
  const inOnboarding = segments.includes("onboarding");

  if (authState.type === "unauthenticated" && !inAuthGroup) {
    return <Redirect href="/login" />;
  }
  if (authState.type === "authenticated" && inAuthGroup) {
    return <Redirect href={onboardingDone ? "/" : "/onboarding"} />;
  }
  if (authState.type === "authenticated" && !onboardingDone && !inOnboarding) {
    return <Redirect href="/onboarding" />;
  }
  if (authState.type === "authenticated" && onboardingDone && inOnboarding) {
    return <Redirect href="/" />;
  }

  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  boot: { flex: 1, alignItems: "center", justifyContent: "center" },
  missing: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#f6f2ea",
  },
  missingTitle: { fontFamily: fonts.display, fontSize: 24, marginBottom: 12 },
  missingBody: { fontFamily: fonts.base, fontSize: 16, textAlign: "center", color: "#655f55" },
});
