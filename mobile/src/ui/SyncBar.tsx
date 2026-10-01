import { CloudOff, RefreshCw } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../providers/AppThemeProvider";
import { useOnline } from "../sync/network";
import { usePendingCount } from "../sync/SyncProvider";
import { fonts, spacing, textSize, type Colors } from "../theme";
import { Collapse } from "./Collapse";

// Online, changes usually land within a second: only say "syncing" if they
// are still waiting after this long.
const SYNC_NOTICE_MS = 3_000;

/**
 * A slim line under a screen's header: offline, what is waiting to be sent;
 * online, a quiet "syncing" if sending is taking a while. Nothing otherwise.
 */
export function SyncBar() {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const online = useOnline();
  const pending = usePendingCount();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!online || pending === 0) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SYNC_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [online, pending]);

  const changes = `${pending} ${pending === 1 ? "change" : "changes"}`;
  const text = !online
    ? pending > 0
      ? `Offline · ${changes} will sync when you're back online`
      : "Offline · what you change is kept on this phone"
    : `Syncing ${changes}…`;

  return (
    <Collapse open={!online || slow}>
      <View style={styles.bar} accessibilityLiveRegion="polite">
        {online ? (
          <RefreshCw size={14} color={colors.mutedForeground} />
        ) : (
          <CloudOff size={14} color={colors.mutedForeground} />
        )}
        <Text style={styles.text} numberOfLines={1}>
          {text}
        </Text>
      </View>
    </Collapse>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    text: { flex: 1, fontFamily: fonts.base, fontSize: textSize.small * scale, color: colors.mutedForeground },
  });
}
