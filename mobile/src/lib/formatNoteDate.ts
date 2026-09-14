export function formatNoteDate(value: Date): string {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.floor((startOfDay(now) - startOfDay(value)) / 86_400_000);

  if (days <= 0) {
    return value.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return value.toLocaleDateString(undefined, { weekday: "long" });
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
