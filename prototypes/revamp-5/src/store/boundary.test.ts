// @ts-nocheck -- a plain script for Node, which runs .ts files directly.
// Run from the project root: /opt/node24/bin/node src/store/boundary.test.ts
// Metro never loads this file.
//
// The sample notes and the real ones never meet. The sample store
// (src/store) is in memory only: it must not reach the code that talks to
// Clarity's server (src/core), nor anything that sends or queues a request.
// The server code must not read the samples, and neither may the account
// side of the data layer (src/data). Only the switch, src/data/sage.ts,
// knows both. If any line is crossed, this fails.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
const imports = (file: string): string[] => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
// Imports that bring code, not only types (an `import type` vanishes when the app is built).
const codeImports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s*["']([^"']+)["']/gms)].filter((match) => !match[2]).map((match) => match[3]);
const inside = (file: string, spec: string, area: string) => spec.startsWith(".") && resolve(dirname(file), spec).startsWith(join(root, area));

// Packages that send, queue or authorise requests.
const NETWORK = ["@tanstack/react-query", "@clerk/clerk-expo", "superjson", "@react-native-async-storage/async-storage", "@react-native-community/netinfo"];

let failures = 0;
const fail = (message: string) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};

for (const file of files(join(root, "src/store"))) {
  const where = relative(root, file);
  for (const spec of imports(file)) {
    if (inside(file, spec, "src/core")) fail(`${where} imports the server code (${spec})`);
    if (NETWORK.includes(spec)) fail(`${where} imports ${spec}, which talks to the network or the outbox`);
  }
  if (/\bfetch\s*\(/.test(readFileSync(file, "utf8"))) fail(`${where} calls fetch`);
}
// Your account's side (src/data, apart from the switch itself) may use the
// samples' types and pure helpers, but never the sample store or its data.
for (const file of files(join(root, "src/data"))) {
  const where = relative(root, file);
  if (where === "src/data/sage.ts") continue;
  for (const spec of codeImports(file)) {
    const target = spec.startsWith(".") ? relative(root, resolve(dirname(file), spec)) : spec;
    if (target === "src/store/store" || target === "src/store/seed") fail(`${where} imports the sample data (${spec})`);
  }
}
for (const file of files(join(root, "src/core"))) {
  for (const spec of imports(file)) if (inside(file, spec, "src/store")) fail(`${relative(root, file)} reads the sample store (${spec})`);
}

console.log(failures ? `\n${failures} boundary problems` : "PASS the sample store and the server code stay apart");
process.exit(failures ? 1 : 0);
