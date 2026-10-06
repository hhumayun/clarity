import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { saveOfflineCopyNow } from "../core/sync/persist";
import { outbox, waitUntilSynced } from "../core/sync/store";
import { postTaskDismissSuggestion } from "../core/api/tasks";
import { usePendingCount } from "../core/sync/SyncProvider";
import { useFocusSummary, useRecordFocus } from "../core/hooks/useFocus";
import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "../core/hooks/useNotes";
import { useTasks } from "../core/hooks/useTasks";
import type { TaskChange } from "../core/lib/reminderRules";
import { useAuth } from "../core/providers/AuthProvider";
import { holdAcknowledgements, useAcknowledge } from "../ui/Acknowledgement";
import { byName, hhmm, noonOf, noteContent, pagesOf, toArea, toFocus, toNote, toTask } from "./adapt";
import { declined, emptyAccount, setAccountNotifier, useAccountStore, type AccountState } from "./account";
import { syncNoticesQuiet } from "./quiet";
import { useDataMode, useOnline } from "./sage";
import { aiOn } from "./ai";
import { dayOf } from "../lib/dates";
import type { Suggestion } from "../store/model";

/**
 * Every signed-in account saves. Until phase 4's offline checks passed, only
 * test accounts did; saving opened to all accounts on 2026-10-06, with the
 * user's OK, after a backup of the real accounts. The read-only path stays,
 * should saving ever need pausing.
 */
export function canSave(email: string | undefined): boolean {
  return !!email;
}

/** Clerk's test addresses (+clerk_test): no inbox, the code is always 424242. */
export function isTestAccount(email: string | undefined): boolean {
  return !!email && /\+clerk_test@/i.test(email);
}

// The newest-edited 200 notes, without their rich text.
const ALL_NOTES = {};

const cleanName = (name: string) => name.trim().replace(/\s+/g, " ").slice(0, 40);
const sameName = (a: string, b: string) => cleanName(a).toLowerCase() === cleanName(b).toLowerCase();

type Actions = Pick<
  AccountState,
  "addTask" | "updateTask" | "setDone" | "moveTask" | "deleteTask" | "clearCompleted" | "linkNote" | "unlinkNote" | "addArea" | "renameArea" | "deleteArea" | "recordFocus" | "parkThought" | "addNote" | "setNoteArea" | "writeNote" | "archiveNote" | "deleteNote"
>;

/**
 * While you're signed in: switches the app to your account's data, fills
 * the account store from the main app's hooks (which keep a copy on the
 * phone and send changes through the outbox), and puts in the actions that
 * save. Signing out unmounts it, and the account store empties.
 */
