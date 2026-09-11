import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import {
  Search,
  Settings,
  Plus,
  MoreHorizontal,
  ChevronUp,
  Feather,
  X,
} from "lucide-react";
import { Button } from "../components/Button";
import { Input } from "../components/Input";
import { Skeleton } from "../components/Skeleton";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { AppNavigation } from "../components/AppNavigation";
import { useNotes, useUpdateNote, useDeleteNote, useReindexNotes } from "../helpers/useNotes";
import { useClaritySettings } from "../helpers/useClaritySettings";
import { formatNoteDate } from "../helpers/formatNoteDate";
import type { NoteRecord } from "../helpers/NoteRecord";
import styles from "./_index.module.css";

const BACKFILL_FLAG = "clarity:backfilled";

export default function NotesListPage() {
  const navigate = useNavigate();
  const { onboardingDone } = useClaritySettings();

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

  // Catch up on notes that have never been indexed, once per session, well
  // away from the writing path.
  const reindex = useReindexNotes();
  const reindexRef = useRef(reindex.mutate);
  reindexRef.current = reindex.mutate;
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(BACKFILL_FLAG) === "true") return;
      window.sessionStorage.setItem(BACKFILL_FLAG, "true");
    } catch {
      return;
    }
    reindexRef.current({});
  }, []);

  if (!onboardingDone) {
    return <Navigate to="/onboarding" replace />;
  }

  const notes = data?.notes ?? [];
  const loading = isFetching && !data;

  return (
    <>
      <Helmet>
        <title>Your notes · Clarity Notes</title>
      </Helmet>
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Your notes</h1>
          <Button
            asChild
            variant="ghost"
            size="icon-lg"
            aria-label="Settings"
            className={styles.settingsButton}
          >
            <Link to="/settings">
              <Settings className={styles.settingsIcon} aria-hidden="true" />
            </Link>
          </Button>
        </header>

        <div className={styles.controls}>
          <div className={styles.searchRow}>
            <Search className={styles.searchIcon} aria-hidden="true" />
            <Input
              className={styles.searchInput}
              placeholder="Search your notes"
              aria-label="Search your notes"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className={styles.clearSearch}
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <X className={styles.clearIcon} aria-hidden="true" />
              </button>
            )}
          </div>

          <div className={styles.tabs} role="tablist" aria-label="Which notes to show">
            {[
              { label: "Current", value: false },
              { label: "Archived", value: true },
            ].map((tab) => (
              <button
                key={tab.label}
                type="button"
                role="tab"
                aria-selected={showArchived === tab.value}
                className={styles.tab}
                data-active={showArchived === tab.value}
                onClick={() => {
                  setShowArchived(tab.value);
                  setExpandedId(null);
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.list}>
          {loading &&
            [0, 1, 2].map((i) => (
              <Skeleton key={i} className={styles.cardSkeleton} />
            ))}

          {!loading &&
            notes.map((note) => {
              const expanded = expandedId === note.id;
              return (
                <article key={note.id} className={styles.card}>
                  <div className={styles.cardMain}>
                    <button
                      type="button"
                      className={styles.cardOpen}
                      onClick={() => navigate(`/note/${note.id}`)}
                      aria-label={`Open note: ${note.title || "Untitled note"}`}
                    >
                      <span className={styles.cardTitle}>
                        {note.title || "Untitled note"}
                      </span>
                      {note.content && (
                        <span className={styles.cardPreview}>
                          {note.content.replace(/\s+/g, " ").slice(0, 160)}
                        </span>
                      )}
                      <span className={styles.cardWhen}>
                        {formatNoteDate(note.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={styles.cardMore}
                      onClick={() => setExpandedId(expanded ? null : note.id)}
                      aria-expanded={expanded}
                      aria-label={`More options for ${note.title || "this note"}`}
                    >
                      {expanded ? (
                        <ChevronUp className={styles.moreIcon} aria-hidden="true" />
                      ) : (
                        <MoreHorizontal className={styles.moreIcon} aria-hidden="true" />
                      )}
                    </button>
                  </div>

                  {expanded && (
                    <div className={styles.cardActions}>
                      <Button
                        variant="secondary"
                        size="lg"
                        className={styles.cardAction}
                        disabled={updateNote.isPending}
                        onClick={() => {
                          setExpandedId(null);
                          updateNote.mutate({
                            id: note.id,
                            archived: !note.archived,
                          });
                        }}
                      >
                        {note.archived ? "Restore" : "Archive"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="lg"
                        className={styles.cardAction}
                        onClick={() => setPendingDelete(note)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}

          {!loading && notes.length === 0 && (
            <div className={styles.empty}>
              {isError ? (
                <>
                  <p className={styles.emptyText}>
                    We couldn't load your notes right now.
                  </p>
                  <Button variant="secondary" size="lg" onClick={() => refetch()}>
                    Try again
                  </Button>
                </>
              ) : debouncedSearch ? (
                <p className={styles.emptyText}>
                  No notes match "{debouncedSearch}".
                </p>
              ) : showArchived ? (
                <p className={styles.emptyText}>No archived notes.</p>
              ) : (
                <>
                  <Feather className={styles.emptyIcon} aria-hidden="true" />
                  <p className={styles.emptyText}>
                    No notes yet. Tap "New note" below to start writing.
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <Button
            asChild
            size="lg"
            className={styles.newNoteButton}
          >
            <Link to="/note/new">
              <Plus className={styles.newNoteIcon} aria-hidden="true" />
              New note
            </Link>
          </Button>
        </div>

        <ConfirmDialog
          open={pendingDelete !== null}
          onOpenChange={(open) => !open && setPendingDelete(null)}
          title="Delete this note?"
          description="The note will be gone for good. This cannot be undone."
          confirmLabel="Delete"
          destructive
          loading={deleteNote.isPending}
          onConfirm={() => {
            if (!pendingDelete) return;
            deleteNote.mutate(
              { id: pendingDelete.id },
              { onSettled: () => setPendingDelete(null) },
            );
            setExpandedId(null);
          }}
        />
        <AppNavigation active="notes" />
      </main>
    </>
  );
}