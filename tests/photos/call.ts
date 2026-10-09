// Calls one exported function of a server helper, in-process, and prints its
// result as one line "RESULT <json>". Used by the photo checks for things no
// endpoint does (the sweep, account deletion without Clerk, a link signed for
// one second). Run with tsx from the worktree root, with the local stack's
// variables (lib.mjs callHelper does both):
//
//   tsx tests/photos/call.ts helpers/attachmentSweep.tsx sweepAttachments '[{"daily":true}]'
//
// An argument "$bucket" is replaced by the helper bucket()'s answer.
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function main() {
  const [modulePath, exportName, argsJson = "[]"] = process.argv.slice(2);
  if (!modulePath || !exportName) throw new Error("usage: call.ts <module> <export> [json args]");
  const mod: Record<string, unknown> = await import(pathToFileURL(resolve(process.cwd(), modulePath)).href);
  const fn = mod[exportName];
  if (typeof fn !== "function") throw new Error(`${modulePath} has no function ${exportName}`);
  let args = JSON.parse(argsJson) as unknown[];
  if (args.includes("$bucket")) {
    const bucketModule: Record<string, unknown> = await import(pathToFileURL(resolve(process.cwd(), "helpers/bucket.tsx")).href);
    const b = (bucketModule.bucket as () => unknown)();
    args = args.map((a) => (a === "$bucket" ? b : a));
  }
  // CALL_WAIT_FOR_GO=1 (race-check.mjs): load everything first, say READY, and call only when a
  // line arrives on stdin, so the call starts within milliseconds of the request it races.
  if (process.env.CALL_WAIT_FOR_GO === "1") {
    console.log("READY");
    await new Promise<void>((go) => {
      // The check went away without saying go: don't run at all.
      const gone = () => process.exit(3);
      process.stdin.once("end", gone);
      process.stdin.once("data", () => {
        process.stdin.off("end", gone);
        process.stdin.pause();
        go();
      });
    });
  }
  const result = await (fn as (...a: unknown[]) => unknown)(...args);
  console.log(`RESULT ${JSON.stringify(result ?? null)}`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exit(1);
  },
);
