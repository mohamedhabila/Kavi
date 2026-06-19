import type { ExpoAccountConfig, ExpoProjectConfig } from '../../types/remote';
import {
  describeExpoGraphqlErrors,
  fetchExpoGraphqlEnvelope,
  formatExpoGraphqlErrors,
} from './providers/expoGraphql';
import { resolveExpoAccountToken } from './secrets';
import { trimToUndefined } from './projectState';
import { resolveExpoMonitoringContext } from './monitoringContext';
export async function runExpoGraphqlQuery(args: {
  query: string;
  variables?: Record<string, unknown>;
  projectId?: string;
  accountId?: string;
}): Promise<{
  status: 'ok' | 'partial' | 'error';
  accountId?: string;
  projectId?: string;
  data?: unknown;
  error?: string;
  errorCode?: string;
  errors?: Array<{ message: string; path?: string; code?: string }>;
  guidance?: string;
}> {
  const normalizedQuery = trimToUndefined(args.query);
  const normalizedVariables =
    args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables)
      ? args.variables
      : {};

  if (!normalizedQuery) {
    return {
      status: 'error',
      error: 'GraphQL query is required.',
      errorCode: 'missing-query',
    };
  }

  const getGuidanceForError = (errorCode: string): string | undefined => {
    switch (errorCode) {
      case 'expo-account-ambiguous':
        return 'Pass projectId or accountId, or include variables like appId, fullName, or owner+slug so the Expo account can be resolved automatically.';
      case 'expo-account-not-found':
        return 'Link an Expo account first, or pass projectId/accountId so the GraphQL tool can resolve the correct token.';
      case 'expo-project-not-found':
        return 'Use expo_eas_list_projects first, then pass one of the returned project ids or fullName values.';
      case 'missing-expo-token':
        return 'Store a valid Expo token for the target account before using raw Expo GraphQL queries.';
      default:
        return undefined;
    }
  };

  let project: ExpoProjectConfig | undefined;
  let account: ExpoAccountConfig | undefined;

  try {
    const resolved = resolveExpoMonitoringContext(
      args.projectId,
      args.accountId,
      normalizedVariables,
    );
    project = resolved.project;
    account = resolved.account;
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : String(error);
    return {
      status: 'error',
      error: errorCode,
      errorCode,
      guidance: getGuidanceForError(errorCode),
    };
  }

  try {
    const token = await resolveExpoAccountToken(account);
    const { response, payload, rawText } = await fetchExpoGraphqlEnvelope<unknown>(
      token,
      normalizedQuery,
      normalizedVariables,
    );
    const errors = formatExpoGraphqlErrors(payload?.errors);
    const hasData = Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, 'data');
    const errorMessage =
      describeExpoGraphqlErrors(payload?.errors) ||
      trimToUndefined(rawText) ||
      (!response.ok ? `expo-graphql-${response.status}` : undefined) ||
      'expo-graphql-empty-response';

    if (!response.ok) {
      return {
        status: 'error',
        accountId: account.id,
        projectId: project?.id,
        error: errorMessage,
        ...(errors.length > 0 ? { errors } : {}),
      };
    }

    if (errors.length > 0) {
      return {
        status: hasData ? 'partial' : 'error',
        accountId: account.id,
        projectId: project?.id,
        ...(hasData ? { data: payload?.data } : {}),
        error: errorMessage,
        errors,
      };
    }

    if (!hasData) {
      return {
        status: 'error',
        accountId: account.id,
        projectId: project?.id,
        error: 'expo-graphql-empty-response',
      };
    }

    return {
      status: 'ok',
      accountId: account.id,
      projectId: project?.id,
      data: payload?.data,
    };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : 'expo-graphql-request-failed';
    return {
      status: 'error',
      accountId: account.id,
      projectId: project?.id,
      error: errorCode,
      errorCode,
      guidance: getGuidanceForError(errorCode),
    };
  }
}
