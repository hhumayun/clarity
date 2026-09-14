import { useRouter } from "expo-router";
import { FolderOpen, LayoutDashboard, Plus, Settings } from "lucide-react-native";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTasks } from "../../../src/hooks/useTasks";
import { summarizeTasks } from "../../../src/lib/taskDates";
import { openCountByProject, sortProjects, sortTasks } from "../../../src/lib/taskSort";
import { useAppTheme } from "../../../src/providers/AppThemeProvider";
import { useToast } from "../../../src/providers/ToastProvider";
import { fonts, radius, spacing, type Colors } from "../../../src/theme";
import {
  TASK_STATUS_LABELS,
  TASK_STATUS_VALUES,
  type ProjectRecord,
  type TaskRecord,
  type TaskStatus,
} from "../../../src/types";
import { Button } from "../../../src/ui/Button";
import { ConfirmModal } from "../../../src/ui/ConfirmModal";
import { ProjectSheet } from "../../../src/ui/ProjectSheet";
import { Segmented } from "../../../src/ui/Segmented";
import { Skeleton } from "../../../src/ui/Skeleton";
import { TaskCard } from "../../../src/ui/TaskCard";
import { TaskSheet, type TaskDraft } from "../../../src/ui/TaskSheet";

const ALL = "__all__";

