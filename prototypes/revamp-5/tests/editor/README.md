# Editor tests

The main app's note editor tests (`tests/note-editor` at 4344bd8), run against revamp 5's built editor page: the string in `src/editor/page.ts`, exactly what the app loads. The page is opened in desktop Chrome and driven the way the note page drives it: the look, the note and commands go in through `clarityEditor.receive`, and what the page sends back is captured.

About 82 checks:
- the main app's: lists and checklists, Backspace at an item's start, indents, quotes, links, Markdown round trips, suggestions at the cursor, how changes are batched, and row heights;
- Sage's: questions as quotes at the end or on an empty line, today's page opening with the cursor under its question, the look's sizes and colours.

## Running them

After changing anything in `editor/`, rebuild the page first: `npm run editor`. Then:

```
PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME_PATH=/path/to/chrome node tests/editor/editor.test.js
```

`PLAYWRIGHT_CORE` defaults to `playwright-core` from the node path, and Chrome to the installed one. It exits with 0 when everything passes.

What it can't cover (Safari on the iPhone, its keyboard's compositions) is as in the main app's README: check those on a phone.
