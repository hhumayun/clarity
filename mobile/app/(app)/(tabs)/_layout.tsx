import { Tabs } from "expo-router";
import { Feather, LayoutDashboard } from "lucide-react-native";
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
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
        },
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
          title: "Life Center",
          tabBarIcon: ({ color, size }) => <LayoutDashboard color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
