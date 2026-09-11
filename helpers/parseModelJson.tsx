/**
 * Models occasionally wrap JSON in prose or a ``` fence. Pull the first
 * balanced JSON object out of the response instead of failing the whole
 * feature on a stray character.
 */
export function parseModelJson(raw: string): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};

  const direct = tryParse(text);
  if (direct) return direct;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParse(fenced[1].trim());
    if (parsed) return parsed;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const parsed = tryParse(text.slice(start, end + 1));
    if (parsed) return parsed;
  }

  return {};
}

function tryParse(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}