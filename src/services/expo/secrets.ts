import { getSecure } from '../storage/SecureStorage';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';

export async function hasConfiguredGithubToken(): Promise<boolean> {
  return Boolean((await getSecure('GITHUB_TOKEN'))?.trim());
}

async function resolveConfiguredSecretValue(
  secretRef: string | undefined,
  missingReason: string,
): Promise<string> {
  const value = secretRef ? await getSecure(secretRef) : '';
  if (!value?.trim()) {
    throw new Error(missingReason);
  }
  return value.trim();
}

async function resolveExpoAccountToken(account: ExpoAccountConfig): Promise<string> {
  return resolveConfiguredSecretValue(account.tokenRef, 'missing-expo-token');
}

async function resolveProjectGithubToken(
  project: Pick<ExpoProjectConfig, 'githubTokenRef'>,
): Promise<string> {
  return resolveConfiguredSecretValue(
    project.githubTokenRef || 'GITHUB_TOKEN',
    'missing-github-token',
  );
}

async function tryResolveProjectGithubToken(
  project: Pick<ExpoProjectConfig, 'githubTokenRef'>,
): Promise<string | undefined> {
  try {
    return await resolveProjectGithubToken(project);
  } catch {
    return undefined;
  }
}

export { resolveExpoAccountToken, resolveProjectGithubToken, tryResolveProjectGithubToken };
