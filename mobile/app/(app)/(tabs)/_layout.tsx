import { Tabs } from "expo-router";
import { Feather, LayoutDashboard } from "lucide-react-native";
import { TASKS_ENABLED } from "../../../src/featureFlags";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts } from "../../../src/theme";

export default function TabsLayout() {
  const { colors, scale } = useAppTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        // With Life Center hidden, Notes is the only destination — a one-tab
        // bar is just wasted space.
        tabBarStyle: TASKS_ENABLED
          ? {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
            }
          : { display: "none" },
        tabBarLabelStyle: {
          fontFamily: fonts.baseSemi,
          fontSize: 12 * scale,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Notes",
          tabBarIcon: ({ color, size }) => <Feather color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="life-center"
        options={{
          href: TASKS_ENABLED ? undefined : null,
          title: "Life Center",
          tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
