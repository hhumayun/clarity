/** Stable project matching without changing the user's displayed spelling. */
export function normalizeProjectName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
