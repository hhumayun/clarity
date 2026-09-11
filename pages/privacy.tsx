import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Download } from "lucide-react";
import { Button } from "../components/Button";
import { Switch } from "../components/Switch";
import { Skeleton } from "../components/Skeleton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  usePreferences,
  useUpdatePreferences,
  useClearPersonalization,
} from "../helpers/usePreferences";
import { getAccountExport } from "../endpoints/account/export_GET.schema";
import { postAccountDelete } from "../endpoints/account/delete_POST.schema";
import styles from "./privacy.module.css";

type PendingAction = null | "clear" | "delete" | "delete-final";

export default function PrivacyPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "clarity-notes-export.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Couldn't export right now. Please try again in a moment.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Privacy · Clarity Notes</title>
      </Helmet>
      <main className={styles.page}>
        <header className={styles.header}>
          <Button
            asChild
            variant="ghost"
            size="icon-lg"
            aria-label="Back to settings"
            className={styles.back}
          >
            <Link to="/settings">
              <ChevronLeft className={styles.backIcon} aria-hidden="true" />
            </Link>
          </Button>
          <h1 className={styles.title}>Privacy</h1>
        </header>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>How word help works</h2>
          <p className={styles.hint}>
            When you write, the app looks at your recent words and — if
            personalization is on — phrases you've liked before and related
            notes you've written. It uses this to offer helpful words. Your
            notes are never shared with other people.
          </p>

          <div className={styles.settingRow}>
            <span className={styles.settingText}>
              <span className={styles.settingLabel}>
                Personalized suggestions
              </span>
              <span className={styles.hint}>
                Learn my phrases to offer better words.
              </span>
            </span>
            {isFetching && !preferences ? (
              <Skeleton className={styles.switchSkeleton} />
            ) : (
              <Switch
                checked={personalization}
                disabled={updatePreferences.isPending}
                onCheckedChange={(value) =>
                  updatePreferences.mutate({ usePersonalization: value })
                }
                aria-label="Personalized suggestions"
              />
            )}
          </div>

          <Button
            variant="secondary"
            size="lg"
            className={styles.fullButton}
            disabled={clearPersonalization.isPending}
            onClick={() => setPending("clear")}
          >
            Clear suggestion history
          </Button>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Your data</h2>
          <Button
            variant="secondary"
            size="lg"
            className={styles.fullButton}
            disabled={exporting}
            onClick={handleExport}
          >
            <Download className={styles.buttonIcon} aria-hidden="true" />
            {exporting ? "Preparing your notes…" : "Export my notes"}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            className={styles.fullButton}
            onClick={() => setPending("delete")}
          >
            Delete my account
          </Button>
        </section>

        <ConfirmDialog
          open={pending === "clear"}
          onOpenChange={(open) => !open && setPending(null)}
          title="Clear suggestion history?"
          description="The app will forget which suggestions you have used. Your notes are not affected."
          confirmLabel="Clear history"
          cancelLabel="Keep it"
          loading={clearPersonalization.isPending}
          onConfirm={() =>
            clearPersonalization.mutate(undefined, {
              onSuccess: () => {
                toast.success(
                  "History cleared. Suggestions will start fresh.",
                );
              },
              onError: () => {
                toast.error("Couldn't clear that right now. Please try again.");
              },
              onSettled: () => setPending(null),
            })
          }
        />

        <ConfirmDialog
          open={pending === "delete"}
          onOpenChange={(open) => !open && setPending(null)}
          title="Delete your account?"
          description="All of your notes and data will be permanently removed. This cannot be undone."
          confirmLabel="Delete everything"
          cancelLabel="Keep my account"
          destructive
          onConfirm={() => setPending("delete-final")}
        />

        <ConfirmDialog
          open={pending === "delete-final"}
          onOpenChange={(open) => !open && setPending(null)}
          title="Are you completely sure?"
          description="This is the final step. Your notes cannot be recovered afterwards."
          confirmLabel="Yes, delete my account"
          cancelLabel="No, keep my account"
          destructive
          loading={deleting}
          onConfirm={async () => {
            setDeleting(true);
            try {
              await postAccountDelete({ confirm: true });
              queryClient.clear();
              navigate("/login", { replace: true });
            } catch {
              toast.error("Couldn't delete the account. Please try again.");
            } finally {
              setDeleting(false);
              setPending(null);
            }
          }}
        />
      </main>
    </>
  );
}