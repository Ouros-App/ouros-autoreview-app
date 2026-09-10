import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  NIM_BASE_URL: z.string().url().default("https://api.groq.com/openai/v1"),
  GROQ_API_KEY_1: z.string().optional(),
  GROQ_API_KEY_2: z.string().optional(),
  NIM_API_KEY: z.string().optional(),
  NIM_API_KEY_1: z.string().optional(),
  NIM_API_KEY_2: z.string().optional(),
  NIM_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
  NIM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
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
const nimApiKeys = [env.GROQ_API_KEY_1 ?? env.NIM_API_KEY_1 ?? env.NIM_API_KEY, env.GROQ_API_KEY_2 ?? env.NIM_API_KEY_2]
  .filter((value): value is string => Boolean(value?.trim()))
  .map(value => value.trim())
  .filter((value, index, all) => all.indexOf(value) === index);

export const config = {
  ...env,
  GITHUB_PRIVATE_KEY: env.GITHUB_PRIVATE_KEY.replaceAll(String.raw`\n`, "\n"),
  NIM_API_KEYS: nimApiKeys,
  CODERABBIT_LOGINS: env.CODERABBIT_LOGINS.split(",").map((v: string) => v.trim().toLowerCase()).filter(Boolean),
  SONAR_IDENTIFIERS: env.SONAR_IDENTIFIERS.split(",").map((v: string) => v.trim().toLowerCase()).filter(Boolean)
};
