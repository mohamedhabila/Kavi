import { isVertexNativeGeminiBaseUrl } from '../../../constants/api';
import type { LlmProviderConfig } from '../../../types/provider';
import { createTimeoutSignal } from '../../../utils/runtime';
import { isOnDeviceLlmProvider } from '../../localLlm/provider';
import { resolveProviderFamily } from '../catalog/providerFamilies';
import { resolveProviderTransport } from '../catalog/providerProtocols';
import { performLlmFetch, type LlmPerformFetch } from '../core/fetchTransport';
import { buildProviderHeaders, resolveProviderBaseUrl } from '../core/providerRequest';
import { buildGeminiGenerateContentUrl } from '../providers/gemini/request';

const DEFAULT_CONNECTION_TEST_TIMEOUT_MS = 10_000;

export type ProviderConnectionFailureReason =
  | 'authentication'
  | 'billing'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'server'
  | 'unsupported'
  | 'rejected';

export type ProviderConnectionTestResult =
  | { outcome: 'success' }
  | {
      outcome: 'failure';
      reason: ProviderConnectionFailureReason;
      httpStatus?: number;
    };

type ProviderConnectionProbe = {
  init: RequestInit;
  responseKind: 'key' | 'models' | 'token-count';
  url: string;
};

function appendEndpointPath(baseUrl: string, endpointPath: string): string {
  const url = new URL(baseUrl);
  url.hash = '';
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${endpointPath.replace(/^\/+/, '')}`;
  return url.toString();
}

function isOpenRouterEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === 'openrouter.ai' || hostname === 'www.openrouter.ai';
  } catch {
    return false;
  }
}

function buildProviderConnectionProbe(
  provider: LlmProviderConfig,
  signal: AbortSignal,
): ProviderConnectionProbe {
  const baseUrl = resolveProviderBaseUrl(provider);
  const headers = {
    ...buildProviderHeaders(provider),
    Accept: 'application/json',
  };

  if (isOpenRouterEndpoint(baseUrl) && resolveProviderFamily(provider) === 'openrouter') {
    return {
      url: appendEndpointPath(baseUrl, 'key'),
      init: { method: 'GET', headers, redirect: 'error', signal },
      responseKind: 'key',
    };
  }

  const transport = resolveProviderTransport(provider);
  if (transport === 'gemini') {
    return {
      url: buildGeminiGenerateContentUrl(baseUrl, provider.model, 'countTokens', {
        isVertexNativeGeminiBaseUrl,
      }),
      init: {
        method: 'POST',
        headers,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'connection test' }] }],
        }),
        redirect: 'error',
        signal,
      },
      responseKind: 'token-count',
    };
  }

  return {
    url: appendEndpointPath(baseUrl, 'models'),
    init: { method: 'GET', headers, redirect: 'error', signal },
    responseKind: 'models',
  };
}

function classifyHttpFailure(status: number): ProviderConnectionFailureReason {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 402) return 'billing';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limited';
  if (status === 404 || status === 405) return 'unsupported';
  if (status >= 500) return 'server';
  return 'rejected';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function hasExpectedResponse(
  response: Response,
  responseKind: ProviderConnectionProbe['responseKind'],
): Promise<boolean> {
  try {
    const payload: unknown = await response.json();
    if (responseKind === 'key') {
      return isRecord(payload) && isRecord(payload.data);
    }
    if (responseKind === 'token-count') {
      return (
        isRecord(payload) &&
        (typeof payload.totalTokens === 'number' || typeof payload.total_tokens === 'number')
      );
    }
    return (
      Array.isArray(payload) ||
      (isRecord(payload) && (Array.isArray(payload.data) || Array.isArray(payload.models)))
    );
  } catch {
    return false;
  }
}

/**
 * Verifies a remote provider with a read-only or token-count request. No chat
 * completion is sent, and response bodies are never retained or surfaced.
 */
export async function testProviderConnection(
  provider: LlmProviderConfig,
  options: {
    performFetch?: LlmPerformFetch;
    timeoutMs?: number;
  } = {},
): Promise<ProviderConnectionTestResult> {
  if (isOnDeviceLlmProvider(provider)) {
    return { outcome: 'failure', reason: 'unsupported' };
  }

  try {
    const signal = createTimeoutSignal(options.timeoutMs ?? DEFAULT_CONNECTION_TEST_TIMEOUT_MS);
    const probe = buildProviderConnectionProbe(provider, signal);
    const response = await (options.performFetch || performLlmFetch)(probe.url, probe.init);
    if (!response.ok) {
      return {
        outcome: 'failure',
        reason: classifyHttpFailure(response.status),
        httpStatus: response.status,
      };
    }

    return (await hasExpectedResponse(response, probe.responseKind))
      ? { outcome: 'success' }
      : { outcome: 'failure', reason: 'unsupported' };
  } catch (error) {
    return {
      outcome: 'failure',
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
    };
  }
}
