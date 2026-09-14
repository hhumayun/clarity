import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { fonts, spacing } from "../src/theme";

export default function NotFoundScreen() {
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

const styles = StyleSheet.create({
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
    color: "#3e8e8c",
  },
});
