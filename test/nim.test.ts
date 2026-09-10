import assert from "node:assert/strict";
import test from "node:test";

process.env.GITHUB_APP_ID = "1";
process.env.GITHUB_PRIVATE_KEY = "key";
process.env.GITHUB_WEBHOOK_SECRET = "1234567890123456";
process.env.NIM_BASE_URL = "https://nim.example.test/v1";
process.env.NIM_API_KEY_1 = "primary";
process.env.NIM_API_KEY_2 = "fallback";
process.env.NIM_MODEL = "test-model";

const { reviewDiff } = await import("../src/nim.js");

function response(score = 91): Response {
  return Response.json({
    choices: [{ message: { content: JSON.stringify({ score, summary: "ok", findings: [] }) } }]
  });
}

test("reviews a diff with the primary key", async () => {
  const keys: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    keys.push((init?.headers as Record<string, string>).authorization);
    return response();
  };

  const result = await reviewDiff("diff");

  assert.equal(result.score, 91);
  assert.deepEqual(keys, ["Bearer primary"]);
});

test("fails over to the second key on 429", async () => {
  const keys: unknown[] = [];
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    keys.push((init?.headers as Record<string, string>).authorization);
    calls++;
    return calls === 1 ? new Response("busy", { status: 429 }) : response(88);
  };

  const result = await reviewDiff("diff");

  assert.equal(result.score, 88);
  assert.deepEqual(keys, ["Bearer primary", "Bearer fallback"]);
});
