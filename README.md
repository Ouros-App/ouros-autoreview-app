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

## Groq primary and NIM fallback

The project uses Groq as the primary provider and NVIDIA NIM as fallback. Each provider has an independent endpoint, model, timeout and key set.

Configure two independent Groq API keys:

```env
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEY_1=gsk-primary-...
GROQ_API_KEY_2=gsk-fallback-...
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TIMEOUT_MS=90000
NIM_BASE_URL=https://integrate.api.nvidia.com/v1
NIM_API_KEY_1=nvapi-primary-...
NIM_API_KEY_2=nvapi-fallback-...
NIM_MODEL=google/gemma-4-31b-it
NIM_TIMEOUT_MS=90000
```

The bot tries Groq first, sends its keys in parallel, returns the first valid review and cancels the other request. Only if all Groq keys fail does it try NIM the same way. `NIM_API_KEY_1`, `NIM_API_KEY_2` and `NIM_API_KEY` remain accepted as legacy aliases for NIM.

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
