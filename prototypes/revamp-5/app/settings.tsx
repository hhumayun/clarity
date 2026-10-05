import { useUser } from "@clerk/clerk-expo";
import { cacheDirectory, writeAsStringAsync } from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAccountExport, postAccountDelete } from "../src/core/api/account";
import { useClearPersonalization, usePreferences, useUpdatePreferences } from "../src/core/hooks/usePreferences";
import { useAuth } from "../src/core/providers/AuthProvider";
import { usePendingCount } from "../src/core/sync/SyncProvider";
import { useDevice } from "../src/state/device";
import type { FocusLength } from "../src/store/model";
import { useStore } from "../src/store/store";
import { useTheme } from "../src/theme/ThemeProvider";
import { edge, pad, space, type Phase } from "../src/theme/tokens";
import { useAcknowledge } from "../src/ui/Acknowledgement";
import { AskInPlace } from "../src/ui/AskInPlace";
import { Button, Spinner } from "../src/ui/Button";
import { CardGroup, CardRow } from "../src/ui/Card";
import { AccentSwatches, PaperTiles } from "../src/ui/ColourPicker";
import { done as doneHaptic } from "../src/ui/haptics";
import { Icon, type IconName } from "../src/ui/Icon";
import { Segmented } from "../src/ui/Segmented";
import { Toggle } from "../src/ui/Toggle";
import { Txt } from "../src/ui/Txt";

/**
 * Settings, as Rosebud keeps them: a sheet with Done at the top right and
 * small grey captions over white groups. Your account first: who you are,
 * your notes to take away, what the app may learn, and the two doors out,
 * each asking in place. Looking around without an account, a card says so
 * and leads to signing in. Then your colour, the page, reading comfort, the
 * focus defaults, and the controls only this prototype has.
 */
