# Rich text notes: a plan

Written 2 October 2026. **Nothing here is built yet.** It answers "how can we
make the editor rich text, with links, photos, attachments and indentation?"

---

## Where things stand

- A note is a title and one plain-text string, `notes.content`.
- The phone edits it in a React Native `TextInput` (with the cursor-following
  work from 7c4b32c). The web edits it in an auto-growing `<textarea>`
  (`pages/note.$noteId.tsx`).
- Everything else reads that same string:
  - **AI:** finding tasks (`extractTasks`, re-run when `contentHash` changes),
    suggestions and questions while writing (from the text before the cursor),
    title ideas, task summaries.
  - **Search:** `ilike` on the text (`helpers/listNotesPage.tsx`).
  - **Previews and derived titles:** `displayTitle` on the phone, the cards on
    the web.
  - **Offline:** local drafts and the outbox's `note.create` / `note.update`
    carry the string.
  - **Export** and the entity index.

Whatever we choose should leave all of that working.

---

## The three decisions

### 1. How a note is stored: Markdown, in the same `content` column

- Bold, headings, lists, checkboxes, quotes and links are all plain text in
  Markdown. So search, the AI features, drafts, the outbox and export keep
  working on a string, and the models read Markdown natively.
- **Indentation** is nested lists: bullets, numbers and checkboxes inside one
  another.
- **Photos and files** are links to an attachment id, never to a file URL
  (those expire):
  - `![](attachment:3f2c…)` for a photo;
  - `[Quote.pdf](attachment:9a1b…)` for a file.
- **Old notes must not be misread.** Plain text is not quite Markdown:
  - a single line break in Markdown joins two lines into one;
  - a line starting with `#` becomes a heading;
  - `*word*` becomes italic.

  So a new `notes.format` column marks each note `plain` (every note today) or
  `markdown`. A plain note opens with its lines kept exactly as written. Its
  first save from the new editor stores it as Markdown and flips the mark.
  Notes are only converted when someone edits them, so the AI does not
  re-process the whole library at once.
- **Considered and not chosen:**
  - **Editor JSON** (ProseMirror or Lexical) beside the text: exact, but two
    copies to keep in step, and it ties the data to one editor.
  - **HTML:** the format of Software Mansion's native editor. It is harder to
    feed to search and the AI.

### 2. The editor: Tiptap, run inside the app as an Expo DOM component

- **DOM components** (`'use dom'`) run web React code in a web view inside the
  app.
  - They **work in Expo Go**: on SDK 56 and later they use `@expo/dom-webview`
    with nothing to install.
  - The app calls into the editor through `useDOMImperativeHandle`. The editor
    calls back through async function props.
- **Tiptap** is built on ProseMirror. It has mature support for:
  - nested lists, with indent and outdent;
  - checklists;
  - links, including auto-linking and links on paste;
  - images, paste handling, undo and redo.

  Its official `@tiptap/markdown` extension reads and writes Markdown, but it
  is marked an early release. The spike tests it on real notes.
- **The same editor goes on the web**, in place of the textarea, so a note
  behaves the same everywhere.
- **The browser keeps the cursor in view while typing.** The React Native text
  bugs we worked around stop applying to the note body.
- **Costs:**
  - A web view takes a moment to start. Measure it, and if needed keep one warm
    editor ready.
  - Text selection and the keyboard behave as in Safari, not as in a native
    field.
  - The AI features have to talk to the editor across the bridge.
- **Alternatives:**
  - **TenTap** (Tiptap packaged for React Native): Expo Go supports only basic
    use. Custom pieces (Markdown, attachments) need a development build.
  - **react-native-enriched-html** (Software Mansion, fully native): the most
    native feel; stores HTML.
    - Needs a development build, not Expo Go.
    - Its docs don't say whether it supports nested lists.
  - **react-native-enriched-markdown** (also native, Markdown): its input only
    does bold, italic and links today. Lists, headings and images are on its
    roadmap.
- **Revisit if we move to development builds anyway** (calendar integration
  needs them too). A native editor is then a fair contender.

