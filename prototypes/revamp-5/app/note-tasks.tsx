import { useLocalSearchParams } from "expo-router";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNote } from "../src/store/hooks";
import { useTheme } from "../src/theme/ThemeProvider";
import { space } from "../src/theme/tokens";
import { NoteTasks } from "../src/ui/NoteTasks";
import { Txt } from "../src/ui/Txt";

/** A note's tasks, in a sheet over the note: a short interruption you drag away to go back to writing. */
export default function NoteTasksSheet() {
  const { note: noteId } = useLocalSearchParams<{ note: string }>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const note = useNote(noteId);
  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[6] }]} showsVerticalScrollIndicator={false}>
      <Txt variant="title2" center accessibilityRole="header">
        Tasks
      </Txt>
      {note ? (
        <Txt variant="subhead" tone="ink3" center numberOfLines={1} style={styles.sub}>
          {note.title}
        </Txt>
      ) : null}
      {note ? <NoteTasks noteId={note.id} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: space[6] },
  sub: { marginTop: 2, paddingHorizontal: space[8] },
});
