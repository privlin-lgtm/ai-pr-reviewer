export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export function loadGitHubAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GitHubAppConfig {
  return {
    appId: readRequired(environment, "GITHUB_APP_ID"),
    privateKey: readRequired(environment, "GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n"),
    webhookSecret: readRequired(environment, "GITHUB_WEBHOOK_SECRET"),
  };
}

function readRequired(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
