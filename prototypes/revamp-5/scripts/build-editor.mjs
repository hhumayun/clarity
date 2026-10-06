// Builds the note editor's page (editor/) into one self-contained HTML file,
// fonts and all, and writes it into src/editor/page.ts as a string the note
// page loads in a web view. Run with `npm run editor` after changing editor/.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const root = resolve("editor");
await build({
  configFile: false,
  root,
  base: "./",
  logLevel: "warn",
  plugins: [viteSingleFile()],
  build: { outDir: "dist", emptyOutDir: true, target: "es2020", reportCompressedSize: false },
});

const html = await readFile(resolve(root, "dist/index.html"), "utf8");
if (/<\/script>[\s\S]*<\/script>/i.test(html.replace(/<\/script>\s*<\/body>/i, ""))) {
  throw new Error("The built page has a stray </script>; it would end the inlined code early.");
}
// ASCII only, so the string survives any tool that reads the file.
const literal = JSON.stringify(html).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
await writeFile(
  resolve("src/editor/page.ts"),
  `// Built by \`npm run editor\` from editor/ (scripts/build-editor.mjs). Don't edit by hand.\n` +
    `// The note editor's page, whole: one HTML file with its code and fonts inside.\n` +
    `export const EDITOR_PAGE: string = ${literal};\n`,
);
console.log(`src/editor/page.ts: ${(html.length / 1024).toFixed(0)} KB`);