export function AccountSource() {
  const { authState } = useAuth();
  const email = authState.type === "authenticated" ? authState.user.email : undefined;
  const editable = canSave(email);
  const acknowledge = useAcknowledge();

  const queryClient = useQueryClient();
  const tasks = useTasks();
  const notes = useNotes(ALL_NOTES);
  const focus = useFocusSummary();
  const createNote = useCreateNote();
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const recordFocus = useRecordFocus();

  useEffect(() => {
    useDataMode.setState({ mode: "account" });
    return () => {
      useDataMode.setState({ mode: "demo" });
      useAccountStore.setState({ ...emptyAccount(), refresh: async () => {} });
    };
  }, []);

  // A change is safe in the outbox the moment it's made, but the phone's copy
  // of the lists is only written every 30 seconds. Write it within a second of
  // any change, so a restart before then still shows what was on screen.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = outbox.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveOfflineCopyNow(queryClient), 800);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [queryClient]);

  // A declined change is said in the capsule, and the "Saved" or "Added" a
  // screen might say straight after is held back, so nothing claims a save.
  useEffect(() => {
    setAccountNotifier((message) => {
      acknowledge(message, "lock");
      holdAcknowledgements(1600);
    });
    return () => setAccountNotifier(() => {});
  }, [acknowledge]);

  const projects = tasks.query.data?.projects;
  const taskRecords = tasks.query.data?.tasks;
  const noteRecords = notes.data?.notes;
  const failure = tasks.query.error ?? notes.error;
  useEffect(() => {
    const names = new Map((projects ?? []).map((project) => [project.id, project.name]));
    const ready = !!taskRecords && !!noteRecords;
    useAccountStore.setState({
      areas: (projects ?? []).map(toArea).sort(byName),
      tasks: (taskRecords ?? []).map(toTask),
      notes: (noteRecords ?? [])
        .map((note) => toNote(note, (id) => names.get(id)))
        .sort((a, b) => (a.day === b.day ? b.time.localeCompare(a.time, undefined, { numeric: true }) : a.day < b.day ? 1 : -1)),
      pages: pagesOf(noteRecords ?? []),
      ...toFocus(focus.data),
      ready,
      problem: !ready && failure ? "Your notes couldn't be fetched. Pull down to try again." : null,
    });
  }, [projects, taskRecords, noteRecords, focus.data, failure]);

  const refetchTasks = tasks.query.refetch;
  const refetchNotes = notes.refetch;
  const refetchFocus = focus.refetch;
  useEffect(() => {
    useAccountStore.setState({
      refresh: async () => {
        await Promise.all([refetchTasks(), refetchNotes(), refetchFocus()]);
      },
    });
  }, [refetchTasks, refetchNotes, refetchFocus]);

  // The actions read the latest hooks and lists through this, so they never act on a stale copy.
  const latest = useRef({ tasks, createNote, updateNote, deleteNote, recordFocus, projects, taskRecords, noteRecords });
  latest.current = { tasks, createNote, updateNote, deleteNote, recordFocus, projects, taskRecords, noteRecords };

  useEffect(() => {
    if (!editable) {
      const { addTask, updateTask, setDone, moveTask, deleteTask, clearCompleted, linkNote, unlinkNote, addArea, renameArea, deleteArea, recordFocus: record, parkThought, addNote, setNoteArea, writeNote, archiveNote, deleteNote: removeNote } = emptyAccount();
      useAccountStore.setState({ editable: false, addTask, updateTask, setDone, moveTask, deleteTask, clearCompleted, linkNote, unlinkNote, addArea, renameArea, deleteArea, recordFocus: record, parkThought, addNote, setNoteArea, writeNote, archiveNote, deleteNote: removeNote });
      return;
    }
    const projectId = (name: string | null | undefined) => (name ? latest.current.projects?.find((project) => sameName(project.name, name))?.id : undefined);
    const actions: Actions = {
      addTask: ({ title, area, day, time, noteId }) => {
        latest.current.tasks.create.mutate({ text: title, projectName: area, completeBy: day ? noonOf(day) : null, dueTime: day && time !== null ? hhmm(time) : null, noteId: noteId ?? null });
        return "";
      },
      updateTask: (id, patch) => {
        const change: TaskChange = { id };
        if (patch.title !== undefined) change.text = patch.title;
        if (patch.details !== undefined) change.description = patch.details;
        if (patch.day !== undefined) change.completeBy = patch.day ? noonOf(patch.day) : null;
        if (patch.time !== undefined) change.dueTime = patch.time !== null ? hhmm(patch.time) : null;
        if (patch.remind !== undefined) change.remindBefore = patch.remind;
        if (patch.repeat !== undefined) change.remindRepeat = patch.repeat;
        if (patch.remindOnce !== undefined) change.remindOnce = patch.remindOnce;
        if (patch.done !== undefined) change.status = patch.done ? "done" : "todo";
        if (patch.area !== undefined && patch.area !== null) {
          const known = projectId(patch.area);
          if (known) change.projectId = known;
          else {
            // A new area: made first, then the task moves into it.
            void latest.current.tasks.createProject.mutateAsync({ name: cleanName(patch.area) }).then(({ project }) => latest.current.tasks.update.mutate({ id, projectId: project.id }));
          }
        }
        if (Object.keys(change).length > 1) latest.current.tasks.update.mutate(change);
      },
      // A repeating task comes back on its next day; the main app's hook says when.
      setDone: (id, done) => {
        latest.current.tasks.update.mutate({ id, status: done ? "done" : "todo" });
        return null;
      },
      // Catch up records the day it was first planned for, once; any later move keeps that day.
      moveTask: (id, day, options) => {
        const task = latest.current.taskRecords?.find((item) => item.id === id);
        const movedFrom = options?.record && task?.completeBy && !task.movedFrom ? { movedFrom: task.completeBy } : {};
        latest.current.tasks.update.mutate({ id, completeBy: day ? noonOf(day) : null, ...movedFrom });
      },
      deleteTask: (id) => latest.current.tasks.remove.mutate({ id }),
      clearCompleted: (area) => {
        const targetId = area ? projectId(area) : undefined;
        if (area && !targetId) return 0;
        const count = (latest.current.taskRecords ?? []).filter((task) => task.status === "done" && (!targetId || task.projectId === targetId)).length;
        latest.current.tasks.clearDone.mutate(targetId ? { projectId: targetId } : {});
        return count;
      },
      linkNote: (taskId, noteId) => latest.current.tasks.link.mutate({ taskId, noteId, linked: true }),
      unlinkNote: (taskId, noteId) => latest.current.tasks.link.mutate({ taskId, noteId, linked: false }),
      addArea: (name) => {
        const clean = cleanName(name);
        if (!clean) return null;
        const existing = latest.current.projects?.find((project) => sameName(project.name, clean));
        if (existing) return existing.name;
        latest.current.tasks.createProject.mutate({ name: clean });
        return clean;
      },
      renameArea: (from, to) => {
        const clean = cleanName(to);
        const id = projectId(from);
        if (!clean || !id || latest.current.projects?.some((project) => project.id !== id && sameName(project.name, clean))) return false;
        latest.current.tasks.renameProject.mutate({ id, name: clean });
        return true;
      },
      deleteArea: (name, moveTo) => {
        const id = projectId(name);
        if (id) latest.current.tasks.deleteProject.mutate({ id, moveTasksTo: projectId(moveTo) });
      },
      recordFocus: (taskId, minutes, outcome, leftOff) =>
        latest.current.recordFocus.mutate({ taskId, plannedMinutes: Math.max(1, Math.round(minutes)), focusedSeconds: Math.round(minutes * 60), outcome, leftOff, firstStep: "", startedAt: new Date(Date.now() - minutes * 60_000) }),
      parkThought: (taskId, text) => {
        const task = latest.current.taskRecords?.find((item) => item.id === taskId);
        latest.current.createNote.mutate({ content: text.trim(), source: "focus", taskId, projectIds: task ? [task.projectId] : [] });
        return "";
      },
      addNote: ({ title, body, segments, area, page }) => {
        const id = projectId(area);
        latest.current.createNote.mutate({
          title: title.trim(),
          content: noteContent({ body, segments }),
          projectIds: id ? [id] : [],
          ...(page ? { source: "page" as const } : {}),
        });
        return "";
      },
      // Sage picks one area; any others the note has are kept.
      setNoteArea: (noteId, area) => {
        const current = latest.current.noteRecords?.find((note) => note.id === noteId);
        if (!current) return;
        const [first, ...rest] = current.projectIds;
        const id = projectId(area);
        const next = id ? [id, ...rest.filter((other) => other !== id)] : rest;
        if (first === next[0] && next.length === current.projectIds.length) return;
        latest.current.updateNote.mutate({ id: noteId, projectIds: next });
      },
      // An account's note saves from its page, words and rich text together,
      // through the outbox (src/editor/useNoteSession.ts); this is the demo's way.
      writeNote: () => {},
      archiveNote: (noteId) => latest.current.updateNote.mutate({ id: noteId, archived: true }),
      deleteNote: (noteId) => latest.current.deleteNote.mutate({ id: noteId }),
    };
    useAccountStore.setState({ editable: true, ...actions });
  }, [editable]);

  // Find tasks: the AI reads the note (once its words have reached the
  // server) and the found tasks wait on their cards. Add adds one there and
  // then; Not now is kept on the server, so it doesn't come back. Only with
  // AI help on; the samples have their own.
  useEffect(() => {
    const found = (noteId: string) => useAccountStore.getState().suggestions[noteId] ?? [];
    const setFound = (noteId: string, items: Suggestion[]) =>
      useAccountStore.setState((state) => ({ suggestions: { ...state.suggestions, [noteId]: items } }));
    const addTasks = (noteId: string, items: Suggestion[]) => {
      if (!items.length) return;
      latest.current.tasks.addSuggested.mutate({ noteId, tasks: items.map((item) => ({ text: item.title, projectName: item.area, completeBy: item.day ? noonOf(item.day) : null })) });
      const keys = new Set(items.map((item) => item.key));
      setFound(noteId, found(noteId).map((item) => (keys.has(item.key) ? { ...item, added: true } : item)));
    };
    useAccountStore.setState({
      findTasks: async (noteId) => {
        if (!aiOn()) return "none";
        try {
          await waitUntilSynced(`note:${noteId}`, 8_000);
          const { suggested, unchanged } = await latest.current.tasks.extract.mutateAsync({ noteId });
          const items: Suggestion[] = suggested.map((task, i) => ({
            key: `${noteId}:${i}:${task.text}`,
            title: task.text,
            area: task.projectName,
            day: task.completeBy ? dayOf(task.completeBy) : null,
            time: null,
            picked: true,
          }));
          useAccountStore.setState((state) => ({ suggestions: { ...state.suggestions, [noteId]: items }, searched: { ...state.searched, [noteId]: true } }));
          if (items.length) return "found";
          return unchanged ? "nothing-new" : "none";
        } catch {
          return "failed";
        }
      },
      toggleSuggestion: (noteId, key) => setFound(noteId, found(noteId).map((item) => (item.key === key ? { ...item, picked: !item.picked } : item))),
      addSuggestion: (noteId, key) => addTasks(noteId, found(noteId).filter((item) => item.key === key && !item.added)),
      addSuggestions: (noteId) => {
        const items = found(noteId).filter((item) => item.picked && !item.added);
        addTasks(noteId, items);
        return items.length;
      },
      skipSuggestion: (noteId, key) => {
        const item = found(noteId).find((suggestion) => suggestion.key === key);
        setFound(noteId, found(noteId).filter((suggestion) => suggestion.key !== key));
        if (item) void postTaskDismissSuggestion({ noteId, text: item.title }).catch(() => {});
      },
      dismissSuggestions: (noteId) => {
        for (const item of found(noteId)) if (!item.added) void postTaskDismissSuggestion({ noteId, text: item.title }).catch(() => {});
        setFound(noteId, []);
      },
    });
  }, []);

  return <ConnectionNotices />;
}

/**
 * The connection, said quietly and without counts. Going offline: "Offline.
 * Changes will sync." Back online, once whatever was waiting has gone: "All
 * changes saved". Nothing at all when nothing was waiting, or while a note is
 * being written (useQuietSyncNotices).
 */
function ConnectionNotices() {
  const acknowledge = useAcknowledge();
  const online = useOnline();
  const pending = usePendingCount();
  const offlineSaid = useRef(false);
  const waiting = useRef(false);

  useEffect(() => {
    if (!online && !offlineSaid.current) {
      offlineSaid.current = true;
      // Writing a note, nothing is said about syncing.
      if (!syncNoticesQuiet()) acknowledge("Offline. Changes will sync.", "cloudOff", 3200);
    }
    if (online) offlineSaid.current = false;
  }, [online, acknowledge]);

  useEffect(() => {
    if (!online && pending > 0) waiting.current = true;
    if (online && waiting.current && pending === 0) {
      waiting.current = false;
      if (!syncNoticesQuiet()) acknowledge("All changes saved", "cloudCheck");
    }
  }, [online, pending, acknowledge]);

  return null;
}
