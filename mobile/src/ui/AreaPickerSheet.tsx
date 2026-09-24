import { Check, Plus } from "lucide-react-native";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { areaColor } from "../lib/lifeCenter";
import { sortProjects } from "../lib/taskSort";
import { useAppTheme } from "../providers/AppThemeProvider";
import { spacing, type Colors, type Fonts } from "../theme";
import type { ProjectRecord } from "../types";
import { Button } from "./Button";
import { Input } from "./Input";
import { Sheet } from "./Sheet";

type Props = {
  open: boolean;
  onClose: () => void;
  projects: ProjectRecord[];
  selected: string[];
  onToggle: (projectId: string) => void;
  /** Creates an area and tags the note with it. */
  onCreate: (name: string) => Promise<void>;
};

/**
 * Tag a note with areas. Several can be on; each tap toggles one and the
 * sheet stays open, so tagging three areas is three taps, not three trips.
 */
export function AreaPickerSheet({ open, onClose, projects, selected, onToggle, onCreate }: Props) {
  const { colors, fonts, scale, dark } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setAdding(false);
      setName("");
      setError("");
    }
  }, [open]);

  const create = async () => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return;
    setCreating(true);
    setError("");
    try {
      await onCreate(clean);
      setName("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That area could not be added.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet open={open} title="Areas" description="Tag this note so you can find it by area." onClose={onClose}>
      <View>
        {sortProjects(projects).map((project, i) => {
          const on = selected.includes(project.id);
          return (
            <Pressable
              key={project.id}
              onPress={() => onToggle(project.id)}
              style={[styles.row, i > 0 && styles.divider]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={project.name}
            >
              <View style={[styles.dot, { backgroundColor: areaColor(project.id, dark) }]} />
              <Text style={[styles.name, on && styles.nameOn]}>{project.name}</Text>
              <View style={[styles.box, on && styles.boxOn]}>
                {on ? <Check size={16} color={colors.primaryForeground} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {adding ? (
        <View style={styles.addRow}>
          <Input
            style={styles.flex}
            value={name}
            onChangeText={setName}
            placeholder="New area name"
            autoFocus
            maxLength={100}
            returnKeyType="done"
            onSubmitEditing={() => void create()}
          />
          <Button size="sm" loading={creating} disabled={!name.trim()} onPress={() => void create()}>
            Add
          </Button>
        </View>
      ) : (
        <Pressable onPress={() => setAdding(true)} style={styles.newRow} accessibilityRole="button">
          <Plus size={18} color={colors.primary} />
          <Text style={styles.newText}>New area</Text>
        </Pressable>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button size="lg" onPress={onClose}>
        Done
      </Button>
    </Sheet>
  );
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    flex: { flex: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3] },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    dot: { width: 10, height: 10, borderRadius: 5 },
    name: { flex: 1, fontFamily: fonts.base, fontSize: 17 * scale, color: colors.foreground },
    nameOn: { fontFamily: fonts.baseSemi },
    box: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    boxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    addRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    newRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[2] },
    newText: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.primary },
    error: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.error },
  });
}
