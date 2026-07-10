import type { AppSettings } from '../../../types/settings';
import type { ExpoAccountConfig, ExpoProjectConfig } from '../../../types/remote';
import type {
  ExpoGraphqlEnvelope,
  ExpoGraphqlErrorEntry,
  ExpoGraphqlProjectNode,
} from '../contracts';
import {
  getExpoAccounts,
  normalizeExpoOwner,
  normalizeExpoProjectRef,
  resolveExpoProject,
  trimToUndefined,
} from '../projectState';

const EXPO_GRAPHQL_URL = 'https://api.expo.dev/graphql';

export type ExpoGraphqlRequestErrorKind = 'http' | 'graphql' | 'contract';

export class ExpoGraphqlRequestError extends Error {
  constructor(
    message: string,
    readonly kind: ExpoGraphqlRequestErrorKind,
    readonly status: number | null,
    readonly codes: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ExpoGraphqlRequestError';
  }
}

function formatExpoGraphqlErrors(errors?: ExpoGraphqlErrorEntry[] | null): Array<{
  message: string;
  path?: string;
  code?: string;
}> {
  return (errors || []).map((entry) => {
    const message = trimToUndefined(entry.message) || 'expo-graphql-error';
    const path =
      Array.isArray(entry.path) && entry.path.length > 0
        ? entry.path.map((segment) => String(segment)).join('.')
        : undefined;
    const extensions =
      entry.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
        ? (entry.extensions as Record<string, unknown>)
        : undefined;
    const rawCode =
      typeof extensions?.code === 'string'
        ? extensions.code
        : typeof extensions?.errorCode === 'string'
          ? extensions.errorCode
          : undefined;
    const code = trimToUndefined(rawCode);

    return {
      message,
      ...(path ? { path } : {}),
      ...(code ? { code } : {}),
    };
  });
}

function describeExpoGraphqlErrors(errors?: ExpoGraphqlErrorEntry[] | null): string | undefined {
  const formatted = formatExpoGraphqlErrors(errors);
  if (formatted.length === 0) {
    return undefined;
  }

  return formatted
    .map((entry) => (entry.path ? `${entry.message} (path: ${entry.path})` : entry.message))
    .join('; ');
}

async function fetchExpoGraphqlEnvelope<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<{
  response: Response;
  payload: ExpoGraphqlEnvelope<T> | null;
  rawText: string;
}> {
  const response = await fetch(EXPO_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  let rawText = '';
  if (typeof response.text === 'function') {
    rawText = await response.text().catch(() => '');
  } else if (typeof response.json === 'function') {
    const payload = await response.json().catch(() => null);
    rawText = payload == null ? '' : JSON.stringify(payload);
  }

  if (!trimToUndefined(rawText)) {
    return { response, payload: null, rawText };
  }

  try {
    return {
      response,
      payload: JSON.parse(rawText) as ExpoGraphqlEnvelope<T>,
      rawText,
    };
  } catch {
    if (!response.ok) {
      throw new ExpoGraphqlRequestError(
        trimToUndefined(rawText) || `expo-graphql-${response.status}`,
        'http',
        response.status,
      );
    }
    throw new ExpoGraphqlRequestError('expo-graphql-invalid-response', 'contract', response.status);
  }
}

async function expoGraphqlRequest<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const { response, payload, rawText } = await fetchExpoGraphqlEnvelope<T>(token, query, variables);

  if (!response.ok) {
    const errorMessage =
      describeExpoGraphqlErrors(payload?.errors) ||
      trimToUndefined(rawText) ||
      `expo-graphql-${response.status}`;
    throw new ExpoGraphqlRequestError(
      errorMessage,
      'http',
      response.status,
      formatExpoGraphqlErrors(payload?.errors)
        .map((entry) => entry.code)
        .filter((code): code is string => Boolean(code)),
    );
  }

  if (payload?.errors?.length) {
    throw new ExpoGraphqlRequestError(
      describeExpoGraphqlErrors(payload.errors) || 'expo-graphql-error',
      'graphql',
      response.status,
      formatExpoGraphqlErrors(payload.errors)
        .map((entry) => entry.code)
        .filter((code): code is string => Boolean(code)),
    );
  }

  if (payload?.data === undefined || payload.data === null) {
    throw new ExpoGraphqlRequestError('expo-graphql-empty-response', 'contract', response.status);
  }

  return payload.data;
}

