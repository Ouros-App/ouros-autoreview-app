# Ouros Auto Approver

Organization-wide GitHub App that reacts to `/auto-review` on pull requests and approves only when all gates pass.

## Gates

1. PR is not draft/conflicted.
2. CI/check-runs are complete and green.
3. Sonar/Quality Gate is green.
4. No active `CHANGES_REQUESTED` review.
5. No unresolved CodeRabbit or Sonar review thread.
6. AI review score is at least `MIN_SCORE` (default 85).
7. AI review reports no HIGH/CRITICAL findings.
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

## Groq failover

The project uses Groq by default through its OpenAI-compatible endpoint at `{NIM_BASE_URL}/chat/completions`.

Configure two independent Groq API keys:

```env
GROQ_API_KEY_1=gsk-primary-...
GROQ_API_KEY_2=gsk-fallback-...
```

The bot sends both keys in parallel, returns the first valid review and cancels the other request. `NIM_API_KEY_1`, `NIM_API_KEY_2` and `NIM_API_KEY` remain accepted as legacy aliases.

## Infisical

The service loads runtime secrets from Infisical using Universal Auth. Configure these variables on Discloud:

```env
INFISICAL_SITE_URL=https://app.infisical.com
INFISICAL_CLIENT_ID=...
INFISICAL_CLIENT_SECRET=...
INFISICAL_PROJECT_ID=...
INFISICAL_ENVIRONMENT=prod
INFISICAL_SECRET_PATH=/
```

Store the GitHub and Groq variables as secrets in the selected Infisical project/environment. For local development, omit the Infisical variables and fill `.env` directly.

## Run

```bash
cp env.example .env
npm install
npm run dev
```

Docker:

```bash
docker build -t ouros-auto-approver .
docker run --env-file .env -p 8080:8080 ouros-auto-approver
```

Use it by commenting on a PR:

```text
/auto-review
```

Only organization owners, members, or collaborators can trigger the command.
