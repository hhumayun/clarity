import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/**
 * Thin wrapper around the Gemini API used by the suggestion engine, task
 * extraction and entity indexing. Backend only.
 *
 * Set GEMINI_API_KEY in the environment. GEMINI_MODEL is optional and
 * defaults to a fast flash model, which keeps short, structured generation
 * tasks responsive.
 */

export class AiOutOfCreditsError extends Error {
  constructor(message?: string) {
    super(message ?? "AI quota exceeded");
    this.name = "AiOutOfCreditsError";
  }
}

export class AiRateLimitError extends Error {
  constructor(message?: string) {
    super(message ?? "AI rate limit exceeded");
    this.name = "AiRateLimitError";
  }
}

// The "lite" flash models answer short structured prompts in under a second
// and do not spend hidden thinking tokens first. Measured on 2026-09-11:
// gemini-3.5-flash ~10s (plus frequent 503s), gemini-3.5-flash-lite ~0.85s.
export const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";

// Tried in order when the primary model is rate-limited or overloaded.
const FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-lite-latest,gemini-3.1-flash-lite"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Get a key from Google AI Studio and add it to your environment.",
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

function getStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

function isRetryable(error: unknown): boolean {
  const status = getStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    status === 429 ||
    status === 503 ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("UNAVAILABLE")
  );
}

function mapError(error: unknown): never {
  const status = getStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  if (status === 429 || message.includes("RESOURCE_EXHAUSTED")) {
    if (message.toLowerCase().includes("quota")) {
      throw new AiOutOfCreditsError(message);
    }
    throw new AiRateLimitError(message);
  }
  if (status === 503 || message.includes("UNAVAILABLE")) {
    throw new AiRateLimitError(message);
  }
  throw error;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generateOnce(
  model: string,
  opts: { systemPrompt: string; userPrompt: string; maxOutputTokens?: number },
): Promise<string> {
  const response = await getClient().models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
    config: {
      systemInstruction: opts.systemPrompt,
      maxOutputTokens: opts.maxOutputTokens ?? 2_000,
      responseMimeType: "application/json",
      // Lite models do not think; for models that do, keep it minimal so
      // the answer is not delayed by hidden reasoning tokens.
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    },
  });
  // Read the parts directly: the SDK's response.text getter can be
  // undefined when thought parts are present alongside the answer.
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter(
      (part) =>
        !(part as { thought?: boolean }).thought &&
        typeof part.text === "string",
    )
    .map((part) => part.text as string)
    .join("");
}

/**
 * Ask the model for a JSON response and return the raw text. Callers parse
 * and validate with parseModelJson. Retries transient failures once, then
 * falls back through FALLBACK_MODELS so a busy or quota-limited model never
 * silently breaks suggestions.
 */
export async function aiChatJson(opts: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxOutputTokens?: number;
}): Promise<string> {
  const primary = opts.model ?? DEFAULT_MODEL;
  const chain = [primary, ...FALLBACK_MODELS.filter((m) => m !== primary)];

  let lastError: unknown;
  for (const model of chain) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await generateOnce(model, opts);
      } catch (error) {
        lastError = error;
        if (!isRetryable(error)) mapError(error);
        if (attempt === 0) await sleep(800);
      }
    }
    console.warn(`model ${model} unavailable, trying next fallback`);
  }
  mapError(lastError);
}
