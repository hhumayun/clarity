# Where src/core comes from

These files are copied unchanged from the main app's `mobile/src` at commit 44abd69 (branch dev-build-editor-lab, 2026-10-05). The blob id identifies the exact version, so drift can be checked with `git rev-parse <commit>:mobile/src/<file>`.

Only `providers/ToastProvider.tsx` is new. It keeps the main app's `useToast().show(message)` and shows messages in Sage's acknowledgement capsule.

When a file here has to change, note it below the table with the reason. Bring later fixes from the main app across deliberately, and update the blob id.

| File | Blob at 44abd69 |
|---|---|
| `types.ts` | `f1bc4c9bea` |
| `api/account.ts` | `6eaf77dc95` |
| `api/apiFetch.ts` | `2235aa023a` |
| `api/focus.ts` | `93aaab598e` |
| `api/notes.ts` | `0e59075a74` |
| `api/parse.ts` | `d8218ae8d8` |
| `api/session.ts` | `605e43095f` |
| `api/suggestions.ts` | `743fbcb8c6` |
| `api/tasks.ts` | `57aa244060` |
| `sync/cache.ts` | `b7f2d018fb` |
| `sync/network.ts` | `82f33d8d1b` |
| `sync/outbox.ts` | `13e0ec1620` |
| `sync/persist.ts` | `612d84c2e8` |
| `sync/runner.ts` | `3435c51c26` |
| `sync/store.ts` | `fcc206eeb6` |
| `sync/SyncProvider.tsx` | `0ed6f4fdb0` |
| `lib/dates.ts` | `31be15ff39` |
| `lib/taskDates.ts` | `8375640444` |
| `lib/notesList.ts` | `9baa34d331` |
| `lib/noteTitle.ts` | `277e1bafe0` |
| `lib/taskSort.ts` | `6525fcdaf2` |
| `lib/taskLinks.ts` | `69016eedd0` |
| `lib/reminderRules.ts` | `3ccefc41d9` |
| `lib/reminders.ts` | `29bf6d1af1` |
| `lib/notifications.ts` | `df725dc432` |
| `lib/focus.ts` | `5828da6d8e` |
| `lib/lifeCenter.ts` | `a6ad919232` |
| `lib/localDrafts.ts` | `e2b2e6857a` |
| `lib/noteDocs.ts` | `4b619ab3ad` |
| `lib/perf.ts` | `567f975f3a` |
| `lib/focusAlerts.ts` | `e9db916245` |
| `hooks/useNotes.ts` | `d04a831c62` |
| `hooks/useTasks.ts` | `09a784a849` |
| `hooks/useFocus.ts` | `c22ba6308d` |
| `hooks/usePreferences.ts` | `ba3c978665` |
| `hooks/useSuggestions.ts` | `0786f47df8` |
| `providers/AuthProvider.tsx` | `ba96408808` |

## Local changes

None yet.
