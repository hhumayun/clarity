import React, { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { FolderOpen, LayoutDashboard, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { AppNavigation } from "../components/AppNavigation";
import { Button } from "../components/Button";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ManageProjectsDialog } from "../components/ManageProjectsDialog";
import { Skeleton } from "../components/Skeleton";
import { TaskCard } from "../components/TaskCard";
import { TaskDialog, type TaskDraft } from "../components/TaskDialog";
import { ToggleGroup, ToggleGroupItem } from "../components/ToggleGroup";
import type { TaskStatus } from "../helpers/schema";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_VALUES,
  type ProjectRecord,
  type TaskRecord,
} from "../helpers/TaskRecord";
import { summarizeTasks } from "../helpers/taskDates";
import { openCountByProject, sortProjects, sortTasks } from "../helpers/taskSort";
import { useIsMobile } from "../helpers/useIsMobile";
import { useTasks } from "../helpers/useTasks";
import styles from "./life-center.module.css";

const ALL = "__all__";

export default function LifeCenterPage() {
  const isMobile = useIsMobile();
  const { query, create, update, remove, clearDone, createProject, renameProject, deleteProject } =
    useTasks();

  const [projectFilter, setProjectFilter] = useState<string>(ALL);
  const [mobileStatus, setMobileStatus] = useState<TaskStatus>("todo");
  const [taskDialog, setTaskDialog] = useState<{ open: boolean; task: TaskRecord | null }>({
    open: false,
    task: null,
  });
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const projects = useMemo(() => sortProjects(query.data?.projects ?? []), [query.data?.projects]);
  const allTasks = query.data?.tasks ?? [];
  const loading = query.isFetching && !query.data;

  // If the filtered project disappears (deleted), fall back to All.
  const activeProject: ProjectRecord | null =
    projectFilter === ALL ? null : projects.find((p) => p.id === projectFilter) ?? null;
  const effectiveFilter = activeProject ? activeProject.id : ALL;

  const openCounts = useMemo(() => openCountByProject(allTasks), [allTasks]);
  const visibleTasks = useMemo(
    () =>
      sortTasks(
        effectiveFilter === ALL ? allTasks : allTasks.filter((t) => t.projectId === effectiveFilter),
      ),
    [allTasks, effectiveFilter],
  );
  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, TaskRecord[]> = { todo: [], in_progress: [], done: [] };
    for (const task of visibleTasks) groups[task.status].push(task);
    return groups;
  }, [visibleTasks]);

  const summary = summarizeTasks(visibleTasks);
  const totalOpen = visibleTasks.filter((t) => t.status !== "done").length;

  const changeStatus = (task: TaskRecord, status: TaskStatus) => {
    update.mutate(
      { id: task.id, status },
      { onError: () => toast.error("That change could not be saved. Please try again.") },
    );
  };

  const saveTask = async (draft: TaskDraft) => {
    if (!draft.projectId) throw new Error("Choose a project for this task.");
    if (taskDialog.task) {
      await update.mutateAsync({
        id: taskDialog.task.id,
        text: draft.text,
        projectId: draft.projectId,
        completeBy: draft.completeBy,
        status: draft.status,
      });
    } else {
      await create.mutateAsync({
        text: draft.text,
        projectId: draft.projectId,
        completeBy: draft.completeBy,
        status: draft.status,
      });
      toast.success("Task added");
    }
  };

  const columns = (isMobile ? [mobileStatus] : TASK_STATUS_VALUES) as readonly TaskStatus[];

  return (
    <>
      <Helmet><title>Life Center · Clarity Notes</title></Helmet>
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <h1>Life Center</h1>
            <p aria-live="polite">{loading ? "Gathering your tasks…" : summary}</p>
          </div>
          <div className={styles.headerActions}>
            <Button
              size="lg"
              className={styles.addButton}
              onClick={() => setTaskDialog({ open: true, task: null })}
              disabled={loading}
            >
              <Plus aria-hidden="true" />
              Add a task
            </Button>
            <Button asChild variant="ghost" size="icon-lg" aria-label="Settings">
              <Link to="/settings"><Settings className={styles.settingsIcon} aria-hidden="true" /></Link>
            </Button>
          </div>
        </header>

        {!loading && !query.isError && projects.length > 0 && (
          <div className={styles.filterBar}>
            <ToggleGroup
              type="single"
              value={effectiveFilter}
              onValueChange={(value) => value && setProjectFilter(value)}
              className={styles.filters}
              aria-label="Show tasks from"
            >
              <ToggleGroupItem value={ALL} className={styles.filterChip}>
                All
                <span className={styles.filterCount}>{allTasks.filter((t) => t.status !== "done").length}</span>
              </ToggleGroupItem>
              {projects.map((project) => (
                <ToggleGroupItem key={project.id} value={project.id} className={styles.filterChip}>
                  {project.name}
                  <span className={styles.filterCount}>{openCounts.get(project.id) ?? 0}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button variant="ghost" size="sm" className={styles.projectsButton} onClick={() => setProjectsOpen(true)}>
              <FolderOpen aria-hidden="true" />
              Projects
            </Button>
          </div>
        )}

        {loading && (
          <div className={styles.board}>
            {[0, 1, 2].map((item) => <Skeleton key={item} className={styles.columnSkeleton} />)}
          </div>
        )}

        {query.isError && (
          <div className={styles.empty}>
            <p>We could not load your Life Center.</p>
            <Button variant="secondary" onClick={() => void query.refetch()}>Try again</Button>
          </div>
        )}

        {!loading && !query.isError && allTasks.length === 0 && (
          <div className={styles.empty}>
            <LayoutDashboard aria-hidden="true" />
            <h2>Your Life Center is ready</h2>
            <p>Tasks you add here, or that are found in your notes, will gather in one calm place.</p>
            <Button size="lg" onClick={() => setTaskDialog({ open: true, task: null })}>
              <Plus aria-hidden="true" />
              Add your first task
            </Button>
          </div>
        )}

        {!loading && !query.isError && allTasks.length > 0 && (
          <>
            {isMobile && (
              <ToggleGroup
                type="single"
                value={mobileStatus}
                onValueChange={(value) => value && setMobileStatus(value as TaskStatus)}
                variant="outline"
                size="lg"
                className={styles.statusSwitch}
                aria-label="Which tasks to show"
              >
                {TASK_STATUS_VALUES.map((status) => (
                  <ToggleGroupItem key={status} value={status} className={styles.statusSwitchItem}>
                    {TASK_STATUS_LABELS[status]}
                    <span className={styles.filterCount}>{byStatus[status].length}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            )}

            <div className={styles.board} aria-label="Tasks by status">
              {columns.map((status) => {
                const tasks = byStatus[status];
                return (
                  <section key={status} className={styles.column} data-status={status} aria-labelledby={`column-${status}`}>
                    <header className={styles.columnHeader}>
                      <h2 id={`column-${status}`}>
                        {TASK_STATUS_LABELS[status]}
                        <span className={styles.columnCount}>{tasks.length}</span>
                      </h2>
                      {status === "done" && tasks.length > 0 && (
                        <Button variant="ghost" size="sm" className={styles.clearButton} onClick={() => setConfirmClear(true)}>
                          Clear completed
                        </Button>
                      )}
                    </header>
                    <div className={styles.cards}>
                      {tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          showProject={effectiveFilter === ALL}
                          onStatusChange={(next) => changeStatus(task, next)}
                          onEdit={() => setTaskDialog({ open: true, task })}
                          onDelete={async () => { await remove.mutateAsync({ id: task.id }); }}
                        />
                      ))}
                      {tasks.length === 0 && (
                        <p className={styles.noTasks}>
                          {status === "todo" && totalOpen === 0
                            ? "Nothing to do right now."
                            : "Nothing here right now."}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>
      <AppNavigation active="life-center" />

      <TaskDialog
        open={taskDialog.open}
        onOpenChange={(open) => setTaskDialog((s) => ({ ...s, open }))}
        task={taskDialog.task}
        projects={projects}
        defaultProjectId={activeProject?.id ?? null}
        onSave={saveTask}
        onDelete={
          taskDialog.task
            ? async () => { await remove.mutateAsync({ id: taskDialog.task!.id }); }
            : undefined
        }
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
      />

      <ManageProjectsDialog
        open={projectsOpen}
        onOpenChange={setProjectsOpen}
        projects={projects}
        tasks={allTasks}
        onCreate={async (name) => (await createProject.mutateAsync({ name })).project}
        onRename={async (id, name) => { await renameProject.mutateAsync({ id, name }); }}
        onDelete={async (id, moveTasksTo) => {
          await deleteProject.mutateAsync({ id, moveTasksTo });
          if (projectFilter === id) setProjectFilter(ALL);
        }}
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title={activeProject ? `Clear completed tasks in ${activeProject.name}?` : "Clear all completed tasks?"}
        description={`${byStatus.done.length} finished ${byStatus.done.length === 1 ? "task" : "tasks"} will be removed from the board. Your notes are not affected.`}
        confirmLabel="Clear"
        destructive
        loading={clearDone.isPending}
        onConfirm={() => {
          clearDone.mutate(
            activeProject ? { projectId: activeProject.id } : {},
            {
              onSuccess: ({ cleared }) => {
                setConfirmClear(false);
                toast.success(`${cleared} ${cleared === 1 ? "task" : "tasks"} cleared`);
              },
              onError: () => toast.error("Those tasks could not be cleared. Please try again."),
            },
          );
        }}
      />
    </>
  );
}
