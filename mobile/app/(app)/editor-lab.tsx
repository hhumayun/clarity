import { isRunningInExpoGo } from "expo";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useRouter } from "expo-router";
import {
  Bold,
  ChevronLeft,
  FileText,
  Heading2,
  ImagePlus,
  Italic,
  KeyboardOff,
  Link,
  List,
  ListChecks,
  ListIndentDecrease,
  ListIndentIncrease,
  ListOrdered,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react-native";
import React, { useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { NativeLabHandle } from "../../src/editor-lab/NativeEditor";
import TiptapEditor, { type LabEditorState, type TiptapLabHandle } from "../../src/editor-lab/TiptapEditor";
import { flattenPages, useNotesPages } from "../../src/hooks/useNotes";
import { displayTitle } from "../../src/lib/notesList";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { useToast } from "../../src/providers/ToastProvider";
import { fonts, radius, spacing, textSize, type Colors } from "../../src/theme";
import { GentleKeyboardAvoidingView } from "../../src/ui/GentleKeyboardAvoidingView";
import { Segmented } from "../../src/ui/Segmented";
import { Sheet } from "../../src/ui/Sheet";

type Engine = "native" | "tiptap";

// The native editor is not in Expo Go; it is only loaded in the dev build,
// so Expo Go can still open the rest of the app (and this lab's Tiptap side).
const IN_EXPO_GO = isRunningInExpoGo();
const NativeEditor: typeof import("../../src/editor-lab/NativeEditor").NativeEditor | null = IN_EXPO_GO
  ? null
  : require("../../src/editor-lab/NativeEditor").NativeEditor;

const SAMPLE = [
  "Try the editors here",
  "Write a few lines, make a list and indent it, tick a checkbox, add a link or a photo.",
  "Nothing in this lab is saved.",
];

const NO_STATE: LabEditorState = {
  bold: false,
  italic: false,
  strike: false,
  heading: false,
  bullet: false,
  ordered: false,
  task: false,
  link: false,
};

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A note's lines, each its own paragraph, for both editors. */
function startingPoint(lines: string[]): { html: string; markdown: string } {
  const kept = lines.map((line) => line.trimEnd()).filter((line) => line.trim().length > 0);
  return {
    html: `<html>${kept.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</html>`,
    markdown: kept.join("\n\n"),
  };
}

/**
 * The editor lab (developer only): the two rich text candidates side by side
 * on the same note, with one toolbar, to feel which writes better. The
 * output panel shows what each would store. Nothing is saved.
 */
export default function EditorLabScreen() {
  const router = useRouter();
  const toast = useToast();
  const { colors, scale } = useAppTheme();
  const { width: screenWidth } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(colors, scale), [colors, scale]);
  const palette = useMemo(
    () => ({
      text: colors.foreground,
      muted: colors.mutedForeground,
      accent: colors.primary,
      border: colors.border,
      surface: colors.muted,
    }),
    [colors],
  );
  const fontSize = Math.round(textSize.body * scale);

  const [engine, setEngine] = useState<Engine>(IN_EXPO_GO ? "tiptap" : "native");
  const [doc, setDoc] = useState(() => ({ key: "sample", ...startingPoint(SAMPLE) }));
  const [output, setOutput] = useState<Record<Engine, string>>({ native: "", tiptap: "" });
  const [showOutput, setShowOutput] = useState(false);
  const [state, setState] = useState<LabEditorState>(NO_STATE);
  const [pickerOpen, setPickerOpen] = useState(false);

  const nativeRef = useRef<NativeLabHandle>(null);
  const tiptapRef = useRef<TiptapLabHandle>(null);

  const pages = useNotesPages({});
  const notes = useMemo(() => flattenPages(pages.data).slice(0, 40), [pages.data]);

  const run = (name: string, value?: string, size?: { width: number; height: number }) => {
    if (engine === "tiptap") {
      tiptapRef.current?.run(name, value ?? "");
      return;
    }
    if (nativeRef.current && !nativeRef.current.run(name, value, size)) {
      toast.show("The native editor can't do that.");
    }
  };

  const addLink = () => {
    Alert.prompt(
      "Link",
      "Paste or type a web address. Leave it empty to remove a link.",
      (url) => run("link", url.trim()),
      "plain-text",
      "https://",
      "url",
    );
  };

  const addPhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    // Shrunk as the real thing would be, before it goes anywhere.
    const target = Math.min(1600, asset.width);
    const image = await ImageManipulator.manipulate(asset.uri).resize({ width: target }).renderAsync();
    const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: engine === "tiptap" });
    if (engine === "tiptap") {
      if (saved.base64) run("image", `data:image/jpeg;base64,${saved.base64}`);
      return;
    }
    const width = screenWidth - spacing[4] * 2;
    run("image", saved.uri, { width, height: Math.round((width * saved.height) / saved.width) });
  };

  const tools: { key: string; Icon: typeof Bold; label: string; active?: boolean; onPress: () => void }[] = [
    { key: "bold", Icon: Bold, label: "Bold", active: state.bold, onPress: () => run("bold") },
    { key: "italic", Icon: Italic, label: "Italic", active: state.italic, onPress: () => run("italic") },
    { key: "strike", Icon: Strikethrough, label: "Strikethrough", active: state.strike, onPress: () => run("strike") },
    { key: "heading", Icon: Heading2, label: "Heading", active: state.heading, onPress: () => run("heading") },
    { key: "bullet", Icon: List, label: "Bullet list", active: state.bullet, onPress: () => run("bullet") },
    { key: "ordered", Icon: ListOrdered, label: "Numbered list", active: state.ordered, onPress: () => run("ordered") },
    { key: "task", Icon: ListChecks, label: "Checklist", active: state.task, onPress: () => run("task") },
    { key: "indent", Icon: ListIndentIncrease, label: "Indent", onPress: () => run("indent") },
    { key: "outdent", Icon: ListIndentDecrease, label: "Outdent", onPress: () => run("outdent") },
    { key: "link", Icon: Link, label: "Link", active: state.link, onPress: addLink },
    { key: "photo", Icon: ImagePlus, label: "Photo", onPress: () => void addPhoto() },
    { key: "undo", Icon: Undo2, label: "Undo", onPress: () => run("undo") },
    { key: "redo", Icon: Redo2, label: "Redo", onPress: () => run("redo") },
    { key: "done", Icon: KeyboardOff, label: "Hide keyboard", onPress: () => run("blur") },
  ];
  const unsupported = engine === "native" ? new Set(["indent", "outdent", "undo", "redo"]) : new Set<string>();

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Back">
          <ChevronLeft size={24} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, styles.flex]}>Editor lab</Text>
        <Pressable
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <FileText size={18} color={colors.primary} />
          <Text style={styles.headerButtonText}>Load a note</Text>
        </Pressable>
      </View>

      <View style={styles.controls}>
        <View style={styles.flex}>
          <Segmented
            size="sm"
            accessibilityLabel="Which editor"
            value={engine}
            onChange={(next) => {
              setEngine(next);
              setState(NO_STATE);
            }}
            options={[
              { label: "Native", value: "native" },
              { label: "Tiptap", value: "tiptap" },
            ]}
          />
        </View>
        <Pressable
          onPress={() => setShowOutput((open) => !open)}
          style={[styles.outputToggle, showOutput && styles.outputToggleOn]}
          accessibilityRole="button"
          accessibilityState={{ expanded: showOutput }}
        >
          <Text style={styles.outputToggleText}>{engine === "native" ? "HTML" : "Markdown"}</Text>
        </Pressable>
      </View>

      <GentleKeyboardAvoidingView style={styles.flex}>
        <View style={styles.flex}>
          {engine === "native" ? (
            NativeEditor ? (
              <NativeEditor
                key={`native-${doc.key}`}
                ref={nativeRef}
                html={doc.html}
                palette={palette}
                fontSize={fontSize}
                onHtml={(html) => setOutput((current) => ({ ...current, native: html }))}
                onState={setState}
              />
            ) : (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>
                  The native editor needs the Clarity Dev app. Expo Go can only show the Tiptap one.
                </Text>
              </View>
            )
          ) : (
            <TiptapEditor
              key={`tiptap-${doc.key}`}
              ref={tiptapRef}
              markdown={doc.markdown}
              palette={palette}
              fontSize={fontSize}
              onMarkdown={async (markdown) => setOutput((current) => ({ ...current, tiptap: markdown }))}
              onState={async (next) => setState(next)}
              dom={{
                style: styles.flex,
                useExpoDOMWebView: false,
                hideKeyboardAccessoryView: true,
                keyboardDisplayRequiresUserAction: false,
              }}
            />
          )}
        </View>

        {showOutput ? (
          <ScrollView style={styles.output} contentContainerStyle={styles.outputBody}>
            <Text style={styles.outputText} selectable>
              {output[engine] || "(nothing yet)"}
            </Text>
          </ScrollView>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={styles.toolbar}
          contentContainerStyle={styles.toolbarBody}
        >
          {tools.map(({ key, Icon, label, active, onPress }) => {
            const off = unsupported.has(key);
            return (
              <Pressable
                key={key}
                onPress={onPress}
                style={({ pressed }) => [styles.tool, active && styles.toolActive, off && styles.toolOff, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={off ? `${label} (not in this editor)` : label}
                accessibilityState={{ selected: Boolean(active) }}
              >
                <Icon size={20} color={active ? colors.primaryForeground : colors.foreground} />
              </Pressable>
            );
          })}
        </ScrollView>
      </GentleKeyboardAvoidingView>

      <Sheet open={pickerOpen} title="Load a note" onClose={() => setPickerOpen(false)}>
        <FlatList
          data={notes}
          keyExtractor={(note) => note.id}
          style={styles.pickerList}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setPickerOpen(false);
                const lines = [item.title, ...item.content.split("\n")].filter((line, index) => index > 0 || line.trim());
                setDoc({ key: `${item.id}-${Date.now()}`, ...startingPoint(lines) });
                setState(NO_STATE);
              }}
              style={({ pressed }) => [styles.pickerRow, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.pickerTitle} numberOfLines={1}>
                {displayTitle(item).title}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.noticeText}>No notes loaded yet.</Text>}
        />
      </Sheet>
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    flex: { flex: 1 },
    pressed: { opacity: 0.7 },
    header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[2] },
    iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    title: { fontFamily: fonts.display, fontSize: textSize.title * scale, color: colors.foreground },
    headerButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    headerButtonText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.primary },
    controls: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing[2],
      paddingHorizontal: spacing[4],
      paddingBottom: spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    outputToggle: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: 7,
    },
    outputToggleOn: { borderColor: colors.primary, backgroundColor: colors.accent },
    outputToggleText: { fontFamily: fonts.baseSemi, fontSize: textSize.small * scale, color: colors.foreground },
    notice: { flex: 1, padding: spacing[6], justifyContent: "center" },
    noticeText: {
      fontFamily: fonts.base,
      fontSize: textSize.body * scale,
      lineHeight: 24 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
    output: {
      maxHeight: 220,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.card,
    },
    outputBody: { padding: spacing[3] },
    outputText: { fontFamily: "Menlo", fontSize: 12, lineHeight: 17, color: colors.foreground },
    toolbar: {
      flexGrow: 0,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    toolbarBody: { gap: 4, paddingHorizontal: spacing[2], paddingVertical: 6 },
    tool: { width: 42, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    toolActive: { backgroundColor: colors.primary },
    toolOff: { opacity: 0.3 },
    pickerList: { maxHeight: 420 },
    pickerRow: {
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    pickerTitle: { fontFamily: fonts.base, fontSize: textSize.body * scale, color: colors.foreground },
  });
}
