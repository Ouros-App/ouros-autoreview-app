import { config } from "./config.js";
import {
  checkCiAndSonar,
  checkReviewsAndThreads,
  createApproval,
  createComment,
  getPullAndDiff,
  installationOctokit
} from "./github.js";
import { reviewDiff } from "./nim.js";
import type { PullContext } from "./types.js";

/** Formats the decision and gate results for a pull-request comment or review. */
function formatResult(args: { approved: boolean; score?: number; summary?: string; blockers: string[]; warnings: string[]; sha: string; }) {
  const { approved, score, summary, blockers, warnings, sha } = args;
  const lines = [
    `## 🤖 Ouros Auto Approval`,
    "",
    `**Decision:** ${approved ? "APPROVED ✅" : "BLOCKED ❌"}`,
    score === undefined ? "**NIM score:** unavailable" : `**NIM score:** ${score}/100`,
    `**Commit:** \`${sha.slice(0, 12)}\``
  ];
  if (summary) lines.push("", summary);
  if (blockers.length) lines.push("", "### Blockers", ...blockers.map(v => `- ${v}`));
  if (warnings.length) lines.push("", "### Warnings", ...warnings.map(v => `- ${v}`));
  return lines.join("\n");
}

/** Runs all approval gates and publishes either an approval or blocking comment. */
export async function runAutoReview(ctx: PullContext) {
  const octokit = await installationOctokit(ctx.installationId);
  const { pull, diff } = await getPullAndDiff(octokit, ctx);
  const initialSha = pull.head.sha;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (pull.draft) blockers.push("Pull request is still a draft.");
  if (pull.mergeable !== true) blockers.push("Pull request mergeability is not confirmed.");

  const [ci, reviews] = await Promise.all([
    checkCiAndSonar(octokit, ctx, initialSha),
    checkReviewsAndThreads(octokit, ctx)
  ]);
  blockers.push(...ci.blockers, ...reviews.blockers);
  warnings.push(...ci.warnings, ...reviews.warnings);

  let nim;
  try {
    nim = await reviewDiff(diff);
    if (nim.score < config.MIN_SCORE) blockers.push(`NIM score ${nim.score} is below required ${config.MIN_SCORE}.`);
    const severe = nim.findings.filter(f => f.severity === "high" || f.severity === "critical");
    if (severe.length) blockers.push(`NIM found ${severe.length} HIGH/CRITICAL issue(s).`);
  } catch (error) {
    blockers.push(`NIM review failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const { data: latestPull } = await octokit.pulls.get({ owner: ctx.owner, repo: ctx.repo, pull_number: ctx.pullNumber });
  if (latestPull.head.sha !== initialSha) blockers.push("New commits were pushed while the bot was reviewing. Run /auto-review again.");

  const body = formatResult({ approved: blockers.length === 0, score: nim?.score, summary: nim?.summary, blockers, warnings, sha: initialSha });
  if (blockers.length === 0) {
    await createApproval(octokit, ctx, initialSha, body);
    return { approved: true, body };
  }
  await createComment(octokit, ctx, body);
  return { approved: false, body };
}
