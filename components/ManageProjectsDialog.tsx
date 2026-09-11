import React, { useState } from "react";
import { Check, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ProjectRecord, TaskRecord } from "../helpers/TaskRecord";
import { sortProjects } from "../helpers/taskSort";
import { Button } from "./Button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "./Dialog";
import { Input } from "./Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./Select";
import styles from "./ManageProjectsDialog.module.css";

interface ManageProjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectRecord[];
  tasks: TaskRecord[];
  onCreate: (name: string) => Promise<ProjectRecord>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string, moveTasksTo?: string) => Promise<void>;
}

/**
 * Rename, add and remove projects. Deleting a project that still has tasks
 * asks where they should go, so nothing disappears by surprise.
 */
export const ManageProjectsDialog: React.FC<ManageProjectsDialogProps> = ({
  open, onOpenChange, projects, tasks, onCreate, onRename, onDelete,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<ProjectRecord | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");

  const sorted = sortProjects(projects);
  const counts = new Map<string, { open: number; done: number }>();
  for (const task of tasks) {
    const entry = counts.get(task.projectId) ?? { open: 0, done: 0 };
    if (task.status === "done") entry.done += 1; else entry.open += 1;
    counts.set(task.projectId, entry);
  }

  const startRename = (project: ProjectRecord) => {
    setEditingId(project.id);
    setEditName(project.name);
    setError("");
  };

  const commitRename = async () => {
    if (!editingId) return;
    const clean = editName.trim().replace(/\s+/g, " ");
    const current = projects.find((p) => p.id === editingId);
    if (!clean || !current) { setEditingId(null); return; }
    if (clean === current.name) { setEditingId(null); return; }
    setBusy(true);
    setError("");
    try {
      await onRename(editingId, clean);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be renamed.");
    } finally {
      setBusy(false);
    }
  };

  const commitAdd = async () => {
    const clean = newName.trim().replace(/\s+/g, " ");
    if (!clean) return;
    setBusy(true);
    setError("");
    try {
      await onCreate(clean);
      setNewName("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const count = counts.get(deleting.id);
    const hasTasks = Boolean(count && count.open + count.done > 0);
    const others = sorted.filter((p) => p.id !== deleting.id);
    if (hasTasks && others.length > 0 && !moveTo) return;
    setBusy(true);
    setError("");
    try {
      await onDelete(deleting.id, hasTasks && others.length > 0 ? moveTo : undefined);
      toast.success(`"${deleting.name}" removed`);
      setDeleting(null);
      setMoveTo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That project could not be removed.");
    } finally {
      setBusy(false);
    }
  };

  const deletingCount = deleting ? counts.get(deleting.id) : undefined;
  const deletingTaskTotal = deletingCount ? deletingCount.open + deletingCount.done : 0;
  const otherProjects = deleting ? sorted.filter((p) => p.id !== deleting.id) : [];

  return (
    <>
      <Dialog open={open && !deleting} onOpenChange={(next) => !busy && onOpenChange(next)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Your projects</DialogTitle>
            <DialogDescription>
              Projects are the areas of your life that tasks belong to. Rename them to words that feel familiar.
            </DialogDescription>
          </DialogHeader>

          <ul className={styles.list}>
            {sorted.map((project) => {
              const count = counts.get(project.id) ?? { open: 0, done: 0 };
              const isEditing = editingId === project.id;
              return (
                <li key={project.id} className={styles.item}>
                  <FolderOpen className={styles.icon} aria-hidden="true" />
                  {isEditing ? (
                    <div className={styles.editRow}>
                      <Input
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") { event.preventDefault(); void commitRename(); }
                          if (event.key === "Escape") setEditingId(null);
                        }}
                        maxLength={120}
                        aria-label="Project name"
                        autoFocus
                        disabled={busy}
                      />
                      <Button variant="ghost" size="icon-md" aria-label="Save name" onClick={() => void commitRename()} disabled={busy}>
                        <Check aria-hidden="true" />
                      </Button>
                      <Button variant="ghost" size="icon-md" aria-label="Cancel" onClick={() => setEditingId(null)} disabled={busy}>
                        <X aria-hidden="true" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className={styles.text}>
                        <span className={styles.name}>{project.name}</span>
                        <span className={styles.count}>
                          {count.open === 0 && count.done === 0
                            ? "No tasks"
                            : [
                                count.open > 0 ? `${count.open} to do` : null,
                                count.done > 0 ? `${count.done} done` : null,
                              ].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      <Button variant="ghost" size="icon-md" aria-label={`Rename ${project.name}`} onClick={() => startRename(project)} disabled={busy}>
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-md"
                        className={styles.deleteButton}
                        aria-label={`Remove ${project.name}`}
                        onClick={() => { setDeleting(project); setMoveTo(""); setError(""); }}
                        disabled={busy}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
            {sorted.length === 0 && <li className={styles.emptyItem}>No projects yet.</li>}
          </ul>

          {adding ? (
            <div className={styles.addRow}>
              <Input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void commitAdd(); }
                  if (event.key === "Escape") setAdding(false);
                }}
                placeholder="For example, Family"
                aria-label="New project name"
                maxLength={120}
                autoFocus
                disabled={busy}
              />
              <Button onClick={() => void commitAdd()} disabled={busy || !newName.trim()}>
                {busy ? "Adding…" : "Add"}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
            </div>
          ) : (
            <Button variant="secondary" className={styles.addButton} onClick={() => { setAdding(true); setError(""); }}>
              <Plus aria-hidden="true" />
              Add a project
            </Button>
          )}

          {error && !deleting && <p className={styles.error} role="alert">{error}</p>}

          <DialogFooter>
            <Button size="lg" onClick={() => onOpenChange(false)} disabled={busy}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleting)} onOpenChange={(next) => !busy && !next && setDeleting(null)}>
        <DialogContent className={styles.dialog}>
          <DialogHeader>
            <DialogTitle>Remove "{deleting?.name}"?</DialogTitle>
            <DialogDescription>
              {deletingTaskTotal === 0
                ? "This project has no tasks. It will simply go away."
                : otherProjects.length > 0
                  ? `Its ${deletingTaskTotal} ${deletingTaskTotal === 1 ? "task" : "tasks"} will move to the project you choose below.`
                  : `This is your only project, so its ${deletingTaskTotal} ${deletingTaskTotal === 1 ? "task" : "tasks"} will be removed too.`}
            </DialogDescription>
          </DialogHeader>

          {deletingTaskTotal > 0 && otherProjects.length > 0 && (
            <label className={styles.moveField}>
              <span className={styles.label}>Move tasks to</span>
              <Select value={moveTo} onValueChange={setMoveTo}>
                <SelectTrigger className={styles.control} aria-label="Move tasks to">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  {otherProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          {error && <p className={styles.error} role="alert">{error}</p>}

          <DialogFooter className={styles.confirmFooter}>
            <Button variant="secondary" size="lg" onClick={() => setDeleting(null)} disabled={busy}>Keep it</Button>
            <Button
              variant="destructive"
              size="lg"
              onClick={() => void confirmDelete()}
              disabled={busy || (deletingTaskTotal > 0 && otherProjects.length > 0 && !moveTo)}
            >
              {busy ? "Removing…" : "Remove project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
