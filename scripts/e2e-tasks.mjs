// End-to-end test of the tasks pipeline + Life Center data against the
// locally running server (http://localhost:3333).
//
//   node scripts/e2e-tasks.mjs
//
// Creates a test note, extracts tasks with Gemini, lists/updates/deletes
// tasks and projects — exactly what the Life Center page does.
import fs from "fs";
import superjson from "superjson";

// --- load .env ---------------------------------------------------------------
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const key = t.slice(0, eq).trim();
  if (process.env[key] === undefined) process.env[key] = t.slice(eq + 1).trim();
}

const BASE = process.env.BASE_URL ?? "http://localhost:3333";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY missing from .env");

// --- get a Clerk session token for the first user ----------------------------
async function clerkApi(path, options = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Clerk ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const users = await clerkApi("/users?limit=1");
if (users.length === 0) throw new Error("No Clerk users found — sign up in the app first.");
const userId = users[0].id;
console.log(`Testing as Clerk user ${userId} (${users[0].email_addresses?.[0]?.email_address})`);

const session = await clerkApi("/sessions", {
  method: "POST",
  body: JSON.stringify({ user_id: userId }),
});
const { jwt: token } = await clerkApi(`/sessions/${session.id}/tokens`, {
  method: "POST",
  body: JSON.stringify({}),
});
if (!token) throw new Error("Could not mint a session token");

// --- API helpers --------------------------------------------------------------
async function api(method, path, body) {
  const res = await fetch(`${BASE}/_api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : superjson.stringify(body),
  });
  const text = await res.text();
  const parsed = text ? superjson.parse(text) : null;
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

let failures = 0;
function check(label, condition, detail = "") {
  const ok = Boolean(condition);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// --- 1. create a note ----------------------------------------------------------
console.log("\n== Notes ==");
const { note } = await api("POST", "/notes/create", {
  title: "Errands and plans",
  content:
    "I need to call Dr. Lee on Monday morning to reschedule the appointment. " +
    "Buy groceries for Mom this weekend. " +
    "Finish reading the book club novel by Friday. " +
    "It was good to see Sarah at the park yesterday.",
});
check("create note", note?.id, `id=${note?.id}`);

// --- 2. extract tasks (Gemini) -------------------------------------------------
console.log("\n== Task extraction (Gemini) — suggests, never auto-adds ==");
let aiAvailable = true;
try {
  const first = await api("POST", "/tasks/extract", { noteId: note.id });
  check("extract returns suggestions", Array.isArray(first.suggested) && first.suggested.length > 0, `${first.suggested?.length} suggested`);
  check("extract adds nothing by itself", first.added === undefined);

  // Nothing should exist yet — the writer has not chosen anything.
  const beforeAdd = await api("GET", `/tasks/list?noteId=${note.id}`);
  check("no tasks in the note before choosing", beforeAdd.tasks.length === 0);

  // Choose all but the last suggestion.
  const chosen = first.suggested.slice(0, -1);
  const addRes = await api("POST", "/tasks/add", { noteId: note.id, tasks: chosen });
  check("chosen suggestions are added", addRes.added === chosen.length, `${addRes.added} added`);
  const afterAdd = await api("GET", `/tasks/list?noteId=${note.id}`);
  check("only chosen tasks exist", afterAdd.tasks.length === chosen.length, `${afterAdd.tasks.length} in note`);

  // Adding the same suggestions again must not duplicate.
  const again = await api("POST", "/tasks/add", { noteId: note.id, tasks: chosen });
  check("re-adding the same suggestions adds none", again.added === 0);

  // A second look at the unchanged note short-circuits without an AI call.
  const second = await api("POST", "/tasks/extract", { noteId: note.id });
  check("unchanged note returns nothing new", second.unchanged === true && second.suggested.length === 0);
} catch (error) {
  if (/OUT_OF_CREDITS|429|503/.test(error.message)) {
    aiAvailable = false;
    console.log("SKIP  Gemini quota exhausted — AI steps skipped, everything else still runs");
  } else {
    throw error;
  }
}

// --- 3. Life Center data: list tasks + projects --------------------------------
console.log("\n== Life Center (tasks/list) ==");
const list = await api("GET", "/tasks/list");
check("tasks list returns tasks", Array.isArray(list.tasks) && list.tasks.length > 0, `${list.tasks?.length} tasks`);
check("tasks list returns projects", Array.isArray(list.projects) && list.projects.length > 0, `${list.projects?.length} projects`);
check("tasks belong to projects", list.tasks.every((t) => list.projects.some((p) => p.id === t.projectId)));
for (const p of list.projects) {
  const count = list.tasks.filter((t) => t.projectId === p.id).length;
  console.log(`       project "${p.name}" — ${count} task(s)`);
}
for (const t of list.tasks) {
  console.log(`       [${t.status}] ${t.text}${t.completeBy ? ` (by ${new Date(t.completeBy).toISOString().slice(0, 10)})` : ""}`);
}

// --- 4. update a task ------------------------------------------------------------
console.log("\n== Task update ==");
const first = list.tasks[0];
if (first) {
  const { task: updated } = await api("POST", "/tasks/update", { id: first.id, status: "done" });
  check("mark task done", updated?.status === "done", updated?.text);
} else {
  console.log("SKIP  no tasks to update");
}

// --- 5. delete a task ------------------------------------------------------------
console.log("\n== Task delete ==");
const second = list.tasks[1];
if (second) {
  await api("POST", "/tasks/delete", { id: second.id });
  const after = await api("GET", "/tasks/list");
  check(
    "task deleted",
    !after.tasks.some((t) => t.id === second.id),
    second.text,
  );
} else {
  console.log("SKIP  only one task extracted, nothing to delete");
}

// --- 6. projects endpoint ---------------------------------------------------------
console.log("\n== Projects ==");
const { projects } = await api("GET", "/projects/list");
check("projects list", Array.isArray(projects) && projects.length > 0, `${projects?.length} projects`);

// --- 7. manual task creation (Add a task) --------------------------------------------
console.log("\n== Manual tasks (tasks/create) ==");
const stamp = Date.now();
const { project: tempProject } = await api("POST", "/projects/create", { name: `E2E Temp ${stamp}` });
check("create temp project", tempProject?.id, tempProject?.name);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const { task: manual } = await api("POST", "/tasks/create", {
  text: "Manually added from the Life Center",
  projectId: tempProject.id,
  completeBy: tomorrow,
});
check("create task with projectId", manual?.id && manual.status === "todo", manual?.text);
check("manual task carries project name", manual?.projectName === tempProject.name);
check("manual task has no note", manual?.noteId === null);

const { task: fromNote } = await api("POST", "/tasks/create", {
  text: "Manually added from the note editor",
  projectName: `E2E Temp ${stamp}`, // same name, different case-insensitive path -> reuse
  noteId: note.id,
  status: "in_progress",
});
check("create task by projectName reuses project", fromNote?.projectId === tempProject.id);
check("create task links to note", fromNote?.noteId === note.id && fromNote.status === "in_progress");

const noteList = await api("GET", `/tasks/list?noteId=${note.id}`);
check("note-scoped list includes manual task", noteList.tasks.some((t) => t.id === fromNote.id));

// Re-extracting must not remove or duplicate manual tasks, and must not
// re-suggest anything already in the list.
if (aiAvailable) {
  const reextract = await api("POST", "/tasks/extract", { noteId: note.id });
  const afterReextract = await api("GET", `/tasks/list?noteId=${note.id}`);
  check(
    "manual task survives re-extraction",
    afterReextract.tasks.some((t) => t.id === fromNote.id),
    `re-extract suggested ${reextract.suggested.length}`,
  );
  check(
    "manual task not duplicated",
    afterReextract.tasks.filter((t) => t.text === fromNote.text).length === 1,
  );
  check(
    "already-added tasks are not re-suggested",
    !reextract.suggested.some((s) => s.text === fromNote.text),
  );
} else {
  console.log("SKIP  re-extraction checks (Gemini quota)");
}

let bad = null;
try { await api("POST", "/tasks/create", { text: "no project" }); } catch (e) { bad = e; }
check("create without project is rejected", bad !== null);

// --- 8. rename project ------------------------------------------------------------------
console.log("\n== Project rename (projects/update) ==");
const { project: renamed } = await api("POST", "/projects/update", { id: tempProject.id, name: `E2E Renamed ${stamp}` });
check("rename project", renamed?.name === `E2E Renamed ${stamp}`);
const afterRename = await api("GET", "/tasks/list");
check(
  "tasks reflect new project name",
  afterRename.tasks.filter((t) => t.projectId === tempProject.id).every((t) => t.projectName === renamed.name),
);
let clash = null;
try { await api("POST", "/projects/update", { id: tempProject.id, name: projects[0].name.toUpperCase() }); } catch (e) { clash = e; }
check("rename to an existing name is rejected", clash !== null && /already have a project/i.test(clash.message), clash?.message);

// --- 9. clear completed (tasks/clear_done) -----------------------------------------------
console.log("\n== Clear completed (tasks/clear_done) ==");
await api("POST", "/tasks/update", { id: manual.id, status: "done" });
const { cleared } = await api("POST", "/tasks/clear_done", { projectId: tempProject.id });
check("clear completed in project", cleared === 1, `cleared ${cleared}`);
const afterClear = await api("GET", "/tasks/list");
check("cleared task is gone", !afterClear.tasks.some((t) => t.id === manual.id));
check("open task in project untouched", afterClear.tasks.some((t) => t.id === fromNote.id));

// --- 10. delete project with move (projects/delete) ---------------------------------------
console.log("\n== Project delete (projects/delete) ==");
const { project: sink } = await api("POST", "/projects/create", { name: `E2E Sink ${stamp}` });
const del = await api("POST", "/projects/delete", { id: tempProject.id, moveTasksTo: sink.id });
check("delete project moves tasks", del.deleted && del.movedTasks === 1, `moved ${del.movedTasks}`);
const afterDelete = await api("GET", "/tasks/list");
const movedTask = afterDelete.tasks.find((t) => t.id === fromNote.id);
check("moved task now in sink project", movedTask?.projectId === sink.id && movedTask.projectName === sink.name);
check("old project gone", !afterDelete.projects.some((p) => p.id === tempProject.id));

const del2 = await api("POST", "/projects/delete", { id: sink.id });
check("delete project without move removes its tasks", del2.deleted && del2.removedTasks === 1, `removed ${del2.removedTasks}`);
const finalList = await api("GET", "/tasks/list");
check("sink project gone", !finalList.projects.some((p) => p.id === sink.id));
check("its task gone", !finalList.tasks.some((t) => t.id === fromNote.id));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
