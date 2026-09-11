import { createHash } from "node:crypto";

export function taskContentHash(title: string, content: string): string {
  return createHash("sha256").update(title).update("\0").update(content).digest("hex");
}
