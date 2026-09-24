import { Link, Stack } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../src/providers/AppThemeProvider";
import { spacing, type Colors, type Fonts } from "../src/theme";

export default function NotFoundScreen() {
  const { colors, fonts } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, fonts), [colors, fonts]);
  return (
    <>
      <Stack.Screen options={{ title: "Not found" }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen does not exist.</Text>
        <Link href="/" style={styles.link}>
          Go to your notes
        </Link>
      </View>
    </>
  );
}

function makeStyles(colors: Colors, fonts: Fonts) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing[6],
    },
    title: {
      fontFamily: fonts.display,
      fontSize: 22,
    },
    link: {
      marginTop: spacing[4],
      fontFamily: fonts.baseSemi,
      fontSize: 16,
      color: colors.primary,
    },
  });
}
