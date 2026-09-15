import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  ChevronUp,
  Feather,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react-native";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useDeleteNote, useNotes, useReindexNotes, useUpdateNote } from "../../../src/hooks/useNotes";
import { formatNoteDate } from "../../../src/lib/formatNoteDate";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { fonts, radius, spacing, type Colors } from "../../../src/theme";
import type { NoteRecord } from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { ConfirmModal } from "../../../src/ui/ConfirmModal";
import { Input } from "../../../src/ui/Input";
import { Segmented } from "../../../src/ui/Segmented";
import { Skeleton } from "../../../src/ui/Skeleton";

const BACKFILL_FLAG = "clarity:backfilled";

export default function NotesListScreen() {
  const router = useRouter();
  const { colors, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<NoteRecord | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const params = useMemo(
    () => ({
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(showArchived ? { archived: true } : {}),
    }),
    [debouncedSearch, showArchived],
  );

  const { data, isFetching, isError, refetch } = useNotes(params);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const reindex = useReindexNotes();
  const reindexRef = useRef(reindex.mutate);
  reindexRef.current = reindex.mutate;

  useEffect(() => {
    void (async () => {
      try {
        if ((await AsyncStorage.getItem(BACKFILL_FLAG)) === "true") return;
        await AsyncStorage.setItem(BACKFILL_FLAG, "true");
        reindexRef.current({});
      } catch {
        // Best effort.
      }
    })();
  }, []);

  const notes = data?.notes ?? [];
  const loading = isFetching && !data;

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Your notes</Text>
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
        >
          <Settings size={24} color={colors.foreground} />
        </Button>
      </View>

      <View style={styles.searchRow}>
        <Search size={18} color={colors.mutedForeground} />
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder="Search your notes"
          accessibilityLabel="Search your notes"
          style={styles.searchInput}
        />
        {search ? (
          <Pressable onPress={() => setSearch("")} accessibilityLabel="Clear search">
            <X size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      <Segmented
        accessibilityLabel="Which notes to show"
        value={showArchived ? "archived" : "current"}
        onChange={(value) => {
          setShowArchived(value === "archived");
          setExpandedId(null);
        }}
        options={[
          { label: "Current", value: "current" },
          { label: "Archived", value: "archived" },
        ]}
      />

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {loading
          ? [0, 1, 2].map((item) => <Skeleton key={item} style={styles.cardSkeleton} />)
          : notes.map((note) => {
              const expanded = expandedId === note.id;
              return (
                <View key={note.id} style={styles.card}>
                  <View style={styles.cardMain}>
                    <Pressable
                      style={styles.cardOpen}
                      onPress={() => router.push(`/note/${note.id}`)}
                      accessibilityLabel={`Open note: ${note.title || "Untitled note"}`}
                    >
                      <Text style={styles.cardTitle}>{note.title || "Untitled note"}</Text>
                      {note.content ? (
                        <Text style={styles.cardPreview} numberOfLines={2}>
                          {note.content.replace(/\s+/g, " ")}
                        </Text>
                      ) : null}
                      <Text style={styles.cardWhen}>{formatNoteDate(note.updatedAt)}</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setExpandedId(expanded ? null : note.id)}
                      accessibilityLabel={`More options for ${note.title || "this note"}`}
                      style={styles.cardMore}
                    >
                      {expanded ? (
                        <ChevronUp size={22} color={colors.mutedForeground} />
                      ) : (
                        <MoreHorizontal size={22} color={colors.mutedForeground} />
                      )}
                    </Pressable>
                  </View>
                  {expanded ? (
                    <View style={styles.cardActions}>
                      <Button
                        variant="secondary"
                        disabled={updateNote.isPending}
                        onPress={() => {
                          setExpandedId(null);
                          updateNote.mutate({ id: note.id, archived: !note.archived });
                        }}
                      >
                        {note.archived ? "Restore" : "Archive"}
                      </Button>
                      <Button variant="destructive" onPress={() => setPendingDelete(note)}>
                        Delete
                      </Button>
                    </View>
                  ) : null}
                </View>
              );
            })}

        {!loading && notes.length === 0 ? (
          <View style={styles.empty}>
            {isError ? (
              <>
                <Text style={styles.emptyText}>We couldn't load your notes right now.</Text>
                <Button variant="secondary" onPress={() => void refetch()}>
                  Try again
                </Button>
              </>
            ) : debouncedSearch ? (
              <Text style={styles.emptyText}>No notes match “{debouncedSearch}”.</Text>
            ) : showArchived ? (
              <Text style={styles.emptyText}>No archived notes.</Text>
            ) : (
              <>
                <Feather size={36} color={colors.mutedForeground} />
                <Text style={styles.emptyText}>
                  No notes yet. Tap “New note” below to start writing.
                </Text>
              </>
            )}
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Button size="lg" onPress={() => router.push("/note/new")}>
          <Plus size={20} color={colors.primaryForeground} />
          <Text style={styles.newNoteLabel}>New note</Text>
        </Button>
      </View>

      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete this note?"
        description="The note will be gone for good. This cannot be undone."
        confirmLabel="Delete"
        destructive
        loading={deleteNote.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          deleteNote.mutate(
            { id: pendingDelete.id },
            { onSettled: () => setPendingDelete(null) },
          );
          setExpandedId(null);
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing[4], gap: spacing[3] },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontFamily: fonts.display, fontSize: 32 * scale, color: colors.foreground },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
    },
    searchInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent", minHeight: 48 },
    list: { gap: spacing[3], paddingBottom: spacing[6] },
    cardSkeleton: { height: 110 },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
    },
    cardMain: { flexDirection: "row", gap: spacing[2] },
    cardOpen: { flex: 1, gap: 6 },
    cardTitle: { fontFamily: fonts.baseSemi, fontSize: 18 * scale, color: colors.foreground },
    cardPreview: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    cardWhen: { fontFamily: fonts.base, fontSize: 13 * scale, color: colors.mutedForeground },
    cardMore: { padding: spacing[1] },
    cardActions: { flexDirection: "row", gap: spacing[2], marginTop: spacing[3] },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[12] },
    emptyText: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    footer: { paddingBottom: spacing[3] },
    newNoteLabel: {
      fontFamily: fonts.baseSemi,
      fontSize: 16 * scale,
      color: colors.primaryForeground,
    },
  });
}
