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

/** Identifies HTTP statuses that should trigger the next NIM credential. */
function shouldFailOver(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

/** Sends one review request to NIM with a bounded timeout. */
async function requestWithKey(apiKey: string, body: unknown, keyIndex: number, parentSignal: AbortSignal): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.NIM_TIMEOUT_MS);
  const signal = AbortSignal.any([parentSignal, controller.signal]);

  try {
    return await fetch(`${config.NIM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? `timed out after ${config.NIM_TIMEOUT_MS}ms`
      : `network request failed: ${error instanceof Error ? error.message : String(error)}`;
    throw new Error(`NIM key #${keyIndex + 1} ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

type Attempt = { review?: NimReview; error?: string; retry: boolean };

/** Performs one NIM attempt and reports whether the next key should be used. */
async function attemptReview(apiKey: string, body: unknown, keyIndex: number, hasFallback: boolean, signal: AbortSignal): Promise<Attempt> {
  const response = await requestWithKey(apiKey, body, keyIndex, signal);
  if (!response.ok) {
    const responseBody = (await response.text()).slice(0, 1000);
    return {
      error: `NIM key #${keyIndex + 1}: HTTP ${response.status} ${responseBody}`,
      retry: hasFallback && shouldFailOver(response.status)
    };
  }

  const payload: unknown = await response.json();
  const text = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    .choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error(`Unexpected NIM response shape from key #${keyIndex + 1}`);
  return { review: reviewSchema.parse(extractJson(text)), retry: false };
}

/** Reviews a pull-request diff and returns the validated NIM result. */
export async function reviewDiff(diff: string): Promise<NimReview> {
  const maxChars = 120_000;
  const clipped = diff.length > maxChars ? `${diff.slice(0, maxChars)}\n\n[DIFF TRUNCATED]` : diff;
  const body = {
    model: config.NIM_MODEL,
    temperature: 0.1,
    max_tokens: 4096,
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

  const controllers = config.NIM_API_KEYS.map(() => new AbortController());
  const attempts = config.NIM_API_KEYS.map((apiKey, index) =>
    attemptReview(apiKey, body, index, false, controllers[index].signal).catch((error): Attempt => ({
      error: error instanceof Error ? error.message : String(error),
      retry: false
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
    throw new Error(`All configured NIM credentials failed. ${errors.join(" | ")}`);
  }
}
