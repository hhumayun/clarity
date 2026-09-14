import { Stack } from "expo-router";
import { useAppTheme } from "../../src/providers/AppThemeProvider";

export default function AppLayout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="note/[id]" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="privacy" />
      <Stack.Screen name="onboarding" />
    </Stack>
  );
}
