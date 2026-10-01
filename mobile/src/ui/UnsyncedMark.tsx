import { CloudOff } from "lucide-react-native";
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { useOnline } from "../sync/network";
import { useIsPending } from "../sync/SyncProvider";
import { fonts, textSize, type Colors } from "../theme";

/**
 * "Not synced yet", on a note or task whose changes are waiting on the phone
 * for a connection. Online they are on their way, so nothing is shown.
 */
export function UnsyncedMark({ subject }: { subject: string }) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const pending = useIsPending(subject);
  const online = useOnline();
  if (!pending || online) return null;
  return (
    <View style={styles.mark} accessibilityLabel="Not synced yet">
      <CloudOff size={12} color={colors.mutedForeground} />
      <Text style={styles.text}>Not synced yet</Text>
    </View>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    mark: { flexDirection: "row", alignItems: "center", gap: 4 },
    text: { fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
  });
}
