import { InfisicalSDK } from "@infisical/sdk";

/** Loads Infisical secrets into the process environment before configuration parsing. */
export async function loadSecrets(): Promise<void> {
  const clientId = process.env.INFISICAL_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_CLIENT_SECRET;
  const projectId = process.env.INFISICAL_PROJECT_ID;
  if (!clientId && !clientSecret && !projectId) return;
  if (!clientId || !clientSecret || !projectId) {
    throw new Error("INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET and INFISICAL_PROJECT_ID are required together");
  }

  const client = new InfisicalSDK({
    siteUrl: process.env.INFISICAL_SITE_URL ?? "https://app.infisical.com"
  });
  await client.auth().universalAuth.login({ clientId, clientSecret });
  const result = await client.secrets().listSecrets({
    environment: process.env.INFISICAL_ENVIRONMENT ?? "prod",
    projectId,
    secretPath: process.env.INFISICAL_SECRET_PATH ?? "/",
    viewSecretValue: true
  });

  for (const secret of result.secrets ?? []) {
    if (secret.secretKey && secret.secretValue !== undefined) {
      process.env[secret.secretKey] = secret.secretValue;
    }
  }
}