export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, mode, setMode, phaseOverride, setPhaseOverride } = useTheme();
  const acknowledge = useAcknowledge();
  const { authState } = useAuth();
  const prefs = useDevice((state) => state.prefs);
  const setPref = useDevice((state) => state.setPref);
  const reset = useStore((state) => state.reset);

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      {/* On the iPhone the sheet itself clears the clock; elsewhere the page does. */}
      <View style={[styles.bar, { paddingTop: process.env.EXPO_OS === "ios" ? space[4] : Math.max(insets.top, space[3]) + space[1] }]}>
        <View style={styles.side} />
        <Txt variant="headline" accessibilityRole="header" style={styles.barTitle}>
          Settings
        </Txt>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Done" hitSlop={10} style={[styles.side, styles.right]}>
          {({ pressed }) => (
            <Txt variant="headline" style={{ opacity: pressed ? 0.5 : 1 }}>
              Done
            </Txt>
          )}
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + space[12] }}>
        <Caption first>Account</Caption>
        {authState.type === "authenticated" ? <Account email={authState.user.email} /> : <LookingAround />}

        <Caption>Your colour</Caption>
        <AccentSwatches value={prefs.accent} onChange={(name) => setPref("accent", name)} />
        <Txt variant="footnote" tone="ink3" center style={styles.note}>
          Pick a colour, any colour. Buttons, checks and focus time take it.
        </Txt>

        <Caption>Paper</Caption>
        <PaperTiles value={prefs.paper} onChange={(name) => setPref("paper", name)} />
        <Txt variant="footnote" tone="ink3" center style={styles.note}>
          How warm the page is in light mode, from cool stone to rosy clay.
        </Txt>

        <Caption>Appearance</Caption>
        <View style={styles.inset}>
          <Segmented
            options={[
              { label: "Auto", value: "auto" },
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
            ]}
            value={mode}
            onChange={setMode}
            accessibilityLabel="Appearance"
          />
        </View>
        <CardGroup style={styles.group}>
          <ToggleRow icon="format" label="Larger text" value={prefs.largeText} onChange={(value) => setPref("largeText", value)} />
        </CardGroup>

        <Caption>Focus</Caption>
        <View style={styles.inset}>
          <Segmented
            options={([10, 15, 25] as FocusLength[]).map((minutes) => ({ label: `${minutes} min`, value: minutes }))}
            value={prefs.focusLength}
            onChange={(minutes) => setPref("focusLength", minutes)}
            accessibilityLabel="Starting length"
          />
        </View>
        <CardGroup style={styles.group}>
          <ToggleRow icon="coffee" label="Take a break after" value={prefs.breakAfter} onChange={(value) => setPref("breakAfter", value)} />
        </CardGroup>

        <Caption>Prototype</Caption>
        <View style={styles.inset}>
          <Segmented
            options={[
              { label: "Follow the clock", value: "clock", icon: "clock" as const, iconOnly: true },
              ...(["dawn", "day", "dusk", "night"] as Phase[]).map((phase) => ({
                label: { dawn: "Morning", day: "Afternoon", dusk: "Evening", night: "Night" }[phase],
                value: phase as string,
                icon: ({ dawn: "sunrise", day: "today", dusk: "sunset", night: "moon" } as const)[phase],
                iconOnly: true,
              })),
            ]}
            value={phaseOverride ?? "clock"}
            onChange={(value) => setPhaseOverride(value === "clock" ? null : (value as Phase))}
            accessibilityLabel="Time of day"
          />
        </View>
        <Txt variant="footnote" tone="ink3" center style={styles.note}>
          See Today's greeting, question and picture at another hour.
        </Txt>
        <CardGroup style={styles.group}>
          <ToggleRow icon="hourglass" label="Faster timers" detail="A minute passes in two seconds." value={prefs.fastTimers} onChange={(value) => setPref("fastTimers", value)} />
          <CardRow onPress={() => router.push("/pictures")} accessibilityRole="button" accessibilityLabel="See the pictures" style={styles.row}>
            <Icon name="image" size={20} color={colors.ink2} weight="medium" />
            <Txt variant="row" style={styles.words}>
              See the pictures
            </Txt>
            <Icon name="forward" size={14} color={colors.ink3} weight="semibold" />
          </CardRow>
        </CardGroup>
        <View style={styles.actions}>
          <AskInPlace
            label="Reset sample data"
            icon="undo"
            steps={[{ question: "Bring back the sample notes and tasks? Your changes to them are cleared.", confirm: "Reset", icon: "undo" }]}
            danger
            onConfirm={() => {
              doneHaptic();
              reset();
              acknowledge("Sample data is back", "undo");
            }}
          />
        </View>

        <Txt variant="footnote" tone="ink3" center style={styles.about}>
          Clarity is a calm place to write, plan and focus. This is revamp 5, “Sage”. Accounts are real; the notes and tasks are samples until your own arrive in a later step.
        </Txt>
      </ScrollView>
    </View>
  );
}

