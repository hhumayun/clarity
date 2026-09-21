/**
 * Thin wrapper around the OpenRouter chat-completions API, used by the
 * suggestion engine, task extraction and entity indexing. Backend only.
 *
 * Set OPENROUTER_API_KEY in the environment. OPENROUTER_MODEL is optional and
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

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Flash-class models answer short structured prompts in under a second and do
// not spend hidden reasoning tokens first. Measured on 2026-09-21:
// deepseek/deepseek-v4.1-flash ~0.9s for a 3-item JSON response.
export const DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4.1-flash";

// Tried in order when the primary model is rate-limited or overloaded.
const FALLBACK_MODELS = (
  process.env.OPENROUTER_FALLBACK_MODELS ?? "deepseek/deepseek-v4-flash"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

function getApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Get a key from https://openrouter.ai/keys and add it to your environment.",
    );
  }
  return apiKey;
}

/** Error carrying the HTTP status returned by OpenRouter. */
class OpenRouterError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenRouterError";
    this.status = status;
  }
}

function getStatus(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

function isRetryable(error: unknown): boolean {
  const status = getStatus(error);
  // 429 rate limited; 502/503 upstream provider busy; 408 upstream timeout.
  return (
    status === 429 || status === 502 || status === 503 || status === 408
  );
}

function mapError(error: unknown): never {
  const status = getStatus(error);
  const message = error instanceof Error ? error.message : String(error);
  // OpenRouter answers 402 when the account is out of credits.
  if (status === 402) {
    throw new AiOutOfCreditsError(message);
  }
  if (status === 429) {
    if (message.toLowerCase().includes("quota")) {
      throw new AiOutOfCreditsError(message);
    }
    throw new AiRateLimitError(message);
  }
  if (status === 502 || status === 503 || status === 408) {
    throw new AiRateLimitError(message);
  }
  throw error;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function generateOnce(
  model: string,
  opts: { systemPrompt: string; userPrompt: string; maxOutputTokens?: number },
): Promise<string> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      // Optional attribution headers used by OpenRouter's dashboard.
      "HTTP-Referer": "https://clarity-notes-production.up.railway.app",
      "X-Title": "Clarity Notes",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      max_tokens: opts.maxOutputTokens ?? 2_000,
      response_format: { type: "json_object" },
      // Keep reasoning off so the answer is not delayed by hidden tokens.
      reasoning: { enabled: false },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new OpenRouterError(
      response.status,
      `OpenRouter ${response.status}: ${body.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    error?: { message?: string; code?: number };
  };

  // OpenRouter can return a 200 whose body carries an error instead of choices.
  if (data.error) {
    throw new OpenRouterError(
      data.error.code ?? 500,
      data.error.message ?? "OpenRouter returned an error",
    );
  }

  return data.choices?.[0]?.message?.content ?? "";
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
