import fs from "fs";

// Load environment variables from env.json or .env for local development.
// Real environment variables (e.g. set by Railway) always take precedence.

function apply(entries) {
  for (const [key, value] of Object.entries(entries)) {
    if (process.env[key] === undefined && typeof value === "string") {
      process.env[key] = value;
    }
  }
}

try {
  if (fs.existsSync("env.json")) {
    apply(JSON.parse(fs.readFileSync("env.json", "utf8")));
  }
} catch (e) {
  console.warn("Could not parse env.json:", e.message);
}

try {
  if (fs.existsSync(".env")) {
    const entries = {};
    for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      entries[key] = value;
    }
    apply(entries);
  }
} catch (e) {
  console.warn("Could not parse .env:", e.message);
}
