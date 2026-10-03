import { Check, ChevronDown } from "lucide-react-native";
import React, { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { areaTag } from "../lib/lifeCenter";
import { useAppTheme } from "../providers/AppThemeProvider";
import { fonts, radius, spacing, textSize, type Colors } from "../theme";
import type { ProjectRecord } from "../types";
import { Collapse } from "./Collapse";

/**
 * A list's area filter, as Life Center and the Notes list show it: a pill
 * naming the area shown ("All areas" or "#Name") that folds open the menu of
 * areas beneath it. The two are placed apart, the pill in a row of controls
 * and the menu under that row.
 */
export function AreaPill({
  area,
  open,
  onPress,
}: {
  /** The area shown, or null for all of them. */
  area: ProjectRecord | null;
  /** Whether the menu is open. */
  open: boolean;
  onPress: () => void;
}) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, open && styles.pillOpen]}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`Area: ${area?.name ?? "All areas"}. Change area`}
    >
      <Text style={styles.pillText} numberOfLines={1}>
        {area ? areaTag(area.name) : "All areas"}
      </Text>
      <ChevronDown size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export function AreaMenu({
  open,
  projects,
  selected,
  onPick,
  onManage,
}: {
  open: boolean;
  projects: ProjectRecord[];
  /** The area shown, or null for all of them. */
  selected: string | null;
  onPick: (id: string | null) => void;
  /** Ends the menu with "Manage areas…". */
  onManage?: () => void;
}) {
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  return (
    <Collapse open={open}>
      <View style={styles.menuSpace}>
        <View style={styles.menu}>
          {[null, ...projects].map((area) => {
            const id = area?.id ?? null;
            const active = id === selected;
            return (
              <Pressable
                key={id ?? "all"}
                style={styles.item}
                onPress={() => onPick(id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.itemText, active && styles.itemActive]}>
                  {area ? areaTag(area.name) : "All areas"}
                </Text>
                {active ? <Check size={16} color={colors.primary} /> : null}
              </Pressable>
            );
          })}
          {onManage ? (
            <Pressable style={[styles.item, styles.manage]} onPress={onManage} accessibilityRole="button">
              <Text style={styles.manageText}>Manage areas…</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Collapse>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[1],
      maxWidth: 170,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    pillOpen: { borderColor: colors.primary },
    pillText: { flexShrink: 1, fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.foreground },
    menuSpace: { paddingTop: spacing[3] },
    menu: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      overflow: "hidden",
    },
    item: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    itemText: { flex: 1, fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
    itemActive: { fontFamily: fonts.baseSemi },
    manage: { borderTopWidth: 1, borderTopColor: colors.border },
    manageText: { fontFamily: fonts.baseSemi, fontSize: textSize.body * scale, color: colors.primary },
  });
}