### 3. Where photos and files live: a Railway Bucket

- Railway Buckets are private S3-compatible storage inside the existing Railway
  project.
- Signed links let the phone upload and download directly, without passing
  files through our server, and downloads through them cost nothing.
- Files are private: no public links, only short-lived signed ones.

---

## If we move to development builds (EAS)

A development build is our own copy of the app, built in the cloud by EAS
Build and installed on the phone in place of Expo Go. Day to day nothing
changes: it loads the code from the same dev server, with the same live
reload. Only adding a native library needs a new build, which takes roughly
15 to 30 minutes in the cloud.

**What it changes for rich text:**

- **The editor stops being limited to web views.** The spike becomes a
  bake-off on real notes:
  - **Native:** react-native-enriched-html, a real iOS text view. It has the
    best writing feel: autocorrect, dictation and selection as in Notes, and
    no start-up wait.
  - **Tiptap in a web view:** TenTap or a DOM component. With a development
    build TenTap can take custom pieces (Markdown, attachments) and handles the
    keyboard toolbar for us.
  - **The test:** writing feel, nested lists, checklists, inline photos, and
    whether the editor exposes the cursor so the AI suggestions keep working.
- **Storage follows the winner.** It stays Markdown if Tiptap wins. If the
  native editor wins, keep its HTML and a plain-text copy for search and the
  AI, rather than converting Markdown both ways on every save.
- **Photos and files are unchanged.**

**Other things it opens up:**

- Calendar integration (`expo-calendar`).
- A share extension, to send links, photos and files from other apps into a
  note. This pairs well with attachments.
- Document scanning.
- Widgets.
- Fixing the text-field jump at its source, with React Native's upstream patch.
- TestFlight and the App Store (EAS Submit).
- Code updates without a rebuild (EAS Update).

**What it needs:**

- **An Apple Developer Program membership** ($99 a year). It is needed to
  install our own build on a real iPhone.
- **The phone registered once** (`eas device:create`).
- **The first build's Apple sign-in**, done by you: it is interactive, with
  two-factor. Alternatively, an App Store Connect API key stored on EAS.
- **The mobile app linked to an EAS project.** The repo root already has one
  (`clarity`, owner hhumayun, bundle id `com.hhumayun.clarity`). `mobile/`
  is not linked yet: it has its own slug, `clarity-notes`, and bundle id
  `app.claritynotes.mobile`.
  - We choose one bundle id. It is permanent once the app is on the App Store.
- **`expo-dev-client`, and a `mobile/eas.json`.**
- **EAS free plan:** 15 iOS builds a month, in a low-priority queue. Starter is
  $19 a month.

---

## Phases

### Phase 0: spike (small)

Build the editor on a branch, in the note page only. Check:

- **Speed:** how long a note takes to open and typing latency, on a long note.
- **Keyboard:** our toolbar above the keyboard. Can the web view's own
  "‹ › Done" bar above the keyboard be hidden?
- **Scrolling:** with the keyboard up, on long notes.
- **Markdown round trip:** existing notes through `@tiptap/markdown`, including
  the plain-to-Markdown conversion.
- **AI bridge:** suggestions from the text before the cursor, and inserting
  them.
- **Hiding the keyboard while the AI tray is open:** `inputmode="none"` on the
  editor should keep the cursor with the keyboard down.
- **Layout:** do the title and area chips go inside the editor's web view? The
  page then scrolls as one, as it does now. Or stay native above it?

Then decide whether to go ahead.

### Phase 1: formatting and links (large)

- **Data:**
  - migration 013 adds `notes.format` (`plain` by default). It needs your
    go-ahead before it is applied to the production database, and it goes out
    before any code that reads the column;
  - create and update accept `format`.
- **Editor:**
  - text styles: title, heading and body;
  - bold, italic and strikethrough;
  - bullet, numbered and check lists, with indent and outdent (toolbar, and Tab
    or Shift-Tab on a keyboard);
  - quote, and undo and redo;
  - Markdown shortcuts as you type: `- `, `1. `, `[] `, `# `.
