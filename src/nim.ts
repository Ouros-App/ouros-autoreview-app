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
    message: z.string().min(1).max(1200)
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
async function requestWithKey(apiKey: string, body: unknown, keyIndex: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.NIM_TIMEOUT_MS);

  try {
    return await fetch(`${config.NIM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(`NIM key #${keyIndex + 1} network request failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
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
          "Prioritize correctness, security, data loss, concurrency, auth, validation, migrations, API compatibility and tests.",
          "Do not lower a score for pure style preferences.",
          "A score >= 85 means the change is safe enough to approve if external gates also pass.",
          "Any high or critical finding must make the score lower than 85.",
          "Return JSON only with: score:number, summary:string, findings:[{path,line?,severity,category,message}]."
        ].join(" ")
      },
      { role: "user", content: `Review this pull-request diff:\n\n${clipped}` }
    ]
  };

  const errors: string[] = [];
  for (let index = 0; index < config.NIM_API_KEYS.length; index++) {
    const apiKey = config.NIM_API_KEYS[index];
    let response: Response;
    try {
      response = await requestWithKey(apiKey, body, index);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      if (index + 1 < config.NIM_API_KEYS.length) {
        console.warn(`NIM key #${index + 1} failed at network level; trying fallback key.`);
        continue;
      }
      break;
    }

    if (!response.ok) {
      const responseBody = (await response.text()).slice(0, 1000);
      errors.push(`NIM key #${index + 1}: HTTP ${response.status} ${responseBody}`);
      if (shouldFailOver(response.status) && index + 1 < config.NIM_API_KEYS.length) {
        console.warn(`NIM key #${index + 1} returned ${response.status}; trying fallback key.`);
        continue;
      }
      break;
    }

    const payload: any = await response.json();
    const text = payload?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error(`Unexpected NIM response shape from key #${index + 1}`);
    return reviewSchema.parse(extractJson(text));
  }

  throw new Error(`All configured NIM credentials failed. ${errors.join(" | ")}`);
}