function getRepoFullNameFromExpoNode(project: ExpoGraphqlProjectNode): string | undefined {
  const owner = trimToUndefined(project.githubRepository?.metadata?.githubRepoOwnerName);
  const repo = trimToUndefined(project.githubRepository?.metadata?.githubRepoName);
  return owner && repo ? `${owner}/${repo}` : undefined;
}

function collectExpoGraphqlProjectRefs(variables: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const addStringValue = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = trimToUndefined(value);
    if (trimmed) {
      refs.push(trimmed);
    }
  };
  const addSingleArrayValue = (value: unknown) => {
    if (!Array.isArray(value) || value.length !== 1) {
      return;
    }
    addStringValue(value[0]);
  };

  addStringValue(variables.projectId);
  addStringValue(variables.appId);
  addStringValue(variables.easProjectId);
  addStringValue(variables.experienceId);
  addStringValue(variables.fullName);
  addStringValue(variables.appFullName);
  addStringValue(variables.projectFullName);
  addStringValue(variables.experienceName);
  addStringValue(variables.appIdentifier);
  addSingleArrayValue(variables.projectIds);
  addSingleArrayValue(variables.appIds);

  const owner =
    typeof variables.owner === 'string'
      ? trimToUndefined(variables.owner)
      : typeof variables.accountName === 'string'
        ? trimToUndefined(variables.accountName)
        : undefined;
  const slug =
    typeof variables.slug === 'string'
      ? trimToUndefined(variables.slug)
      : typeof variables.projectSlug === 'string'
        ? trimToUndefined(variables.projectSlug)
        : typeof variables.appSlug === 'string'
          ? trimToUndefined(variables.appSlug)
          : undefined;

  if (owner && slug) {
    refs.push(`@${normalizeExpoOwner(owner)}/${slug}`);
  }

  return Array.from(
    new Set(refs.map((ref) => (ref.startsWith('@') ? normalizeExpoProjectRef(ref) : ref.trim()))),
  );
}

function tryResolveExpoProjectFromGraphqlVariables(
  settings: Partial<Pick<AppSettings, 'expoProjects' | 'expoAccounts'>>,
  variables: Record<string, unknown>,
): ExpoProjectConfig | undefined {
  const refs = collectExpoGraphqlProjectRefs(variables);
  for (const ref of refs) {
    try {
      return resolveExpoProject(ref, settings);
    } catch {
      continue;
    }
  }
  return undefined;
}

function tryResolveExpoAccountFromGraphqlVariables(
  settings: Partial<Pick<AppSettings, 'expoAccounts'>>,
  variables: Record<string, unknown>,
): ExpoAccountConfig | undefined {
  const accounts = getExpoAccounts(settings).filter((entry) => entry.enabled);
  const candidates = [variables.accountName, variables.owner, variables.ownerName]
    .map((value) => (typeof value === 'string' ? trimToUndefined(value) : undefined))
    .filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const normalizedOwner = normalizeExpoOwner(candidate);
    const lowerCandidate = candidate.toLowerCase();
    const matches = accounts.filter(
      (account) =>
        normalizeExpoOwner(account.owner) === normalizedOwner ||
        trimToUndefined(account.name)?.toLowerCase() === lowerCandidate,
    );

    if (matches.length === 1) {
      return matches[0];
    }
  }

  return undefined;
}

export {
  formatExpoGraphqlErrors,
  describeExpoGraphqlErrors,
  fetchExpoGraphqlEnvelope,
  expoGraphqlRequest,
  getRepoFullNameFromExpoNode,
  collectExpoGraphqlProjectRefs,
  tryResolveExpoProjectFromGraphqlVariables,
  tryResolveExpoAccountFromGraphqlVariables,
};
