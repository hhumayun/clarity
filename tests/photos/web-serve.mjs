// The web app (pages/, the note editor of docs/photos-server.md 10.2) against the local server:
// Vite's dev server from this worktree's own vite.config.ts on http://localhost:9401, with /_api
// sent to the local server on :3410 instead of the config's :3333. Started by `./stack.sh web`,
// which hands it VITE_CLERK_PUBLISHABLE_KEY read from Railway at run time (Clerk's dev instance,
// a publishable key; never written to a file). Writes nothing inside the repo but Vite's
// dependency cache in node_modules/.vite.
import { createServer } from "vite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const PORT = Number(process.env.WEB_PORT || 9401);
const API = process.env.API || "http://localhost:3410";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(API)) throw new Error(`API must be local, not ${API}`);
if (!process.env.VITE_CLERK_PUBLISHABLE_KEY) throw new Error("VITE_CLERK_PUBLISHABLE_KEY is not set (./stack.sh web reads it)");
// The web app would send /_api to production if this were set.
delete process.env.VITE_API_BASE_URL;

const server = await createServer({
  root: HERE_ROOT,
  configFile: join(HERE_ROOT, "vite.config.ts"),
  envDir: "/nonexistent-env-dir", // never read a .env from the worktree
  clearScreen: false,
  logLevel: "warn",
  server: { port: PORT, strictPort: true, host: "127.0.0.1", proxy: { "/_api": API } },
});
await server.listen();
console.log(`web app: http://localhost:${PORT} (/_api to ${API})`);
