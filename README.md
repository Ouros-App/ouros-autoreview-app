# Ouros Auto Approver

Organization-wide GitHub App that reacts to `/auto-review` on pull requests and approves only when all gates pass.

## Gates

1. PR is not draft/conflicted.
2. CI/check-runs are complete and green.
3. Sonar/Quality Gate is green.
4. No active `CHANGES_REQUESTED` review.
5. No unresolved CodeRabbit or Sonar review thread.
6. NVIDIA NIM score is at least `MIN_SCORE` (default 85).
7. NIM reports no HIGH/CRITICAL findings.
8. The reviewed head SHA is still current before approval.

If all gates pass, the GitHub App submits an `APPROVE` review anchored to the reviewed commit. Otherwise it posts a blocking summary comment.

## GitHub App permissions

- Pull requests: **Read & write**
- Issues: **Read & write**
- Checks: **Read-only**
- Commit statuses: **Read-only**
- Contents: **Read-only**
- Metadata: **Read-only**

Subscribe to the **Issue comment** event and point the webhook to:

```text
https://your-domain.example/webhooks/github
```

## NVIDIA NIM failover

The project calls the OpenAI-compatible NIM endpoint at `{NIM_BASE_URL}/chat/completions`.

Configure two independent NVIDIA API keys:

```env
NIM_API_KEY_1=nvapi-primary-...
NIM_API_KEY_2=nvapi-fallback-...
```

The bot tries key #1 first. It automatically switches to key #2 if the first request gets `429`, `401/403`, `408`, a `5xx`, a timeout, or a network failure. A successful request is not duplicated. `NIM_API_KEY` is still accepted as a legacy alias for key #1.

## Run

```bash
cp env.example .env
npm install
npm run dev
```

Docker:

```bash
docker build -t ouros-auto-approver .
docker run --env-file .env -p 3000:3000 ouros-auto-approver
```

Use it by commenting on a PR:

```text
/auto-review
```

Only organization owners, members, or collaborators can trigger the command.
