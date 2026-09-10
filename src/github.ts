import crypto from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";
import { config } from "./config.js";
import type { GateResult, PullContext } from "./types.js";

export function verifyWebhookSignature(rawBody: Buffer, signature?: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", config.GITHUB_WEBHOOK_SECRET).update(rawBody).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function installationOctokit(installationId: number): Promise<Octokit> {
  const auth = createAppAuth({
    appId: config.GITHUB_APP_ID,
    privateKey: config.GITHUB_PRIVATE_KEY,
    installationId
  });
  const { token } = await auth({ type: "installation" });
  return new Octokit({ auth: token });
}

export async function canRunAutoReview(octokit: Octokit, owner: string, repo: string, login: string): Promise<boolean> {
  const { data } = await octokit.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
  return ["admin", "maintain", "push"].includes(data.permission);
}

export async function getPullAndDiff(octokit: Octokit, ctx: PullContext) {
  const { data: pull } = await octokit.pulls.get({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber
  });

  const diffResponse = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    headers: { accept: "application/vnd.github.v3.diff" }
  });

  return { pull, diff: String(diffResponse.data) };
}

export async function checkCiAndSonar(octokit: Octokit, ctx: PullContext, sha: string): Promise<GateResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const [{ data: combined }, { data: checkRuns }] = await Promise.all([
    octokit.repos.getCombinedStatusForRef({ owner: ctx.owner, repo: ctx.repo, ref: sha }),
    octokit.checks.listForRef({ owner: ctx.owner, repo: ctx.repo, ref: sha, per_page: 100 })
  ]);

  if (combined.state === "failure" || combined.state === "error") {
    blockers.push(`Commit status is ${combined.state}.`);
  } else if (combined.state === "pending") {
    blockers.push("Commit status is still pending.");
  }

  for (const run of checkRuns.check_runs) {
    const name = run.name.toLowerCase();
    const isSonar = config.SONAR_IDENTIFIERS.some((id: string) => name.includes(id));
    const conclusion = run.conclusion;

    if (run.status !== "completed") {
      blockers.push(`${run.name} is still ${run.status}.`);
      continue;
    }

    if (["failure", "cancelled", "timed_out", "action_required"].includes(conclusion ?? "")) {
      blockers.push(`${run.name} failed (${conclusion}).`);
      continue;
    }

    if (isSonar && !["success", "neutral", "skipped"].includes(conclusion ?? "")) {
      blockers.push(`Sonar quality check is not green (${run.name}: ${conclusion ?? "unknown"}).`);
    }
  }

  if (checkRuns.total_count === 0 && combined.total_count === 0) {
    warnings.push("No CI/check-runs were found for this commit.");
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export async function checkReviewsAndThreads(octokit: Octokit, ctx: PullContext): Promise<GateResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const { data: reviews } = await octokit.pulls.listReviews({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    per_page: 100
  });

  const latest = new Map<string, string>();
  for (const review of reviews) {
    const login = review.user?.login?.toLowerCase();
    if (!login || !review.state) continue;
    latest.set(login, review.state.toUpperCase());
  }

  for (const [login, state] of latest) {
    if (state === "CHANGES_REQUESTED") {
      blockers.push(`${login} has an active CHANGES_REQUESTED review.`);
    }
  }

  const coderabbitReviews = reviews.filter(r => {
    const login = r.user?.login?.toLowerCase() ?? "";
    return config.CODERABBIT_LOGINS.some((id: string) => login === id || login.includes("coderabbit"));
  });
  if (coderabbitReviews.some(r => r.state?.toUpperCase() === "CHANGES_REQUESTED")) {
    blockers.push("CodeRabbit requested changes.");
  }

  const query = `
    query($owner:String!, $repo:String!, $number:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$number) {
          reviewThreads(first:100) {
            nodes {
              isResolved
              comments(first:20) {
                nodes { body author { login } }
              }
            }
          }
        }
      }
    }
  `;

  const gql: any = await octokit.graphql(query, {
    owner: ctx.owner,
    repo: ctx.repo,
    number: ctx.pullNumber
  });

  const threads = gql?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
  for (const thread of threads) {
    if (thread.isResolved) continue;
    const comments = thread.comments?.nodes ?? [];
    const authors = comments.map((c: any) => String(c.author?.login ?? "").toLowerCase());
    const fromCodeRabbit = authors.some((a: string) => config.CODERABBIT_LOGINS.some((id: string) => a === id || a.includes("coderabbit")));
    const fromSonar = authors.some((a: string) => config.SONAR_IDENTIFIERS.some((id: string) => a.includes(id)));

    if (fromCodeRabbit || fromSonar) {
      blockers.push(`Unresolved ${fromCodeRabbit ? "CodeRabbit" : "Sonar"} review thread.`);
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

export async function createApproval(octokit: Octokit, ctx: PullContext, sha: string, body: string) {
  return octokit.pulls.createReview({
    owner: ctx.owner,
    repo: ctx.repo,
    pull_number: ctx.pullNumber,
    commit_id: sha,
    body,
    event: "APPROVE"
  });
}

export async function createComment(octokit: Octokit, ctx: PullContext, body: string) {
  return octokit.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.pullNumber,
    body
  });
}