export default function LifeCenterScreen() {
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const isWide = width >= 720;
  const { colors, scale } = useAppTheme();
  const styles = makeStyles(colors, scale);
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
  const activeProject: ProjectRecord | null =
    projectFilter === ALL ? null : projects.find((project) => project.id === projectFilter) ?? null;
  const effectiveFilter = activeProject ? activeProject.id : ALL;
  const openCounts = useMemo(() => openCountByProject(allTasks), [allTasks]);
  const visibleTasks = useMemo(
    () =>
      sortTasks(
        effectiveFilter === ALL
          ? allTasks
          : allTasks.filter((task) => task.projectId === effectiveFilter),
      ),
    [allTasks, effectiveFilter],
  );
  const byStatus = useMemo(() => {
    const groups: Record<TaskStatus, TaskRecord[]> = { todo: [], in_progress: [], done: [] };
    for (const task of visibleTasks) groups[task.status].push(task);
    return groups;
  }, [visibleTasks]);
  const summary = summarizeTasks(visibleTasks);
  const totalOpen = visibleTasks.filter((task) => task.status !== "done").length;
  const columns = (isWide ? TASK_STATUS_VALUES : [mobileStatus]) as readonly TaskStatus[];

  const changeStatus = (task: TaskRecord, status: TaskStatus) => {
    update.mutate(
      { id: task.id, status },
      { onError: () => toast.show("That change could not be saved. Please try again.") },
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
      toast.show("Task added");
    }
  };

  return (
    <SafeAreaView style={styles.page} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={styles.title}>Life Center</Text>
          <Text style={styles.summary}>{loading ? "Gathering your tasks…" : summary}</Text>
        </View>
        <Button
          variant="ghost"
          size="icon"
          accessibilityLabel="Settings"
          onPress={() => router.push("/settings")}
        >
          <Settings size={24} color={colors.foreground} />
        </Button>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!loading && !query.isError && projects.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Pressable
              onPress={() => setProjectFilter(ALL)}
              style={[styles.filterChip, effectiveFilter === ALL && styles.filterActive]}
            >
              <Text style={styles.filterText}>
                All {allTasks.filter((task) => task.status !== "done").length}
              </Text>
            </Pressable>
            {projects.map((project) => (
              <Pressable
                key={project.id}
                onPress={() => setProjectFilter(project.id)}
                style={[styles.filterChip, effectiveFilter === project.id && styles.filterActive]}
              >
                <Text style={styles.filterText}>
                  {project.name} {openCounts.get(project.id) ?? 0}
                </Text>
              </Pressable>
            ))}
            <Button variant="ghost" size="sm" onPress={() => setProjectsOpen(true)}>
              <FolderOpen size={16} color={colors.foreground} />
              <Text style={styles.projectsLabel}>Projects</Text>
            </Button>
          </ScrollView>
        ) : null}

        <Button
          size="lg"
          onPress={() => setTaskDialog({ open: true, task: null })}
          disabled={loading}
        >
          <Plus size={18} color={colors.primaryForeground} />
          <Text style={styles.addLabel}>Add a task</Text>
        </Button>

        {loading ? (
          <View style={styles.board}>
            {[0, 1, 2].map((item) => (
              <Skeleton key={item} style={styles.columnSkeleton} />
            ))}
          </View>
        ) : null}

        {query.isError ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>We could not load your Life Center.</Text>
            <Button variant="secondary" onPress={() => void query.refetch()}>
              Try again
            </Button>
          </View>
        ) : null}

        {!loading && !query.isError && allTasks.length === 0 ? (
          <View style={styles.empty}>
            <LayoutDashboard size={36} color={colors.mutedForeground} />
            <Text style={styles.emptyTitle}>Your Life Center is ready</Text>
            <Text style={styles.emptyText}>
              Tasks you add here, or that are found in your notes, will gather in one calm place.
            </Text>
            <Button size="lg" onPress={() => setTaskDialog({ open: true, task: null })}>
              Add your first task
            </Button>
          </View>
        ) : null}

        {!loading && !query.isError && allTasks.length > 0 ? (
          <>
            {!isWide ? (
              <Segmented
                accessibilityLabel="Which tasks to show"
                value={mobileStatus}
                onChange={setMobileStatus}
                options={TASK_STATUS_VALUES.map((status) => ({
                  label: TASK_STATUS_LABELS[status],
                  value: status,
                  count: byStatus[status].length,
                }))}
              />
            ) : null}
            <View style={[styles.board, isWide && styles.boardWide]}>
              {columns.map((status) => {
                const tasks = byStatus[status];
                return (
                  <View key={status} style={[styles.column, isWide && styles.columnWide]}>
                    <View style={styles.columnHeader}>
                      <Text style={styles.columnTitle}>
                        {TASK_STATUS_LABELS[status]} {tasks.length}
                      </Text>
                      {status === "done" && tasks.length > 0 ? (
                        <Button variant="ghost" size="sm" onPress={() => setConfirmClear(true)}>
                          Clear completed
                        </Button>
                      ) : null}
                    </View>
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        showProject={effectiveFilter === ALL}
                        onStatusChange={(next) => changeStatus(task, next)}
                        onEdit={() => setTaskDialog({ open: true, task })}
                        onDelete={async () => {
                          await remove.mutateAsync({ id: task.id });
                        }}
                      />
                    ))}
                    {tasks.length === 0 ? (
                      <Text style={styles.noTasks}>
                        {status === "todo" && totalOpen === 0
                          ? "Nothing to do right now."
                          : "Nothing here right now."}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>

      <TaskSheet
        open={taskDialog.open}
        onClose={() => setTaskDialog((state) => ({ ...state, open: false }))}
        task={taskDialog.task}
        projects={projects}
        defaultProjectId={activeProject?.id ?? null}
        onSave={saveTask}
        onDelete={
          taskDialog.task
            ? async () => {
                await remove.mutateAsync({ id: taskDialog.task!.id });
              }
            : undefined
        }
        onCreateProject={async (name) => (await createProject.mutateAsync({ name })).project}
      />

      <ProjectSheet
        open={projectsOpen}
        onClose={() => setProjectsOpen(false)}
        projects={projects}
        tasks={allTasks}
        onCreate={async (name) => (await createProject.mutateAsync({ name })).project}
        onRename={async (id, name) => {
          await renameProject.mutateAsync({ id, name });
        }}
        onDelete={async (id, moveTasksTo) => {
          await deleteProject.mutateAsync({ id, moveTasksTo });
          if (projectFilter === id) setProjectFilter(ALL);
        }}
      />

      <ConfirmModal
        open={confirmClear}
        title={
          activeProject
            ? `Clear completed tasks in ${activeProject.name}?`
            : "Clear all completed tasks?"
        }
        description={`${byStatus.done.length} finished ${byStatus.done.length === 1 ? "task" : "tasks"} will be removed from the board. Your notes are not affected.`}
        confirmLabel="Clear"
        destructive
        loading={clearDone.isPending}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clearDone.mutate(activeProject ? { projectId: activeProject.id } : {}, {
            onSuccess: ({ cleared }) => {
              setConfirmClear(false);
              toast.show(`${cleared} ${cleared === 1 ? "task" : "tasks"} cleared`);
            },
            onError: () => toast.show("Those tasks could not be cleared. Please try again."),
          });
        }}
      />
    </SafeAreaView>
  );
}

function makeStyles(colors: Colors, scale: number) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
    },
    heading: { flex: 1, gap: 4 },
    title: { fontFamily: fonts.display, fontSize: 32 * scale, color: colors.foreground },
    summary: { fontFamily: fonts.base, fontSize: 15 * scale, color: colors.mutedForeground },
    content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[12] },
    filters: { gap: spacing[2], alignItems: "center" },
    filterChip: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      backgroundColor: colors.surface,
    },
    filterActive: { backgroundColor: colors.accent, borderColor: colors.primary },
    filterText: { fontFamily: fonts.baseSemi, fontSize: 14 * scale, color: colors.foreground },
    projectsLabel: { fontFamily: fonts.baseSemi, fontSize: 14 * scale, color: colors.foreground },
    addLabel: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.primaryForeground },
    board: { gap: spacing[4] },
    boardWide: { flexDirection: "row", alignItems: "flex-start" },
    column: { gap: spacing[2] },
    columnWide: { flex: 1 },
    columnHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    columnTitle: { fontFamily: fonts.baseSemi, fontSize: 16 * scale, color: colors.foreground },
    columnSkeleton: { height: 180 },
    noTasks: { fontFamily: fonts.base, fontSize: 14 * scale, color: colors.mutedForeground },
    empty: { alignItems: "center", gap: spacing[3], paddingVertical: spacing[8] },
    emptyTitle: { fontFamily: fonts.display, fontSize: 24 * scale, color: colors.foreground },
    emptyText: {
      fontFamily: fonts.base,
      fontSize: 16 * scale,
      color: colors.mutedForeground,
      textAlign: "center",
    },
  });
}
