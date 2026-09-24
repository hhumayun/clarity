import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { cacheDirectory, writeAsStringAsync } from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { ChevronLeft } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getAccountExport, postAccountDelete } from "../../src/api/account";
import {
  useClearPersonalization,
  usePreferences,
  useUpdatePreferences,
} from "../../src/hooks/usePreferences";
import { useAppTheme } from "../../src/providers/AppThemeProvider";
import { useToast } from "../../src/providers/ToastProvider";
import { radius, spacing, type Colors, type Fonts } from "../../src/theme";
import { Button } from "../../src/ui/Button";
import { ConfirmModal } from "../../src/ui/ConfirmModal";
import { Skeleton } from "../../src/ui/Skeleton";
import { Switch } from "../../src/ui/Switch";

type PendingAction = null | "clear" | "delete" | "delete-final";

export default function PrivacyScreen() {
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { colors, fonts, scale } = useAppTheme();
  const styles = useMemo(() => makeStyles(colors, scale, fonts), [colors, scale, fonts]);
  const { data: preferences, isFetching } = usePreferences();
  const updatePreferences = useUpdatePreferences();
  const clearPersonalization = useClearPersonalization();
  const [pending, setPending] = useState<PendingAction>(null);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const personalization = preferences?.usePersonalization ?? true;

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await getAccountExport();
      const path = `${cacheDirectory}clarity-notes-export.json`;
      await writeAsStringAsync(path, JSON.stringify(data, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: "application/json",
          UTI: "public.json",
          dialogTitle: "Export my notes",
        });
      } else {
        toast.show("Sharing is not available on this device.");
      }
    } catch {
      toast.show("Couldn't export right now. Please try again in a moment.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <View style={styles.header}>
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Back to settings"
          onPress={() => router.back()}
        >
          <ChevronLeft size={26} color={colors.foreground} />
        </Button>
        <Text style={styles.title}>Privacy</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>How word help works</Text>
          <Text style={styles.hint}>
            When you write, the app looks at your recent words and — if personalization is on —
            phrases you've liked before and related notes you've written. It uses this to offer
            helpful words. Your notes are never shared with other people.
          </Text>
          <View style={styles.settingRow}>
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>Personalized suggestions</Text>
              <Text style={styles.hint}>Learn my phrases to offer better words.</Text>
            </View>
            {isFetching && !preferences ? (
              <Skeleton style={styles.switchSkeleton} />
            ) : (
              <Switch
                value={personalization}
                disabled={updatePreferences.isPending}
                onValueChange={(value) =>
                  updatePreferences.mutate({ usePersonalization: value })
                }
                accessibilityLabel="Personalized suggestions"
              />
            )}
          </View>
          <Button
            variant="secondary"
            size="lg"
            disabled={clearPersonalization.isPending}
            onPress={() => setPending("clear")}
          >
            Clear suggestion history
          </Button>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your data</Text>
          <Button variant="secondary" size="lg" disabled={exporting} onPress={() => void handleExport()}>
            {exporting ? "Preparing your notes…" : "Export my notes"}
          </Button>
          <Button variant="destructive" size="lg" onPress={() => setPending("delete")}>
            Delete my account
          </Button>
        </View>
      </ScrollView>

      <ConfirmModal
        open={pending === "clear"}
        title="Clear suggestion history?"
        description="The app will forget which suggestions you have used. Your notes are not affected."
        confirmLabel="Clear history"
        cancelLabel="Keep it"
        loading={clearPersonalization.isPending}
        onClose={() => setPending(null)}
        onConfirm={() =>
          clearPersonalization.mutate(undefined, {
            onSuccess: () => toast.show("History cleared. Suggestions will start fresh."),
            onError: () => toast.show("Couldn't clear that right now. Please try again."),
            onSettled: () => setPending(null),
          })
        }
      />

      <ConfirmModal
        open={pending === "delete"}
        title="Delete your account?"
        description="All of your notes and data will be permanently removed. This cannot be undone."
        confirmLabel="Delete everything"
        cancelLabel="Keep my account"
        destructive
        onClose={() => setPending(null)}
        onConfirm={() => setPending("delete-final")}
      />

      <ConfirmModal
        open={pending === "delete-final"}
        title="Are you completely sure?"
        description="This is the final step. Your notes cannot be recovered afterwards."
        confirmLabel="Yes, delete my account"
        cancelLabel="No, keep my account"
        destructive
        loading={deleting}
        onClose={() => setPending(null)}
        onConfirm={async () => {
          setDeleting(true);
          try {
            await postAccountDelete();
            queryClient.clear();
            router.replace("/login");
          } catch {
            toast.show("Couldn't delete the account. Please try again.");
          } finally {
            setDeleting(false);
            setPending(null);
          }
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number, fonts: Fonts) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: spacing[2] },
    title: { fontFamily: fonts.display, fontSize: 28 * scale, color: colors.foreground },
    content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[12] },
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing[4],
      gap: spacing[3],
    },
    cardTitle: { fontFamily: fonts.baseSemi, fontSize: 18 * scale, color: colors.foreground },
    hint: { fontFamily: fonts.base, fontSize: 15 * scale, lineHeight: 22 * scale, color: colors.mutedForeground },
    settingRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
    settingText: { flex: 1, gap: 4 },
    settingLabel: { fontFamily: fonts.baseSemi, fontSize: 17 * scale, color: colors.foreground },
    switchSkeleton: { width: 52, height: 32 },
  });
}
