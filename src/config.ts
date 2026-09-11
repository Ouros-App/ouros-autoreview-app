import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  GROQ_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_API_KEY_1: z.string().optional(),
  GROQ_API_KEY_2: z.string().optional(),
  GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
  GROQ_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  NIM_BASE_URL: z.string().url().default("https://integrate.api.nvidia.com/v1"),
  NIM_API_KEY: z.string().optional(),
  NIM_API_KEY_1: z.string().optional(),
  NIM_API_KEY_2: z.string().optional(),
  NIM_MODEL: z.string().min(1).default("google/gemma-4-31b-it"),
  NIM_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  MIN_SCORE: z.coerce.number().min(0).max(100).default(85),
  COMMAND: z.string().default("/auto-review"),
  CODERABBIT_LOGINS: z.string().default("coderabbitai,coderabbitai[bot]"),
  SONAR_IDENTIFIERS: z.string().default("sonar,sonarqube,sonarcloud")
}).superRefine((env: { GROQ_API_KEY_1?: string; GROQ_API_KEY_2?: string; NIM_API_KEY_1?: string; NIM_API_KEY_2?: string; NIM_API_KEY?: string }, ctx: z.RefinementCtx) => {
  if (!env.GROQ_API_KEY_1 && !env.GROQ_API_KEY_2 && !env.NIM_API_KEY_1 && !env.NIM_API_KEY_2 && !env.NIM_API_KEY) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["GROQ_API_KEY_1"], message: "Set GROQ_API_KEY_1 or a legacy NIM_API_KEY_1/NIM_API_KEY" });
  }
});

const env = schema.parse(process.env);
const keys = (...values: (string | undefined)[]) => values
  .filter((value): value is string => Boolean(value?.trim()))
  .map(value => value.trim())
  .filter((value, index, all) => all.indexOf(value) === index);

export const config = {
  ...env,
  GITHUB_PRIVATE_KEY: env.GITHUB_PRIVATE_KEY.replaceAll(String.raw`\n`, "\n"),
  AI_PROVIDERS: [
    { name: "NIM", baseUrl: env.NIM_BASE_URL, model: env.NIM_MODEL, timeoutMs: env.NIM_TIMEOUT_MS, apiKeys: keys(env.NIM_API_KEY_1 ?? env.NIM_API_KEY, env.NIM_API_KEY_2) },
    { name: "Groq", baseUrl: env.GROQ_BASE_URL, model: env.GROQ_MODEL, timeoutMs: env.GROQ_TIMEOUT_MS, apiKeys: keys(env.GROQ_API_KEY_1, env.GROQ_API_KEY_2) }
  ],
  CODERABBIT_LOGINS: env.CODERABBIT_LOGINS.split(",").map((v: string) => v.trim().toLowerCase()).filter(Boolean),
  SONAR_IDENTIFIERS: env.SONAR_IDENTIFIERS.split(",").map((v: string) => v.trim().toLowerCase()).filter(Boolean)
};
