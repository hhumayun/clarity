import "./loadEnv.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";

const app = new Hono();

const extraOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://localhost:3333",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3333",
  "https://clarity-notes-production.up.railway.app",
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
  ...extraOrigins,
]);

app.use(
  "/_api/*",
  cors({
    origin: (origin) => (origin && allowedOrigins.has(origin) ? origin : null),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  }),
);

// [method, path, endpoint module]
const routes: Array<["GET" | "POST", string, string]> = [
  ["GET", "/_api/auth/session", "./endpoints/auth/session_GET.js"],
  ["GET", "/_api/notes/get", "./endpoints/notes/get_GET.js"],
  ["GET", "/_api/notes/list", "./endpoints/notes/list_GET.js"],
  ["POST", "/_api/notes/create", "./endpoints/notes/create_POST.js"],
  ["POST", "/_api/notes/update", "./endpoints/notes/update_POST.js"],
  ["POST", "/_api/notes/delete", "./endpoints/notes/delete_POST.js"],
  ["POST", "/_api/notes/reindex", "./endpoints/notes/reindex_POST.js"],
  ["GET", "/_api/preferences", "./endpoints/preferences_GET.js"],
  ["POST", "/_api/preferences", "./endpoints/preferences_POST.js"],
  ["GET", "/_api/projects/list", "./endpoints/projects/list_GET.js"],
  ["POST", "/_api/projects/create", "./endpoints/projects/create_POST.js"],
  ["POST", "/_api/projects/update", "./endpoints/projects/update_POST.js"],
  ["POST", "/_api/projects/delete", "./endpoints/projects/delete_POST.js"],
  ["GET", "/_api/tasks/list", "./endpoints/tasks/list_GET.js"],
  ["POST", "/_api/tasks/create", "./endpoints/tasks/create_POST.js"],
  ["POST", "/_api/tasks/update", "./endpoints/tasks/update_POST.js"],
  ["POST", "/_api/tasks/delete", "./endpoints/tasks/delete_POST.js"],
  ["POST", "/_api/tasks/clear_done", "./endpoints/tasks/clear_done_POST.js"],
  ["POST", "/_api/tasks/extract", "./endpoints/tasks/extract_POST.js"],
  ["POST", "/_api/tasks/add", "./endpoints/tasks/add_POST.js"],
  ["POST", "/_api/tasks/parse", "./endpoints/tasks/parse_POST.js"],
  ["POST", "/_api/tasks/first_steps", "./endpoints/tasks/first_steps_POST.js"],
  ["POST", "/_api/focus/record", "./endpoints/focus/record_POST.js"],
  ["GET", "/_api/focus/summary", "./endpoints/focus/summary_GET.js"],
  ["POST", "/_api/suggestions/generate", "./endpoints/suggestions/generate_POST.js"],
  ["POST", "/_api/suggestions/event", "./endpoints/suggestions/event_POST.js"],
  ["GET", "/_api/account/export", "./endpoints/account/export_GET.js"],
  ["POST", "/_api/account/delete", "./endpoints/account/delete_POST.js"],
  [
    "POST",
    "/_api/account/clear_personalization",
    "./endpoints/account/clear_personalization_POST.js",
  ],
];

for (const [method, path, modulePath] of routes) {
  const handler = async (c: any) => {
    try {
      const { handle } = await import(modulePath);
      const response = await handle(c.req.raw);
      if (
        !(response instanceof Response) &&
        response.constructor.name !== "Response"
      ) {
        return c.text(
          "Invalid response format. handle should always return a Response object. " +
            response.constructor.name,
          500,
        );
      }
      return response;
    } catch (e: any) {
      console.error(e);
      return c.text("Error loading endpoint code " + e.message, 500);
    }
  };
  if (method === "GET") app.get(path, handler);
  else app.post(path, handler);
}

app.use("/*", serveStatic({ root: "./static" }));
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", async (c, next) => {
  const p = c.req.path;
  if (p.startsWith("/_api")) {
    return next();
  }
  return serveStatic({ path: "./dist/index.html" })(c, next);
});

const port = Number(process.env.PORT) || 3333;
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`Running at http://localhost:${port}`);
