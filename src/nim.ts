import { z } from "zod";
import { config } from "./config.js";
import type { NimReview } from "./types.js";

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(1).max(2000),
  findings: z.array(z.object({
    path: z.string().min(1),
    line: z.number().int().positive().optional(),
    severity: z.enum(["info", "low", "medium", "high", "critical"]),
    category: z.string().min(1),
    message: z.string().min(1).max(1200),
    suggestion: z.string().min(1).max(1200).optional()
  })).max(100)
});

/** Extracts and validates the structured review object returned by NIM. */
function extractJson(text: string): unknown {
  const fenceStart = text.indexOf("```");
  const contentStart = fenceStart >= 0 ? text.indexOf("\n", fenceStart) : -1;
  const fenceEnd = contentStart >= 0 ? text.indexOf("```", contentStart + 1) : -1;
  const candidate = contentStart >= 0 && fenceEnd > contentStart
    ? text.slice(contentStart + 1, fenceEnd)
    : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("NIM response did not contain a JSON object");
  return JSON.parse(candidate.slice(start, end + 1));
}

type ProviderConfig = (typeof config.AI_PROVIDERS)[number];

/** Sends one review request with a bounded timeout. */
async function requestWithKey(provider: ProviderConfig, apiKey: string, body: unknown, keyIndex: number, parentSignal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs);
  const signal = AbortSignal.any([parentSignal, controller.signal]);

  try {
    return await fetch(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `timed out after ${provider.timeoutMs}ms`
      : `network request failed: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(`${provider.name} key #${keyIndex + 1} ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

type Attempt = { review?: NimReview; error?: string };

/** Performs one NIM attempt and reports its review or error. */
async function attemptReview(provider: ProviderConfig, apiKey: string, body: unknown, keyIndex: number, signal: AbortSignal): Promise<Attempt> {
  const response = await requestWithKey(provider, apiKey, body, keyIndex, signal);
  if (!response.ok) {
    const responseBody = (await response.text()).slice(0, 1000);
    return {
      error: `${provider.name} key #${keyIndex + 1}: HTTP ${response.status} ${responseBody}`
    };
  }

  const payload: unknown = await response.json();
  const text = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error(`Unexpected NIM response shape from key #${keyIndex + 1}`);
  return { review: reviewSchema.parse(extractJson(text)) };
}

/** Reviews a pull-request diff with one provider and its key failover. */
async function reviewWithProvider(diff: string, provider: ProviderConfig): Promise<NimReview> {
  const maxChars = 20_000;
  const clipped = diff.length > maxChars ? `${diff.slice(0, maxChars)}\n\n[DIFF TRUNCATED]` : diff;
  const body = {
    model: provider.model,
    temperature: 0.1,
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: [
          "You are a conservative pull-request code reviewer.",
          "Review ONLY the supplied diff.",
          "Report only problems introduced by changed lines; do not report unrelated pre-existing code.",
          "Prioritize correctness, security, data loss, concurrency, auth, validation, migrations, API compatibility and tests.",
          "Do not lower a score for pure style preferences.",
          "A score >= 85 means the change is safe enough to approve if external gates also pass.",
          "Any high or critical finding must make the score lower than 85.",
          "For each real problem, identify the exact changed file and line from the diff hunk; do not invent a line.",
          "Explain why the line is wrong, its concrete impact, and the smallest safe correction.",
          "Sort findings by severity, with critical and high first.",
          "Return JSON only with: score:number, summary:string, findings:[{path,line?,severity,category,message,suggestion?}]."
        ].join(" ")
      },
      { role: "user", content: `Review this pull-request diff:\n\n${clipped}` }
    ]
  };

  if (!provider.apiKeys.length) throw new Error(`${provider.name} has no configured API keys.`);
  const controllers = provider.apiKeys.map(() => new AbortController());
  const attempts = provider.apiKeys.map((apiKey, index) =>
    attemptReview(provider, apiKey, body, index, controllers[index].signal).catch((error): Attempt => ({
      error: error instanceof Error ? error.message : String(error)
    }))
  );
  try {
    const review = await Promise.any(attempts.map(async attemptPromise => {
      const attempt = await attemptPromise;
      if (attempt.review) return attempt.review;
      throw new Error(attempt.error ?? "NIM key failed.");
    }));
    controllers.forEach(controller => controller.abort());
    return review;
  } catch {
    const results = await Promise.all(attempts);
    const errors = results.map(attempt => attempt.error ?? "NIM key failed.");
    throw new Error(`All configured ${provider.name} credentials failed. ${errors.join(" | ")}`);
  }
}

/** Reviews a pull-request diff with Groq first and NIM as fallback. */
export async function reviewDiff(diff: string): Promise<NimReview> {
  const errors: string[] = [];
  for (const provider of config.AI_PROVIDERS) {
    try {
      return await reviewWithProvider(diff, provider);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All AI providers failed. ${errors.join(" | ")}`);
}
