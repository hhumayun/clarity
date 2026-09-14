import { Stack } from "expo-router";
import { useAppTheme } from "../../src/providers/AppThemeProvider";

export default function AuthLayout() {
  const { colors } = useAppTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