/** Signed in: who you are, your notes to take away, what the app may learn, and the doors out. */
function Account({ email }: { email: string }) {
  const { colors } = useTheme();
  const { user } = useUser();
  const { logout } = useAuth();
  const acknowledge = useAcknowledge();
  const setOnboarded = useDevice((state) => state.setOnboarded);
  const pending = usePendingCount();
  const preferences = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const forget = useClearPersonalization();
  const [exporting, setExporting] = useState(false);
  const shown = email || user?.primaryEmailAddress?.emailAddress || "Your account";

  const exportNotes = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const text = JSON.stringify(await getAccountExport(), null, 2);
      const name = "clarity-notes-export.json";
      if (process.env.EXPO_OS === "web") {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        link.download = name;
        link.click();
        URL.revokeObjectURL(link.href);
      } else {
        const path = `${cacheDirectory}${name}`;
        await writeAsStringAsync(path, text);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/json", UTI: "public.json", dialogTitle: "Export my notes" });
        else acknowledge("Sharing isn't available here", "close");
      }
    } catch {
      acknowledge("Couldn't export just now", "close");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <CardGroup>
        <View style={styles.row}>
          <Icon name="person" size={20} color={colors.ink2} weight="medium" />
          <Txt variant="row" numberOfLines={1} style={styles.words}>
            {shown}
          </Txt>
        </View>
        <CardRow onPress={() => void exportNotes()} accessibilityRole="button" accessibilityLabel="Export my notes" style={styles.row}>
          <Icon name="share" size={20} color={colors.ink2} weight="medium" />
          <Txt variant="row" style={styles.words}>
            Export my notes
          </Txt>
          {exporting ? <Spinner color={colors.ink3} size={18} /> : null}
        </CardRow>
        <ToggleRow
          icon="sparkles"
          label="Learn from my writing"
          detail="Better word help, from phrases you've liked."
          value={preferences.data?.usePersonalization ?? true}
          onChange={(value) => updatePreferences.mutate({ usePersonalization: value })}
        />
      </CardGroup>
      <View style={styles.actions}>
        <AskInPlace
          label="Forget what it has learned"
          icon="undo"
          steps={[{ question: "Forget the phrases the app has learned? Your notes stay as they are.", confirm: "Forget" }]}
          onConfirm={async () => {
            await forget.mutateAsync();
            acknowledge("Forgotten", "undo");
          }}
        />
        <AskInPlace
          label="Sign out"
          icon="signOut"
          cancel="Stay"
          steps={[
            {
              question: pending > 0 ? "Some changes haven't reached the server yet. Signing out now loses them." : `Sign out of ${shown}? Your notes stay in your account.`,
              confirm: "Sign out",
              icon: "signOut",
            },
          ]}
          danger={pending > 0}
          onConfirm={() => logout()}
        />
        <AskInPlace
          label="Delete account"
          icon="trash"
          variant="plain"
          danger
          steps={[
            { question: "Delete your account and everything in it? This can't be undone.", confirm: "Delete" },
            { question: "Are you sure? Your notes can't be brought back.", confirm: "Delete for good", icon: "trash" },
          ]}
          onConfirm={async () => {
            try {
              await postAccountDelete();
            } catch {
              throw new Error("Couldn't delete the account. Check your connection and try again.");
            }
            setOnboarded(false);
            await logout();
          }}
        />
      </View>
    </>
  );
}

/** Looking around without an account: said plainly, with the way in. */
function LookingAround() {
  const setDemo = useDevice((state) => state.setDemo);
  return (
    <CardGroup>
      <View style={styles.card}>
        <Txt variant="headline">You're looking around</Txt>
        <Txt variant="subhead" tone="ink2">
          These notes and tasks are samples. Sign in, or make an account, to keep your own.
        </Txt>
        <Button label="Sign in or make an account" size="md" onPress={() => setDemo(false)} />
      </View>
    </CardGroup>
  );
}

function Caption({ children, first }: { children: string; first?: boolean }) {
  return (
    <Txt variant="footnote" tone="ink3" weight="semibold" style={[styles.caption, first && styles.captionFirst]}>
      {children}
    </Txt>
  );
}

function ToggleRow({ icon, label, detail, value, onChange }: { icon: IconName; label: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Icon name={icon} size={20} color={colors.ink2} weight="medium" />
      <View style={styles.words}>
        <Txt variant="row">{label}</Txt>
        {detail ? (
          <Txt variant="footnote" tone="ink3">
            {detail}
          </Txt>
        ) : null}
      </View>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: "row", alignItems: "center", paddingHorizontal: edge, paddingBottom: space[2] },
  side: { width: 64 },
  right: { alignItems: "flex-end" },
  barTitle: { flex: 1, textAlign: "center" },
  caption: { paddingHorizontal: edge + 4, paddingTop: space[7], paddingBottom: space[2] },
  captionFirst: { paddingTop: space[4] },
  note: { paddingHorizontal: edge * 2, paddingTop: space[3] },
  inset: { marginHorizontal: edge },
  group: { marginTop: space[3] },
  row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: pad, paddingVertical: 10 },
  words: { flex: 1, gap: 2 },
  card: { padding: pad, gap: space[3] },
  actions: { marginHorizontal: edge, marginTop: space[3], gap: space[3] },
  about: { paddingHorizontal: edge * 2, paddingTop: space[10] },
});
