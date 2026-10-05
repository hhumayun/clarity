import { useRouter } from "expo-router";
import React, { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { useStore } from "../../src/store/store";
import { useTheme } from "../../src/theme/ThemeProvider";
import { edge, space } from "../../src/theme/tokens";
import { useAcknowledge } from "../../src/ui/Acknowledgement";
import { Icon } from "../../src/ui/Icon";
import { IconButton } from "../../src/ui/IconButton";
import { PressableScale } from "../../src/ui/PressableScale";
import { ChoiceChips, SheetButtons, SheetFrame, SheetList, SheetRow, TextField } from "../../src/ui/Sheet";
import { useType } from "../../src/ui/Txt";

/** Areas, managed: rename, remove (saying where their tasks go), add. */
export default function AreasSheet() {
  const router = useRouter();
  const { colors, accent } = useTheme();
  const acknowledge = useAcknowledge();
  const areas = useStore((state) => state.areas);
  const tasks = useStore((state) => state.tasks);
  const addArea = useStore((state) => state.addArea);
  const renameArea = useStore((state) => state.renameArea);
  const deleteArea = useStore((state) => state.deleteArea);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [fresh, setFresh] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  if (removing) {
    const hasTasks = tasks.some((task) => task.area === removing);
    const others = areas.filter((area) => area.name !== removing);
    const description = hasTasks && others.length
      ? "Its tasks need a new area."
      : hasTasks
        ? "Its tasks will be removed from Life Center. Your notes are not affected."
        : "This area will be removed.";
    return (
      <SheetFrame title={`Remove ${removing}?`} description={description}>
        {hasTasks && others.length ? (
          <ChoiceChips choices={others.map((area) => ({ label: area.name, value: area.name }))} selected={(name) => name === (moveTo ?? others[0].name)} onChoose={setMoveTo} />
        ) : null}
        <SheetButtons
          primary={{
            label: "Remove",
            icon: "trash",
            danger: true,
            onPress: () => {
              deleteArea(removing, hasTasks && others.length ? (moveTo ?? others[0].name) : null);
              acknowledge(`“${removing}” removed`, "trash");
              setRemoving(null);
              setMoveTo(null);
            },
          }}
          secondary={{ label: "Keep area", onPress: () => setRemoving(null) }}
        />
      </SheetFrame>
    );
  }

  const add = () => {
    if (!fresh.trim()) return;
    addArea(fresh);
    setFresh("");
  };

  return (
    <SheetFrame title="Areas" scroll action={{ label: "Done", onPress: () => router.back() }}>
      <SheetList>
        {areas.map((area) =>
          renaming === area.name ? (
            <EditRow key={area.name} name={area.name} onSave={(draft) => renameArea(area.name, draft) && setRenaming(null)} onCancel={() => setRenaming(null)} />
          ) : (
            <SheetRow
              key={area.name}
              label={area.name}
              trailing={
                <View style={styles.actions}>
                  <IconButton icon="pen" label={`Rename ${area.name}`} tone="ink3" size={20} onPress={() => setRenaming(area.name)} />
                  <IconButton icon="trash" label={`Remove ${area.name}`} tone="ink3" size={20} onPress={() => setRemoving(area.name)} />
                </View>
              }
            />
          ),
        )}
      </SheetList>
      <View style={styles.addRow}>
        <TextField style={styles.input} value={fresh} onChangeText={setFresh} placeholder="New area" returnKeyType="done" onSubmitEditing={add} accessibilityLabel="New area name" />
        <PressableScale
          onPress={add}
          disabled={!fresh.trim()}
          accessibilityRole="button"
          accessibilityLabel="Add area"
          scaleTo={0.9}
          style={[styles.addButton, { backgroundColor: accent.solid, opacity: fresh.trim() ? 1 : 0.35 }]}
        >
          <Icon name="plus" size={20} color={accent.on} weight="semibold" />
        </PressableScale>
      </View>
    </SheetFrame>
  );
}

function EditRow({ name, onSave, onCancel }: { name: string; onSave: (draft: string) => void; onCancel: () => void }) {
  const { colors, accent } = useTheme();
  const sized = useType("row");
  const [draft, setDraft] = useState(name);
  return (
    <View style={styles.edit}>
      <View style={styles.slot}>
      </View>
      <TextInput
        autoFocus
        value={draft}
        onChangeText={setDraft}
        returnKeyType="done"
        onSubmitEditing={() => onSave(draft)}
        selectionColor={accent.solid}
        cursorColor={accent.solid}
        accessibilityLabel={`Rename ${name}`}
        style={[sized, styles.editInput, { color: colors.ink }]}
      />
      <View style={styles.actions}>
        <IconButton icon="close" label="Cancel" tone="ink3" size={20} onPress={onCancel} />
        <IconButton icon="check" label="Save" tone="ink" size={20} onPress={() => onSave(draft)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", marginRight: -12 },
  addRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  input: { flex: 1 },
  addButton: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  edit: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: edge },
  slot: { width: 22, alignItems: "center", justifyContent: "center" },
  editInput: { flex: 1, paddingVertical: 0, outlineWidth: 0 },
});