- **Toolbar above the keyboard:** Aa (styles), checklist, list, indent,
  outdent, link, photo and file.
- **Links:**
  - web addresses become links as typed or pasted;
  - select some words and tap the link button to add, edit or remove a link;
  - tapping a link while editing offers Open, Edit or Remove; Open uses the
    in-app browser.
- **The note page keeps everything it has:**
  - autosave, drafts and the outbox (still a string);
  - the title and area chips;
  - AI suggestions and questions, and the AI tray;
  - the Tasks tab.
- **Everywhere else:**
  - previews and derived titles drop the Markdown symbols, on both phone and
    web;
  - the AI prompts say the text is Markdown, and attachment links are taken out
    before it is sent.
- **Web:** the textarea is replaced by the same editor.

### Phase 2: photos (large)

*Started on 2026-10-09 in revamp 5 (`prototypes/revamp-5/docs/editor-plan.md`, section 10): photos in the editor, kept on the phone, in the samples only. This app's editor keeps photos in notes, each shown as an outline. The server's part below is next.*

- **Server:**
  - **Storage:** the Bucket, and an `attachments` table (id, user, note,
    photo/file, name, type, size, width, height, storage key, status, created).
  - **Endpoints:**
    - start an upload, which returns a signed upload link;
    - confirm the upload;
    - get a short-lived viewing link;
    - delete.
  - **Limits:** a size cap per file and a quota per person.
  - **Cleanup:**
    - photos removed from a note are deleted after a grace period;
    - deleting a note or the account deletes its files;
    - export includes the files.
- **Phone:**
  - **Picking:** the library or the camera (`expo-image-picker`), shrunk to
    about 2048 px (`expo-image-manipulator`). Both work in Expo Go.
  - The photo shows in the note at once, from the phone's copy, and uploads
    through the outbox, so it works offline and retries until it lands.
  - **Viewing:** a tap opens a full-screen viewer, with zoom, share and delete.
- **Lists:** a note card shows a thumbnail when the note has photos.

### Phase 3: files (medium)

- Pick any file (`expo-document-picker`). It shows as a chip with an icon, its
  name and its size.
- Tapping a file downloads it and opens the share sheet or a preview.
- On the web, files can be dragged in or pasted.

### Later ideas

- Link previews (the page's title and icon), fetched by the server with care.
- Links from one note to another.
- Scanning documents (needs a development build).
- Reading text in photos with AI.
- Turning a checklist item into a task.

---

## Risks

- The editor may not feel native enough, or may start too slowly. The spike
  answers this before anything else is built.
- Markdown round trips may have edge cases (the extension is young). They are
  tested on real notes first, and plain notes are only converted when edited.
- Offline photo uploads are the most involved part, because the outbox gains
  file uploads.
- Storage costs grow with photos. Shrinking photos, and the quota, keep them
  small.

---

## Questions to settle

1. **Expo Go or a development build?** The web view editor works in Expo Go
   today. A native editor needs a development build (and an Apple developer
   account), which calendar integration needs too.
2. **Indentation:** is indenting lists enough, or should plain paragraphs
   indent too? Markdown has no paragraph indent. It would need a quote or a
   custom block.
3. **Checklists and tasks:** should note checklists stay separate from Clarity
   tasks, or should a checklist item be able to become a task?
4. **Storage:** is a Railway Bucket (billed by usage) all right? What size
   limits: about 10 MB per photo and 25 MB per file?
5. **The web:** should the web editor change at the same time as the phone?

---

## Sources

- Expo, DOM components: https://docs.expo.dev/guides/dom-components/
- Tiptap, Markdown: https://tiptap.dev/docs/editor/markdown
- TenTap: https://10play.github.io/10tap-editor/docs/intro.html
- react-native-enriched-html: https://docs.swmansion.com/react-native-enriched-html/
- react-native-enriched-markdown: https://github.com/software-mansion/enriched-markdown
- Railway Buckets: https://docs.railway.com/storage-buckets
