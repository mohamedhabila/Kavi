import type { BrowserProviderConfig } from '../../../types/remote';
import {
  DEFAULT_BROWSERLESS_QUERY_TOKEN,
  normalizeBrowserProvider,
  normalizeBrowserProviderAuthMode,
  normalizeBrowserProviderBaseUrl,
} from './registry';
import { getBrowserProviderReadiness } from './readiness';
import { resolveBrowserProviderToken } from './connection';

export interface BrowserProviderProbeResult {
  ok: boolean;
  status?: number;
  message: string;
  checkedAt: number;
}

function buildProbeRequest(
  config: BrowserProviderConfig,
  token?: string | null,
): { url: string; headers?: Record<string, string> } {
  const provider = normalizeBrowserProvider(config.provider);
  const authMode = normalizeBrowserProviderAuthMode(config);
  const headers: Record<string, string> = {};

  if (provider === 'browserbase') {
    const projectId = (config.projectId || '').trim();
    const baseUrl = normalizeBrowserProviderBaseUrl(config);
    const url = `${baseUrl}/v1/projects/${encodeURIComponent(projectId)}`;
    if (token) {
      headers['X-BB-API-Key'] = token;
    }
    return { url, headers };
  }

  const baseUrl = normalizeBrowserProviderBaseUrl(config);
  const parsed = new URL(`${baseUrl}/json/version`);
  if (authMode === 'query-token' && token) {
    parsed.searchParams.set(
      (config.queryTokenParam || DEFAULT_BROWSERLESS_QUERY_TOKEN).trim() ||
        DEFAULT_BROWSERLESS_QUERY_TOKEN,
      token,
    );
  } else if (authMode === 'bearer' && token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (authMode === 'api-key-header' && token) {
    headers['X-API-Key'] = token;
  }
  return { url: parsed.toString(), headers: Object.keys(headers).length > 0 ? headers : undefined };
}

export async function probeBrowserProvider(
  config: BrowserProviderConfig,
): Promise<BrowserProviderProbeResult> {
  const checkedAt = Date.now();

  try {
    const token = await resolveBrowserProviderToken(config);
    const readiness = getBrowserProviderReadiness(config, token);
    if (!readiness.launchable) {
      return {
        ok: false,
        message: readiness.reason,
        checkedAt,
      };
    }

    const request = buildProbeRequest(config, token);
    const response = await fetch(request.url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(request.headers || {}),
      },
    });

    return {
      ok: response.ok,
      status: response.status,
      message: response.ok ? `Ready (${response.status})` : `HTTP ${response.status}`,
      checkedAt,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'browser-provider-probe-failed',
      checkedAt,
    };
  }
}
