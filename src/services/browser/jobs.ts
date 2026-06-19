import { useSettingsStore } from '../../store/useSettingsStore';
import type { BrowserProviderConfig } from '../../types/remote';
import {
  addRemoteArtifact,
  closeRemoteSession,
  getRemoteSessionRuntime,
  openRemoteSession,
  setRemoteSessionRuntime,
  startRemoteJob,
  updateRemoteJob,
  updateRemoteSession,
  useRemoteStore,
} from '../remote/store';
import { resolveBrowserProviderConnection, withBrowserProviderAuth } from './providers/connection';
import { getBrowserProviderLabel } from './providers/labels';
import { getBrowserProviderReadiness } from './providers/readiness';
import { browserScreenshot } from './automation/actions';

interface BrowserLaunchResult {
  externalId: string;
  liveViewUrl?: string;
  statusUrl?: string;
  stopUrl?: string;
  webSocketUrl?: string;
}

const BROWSERLESS_RECONNECT_MUTATION = {
  query:
    'mutation ReconnectSession { reconnect(timeout: 600000) { browserQLEndpoint browserWSEndpoint devtoolsFrontendUrl webSocketDebuggerUrl } }',
};

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid provider response (${response.status})`);
  }
}

function requireLiveProvider(config: BrowserProviderConfig): void {
  const readiness = getBrowserProviderReadiness(config);
  if (!readiness.launchable) {
    throw new Error(readiness.reason);
  }
}

async function launchBrowserbaseSession(
  config: BrowserProviderConfig,
): Promise<BrowserLaunchResult> {
  const connection = await resolveBrowserProviderConnection(config);
  const createRequest = withBrowserProviderAuth(
    `${connection.baseUrl}/v1/sessions`,
    connection,
    'X-BB-API-Key',
  );
  const createResponse = await fetch(createRequest.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(createRequest.headers || {}),
    },
    body: JSON.stringify({ projectId: config.projectId }),
  });

  if (!createResponse.ok) {
    throw new Error(`Browserbase session failed (${createResponse.status})`);
  }

  const created = await parseJsonResponse(createResponse);
  const sessionId = String(created.id || '');
  if (!sessionId) {
    throw new Error('Browserbase did not return a session id');
  }

  const debugRequest = withBrowserProviderAuth(
    `${connection.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/debug`,
    connection,
    'X-BB-API-Key',
  );
  const debugResponse = await fetch(debugRequest.url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(debugRequest.headers || {}),
    },
  });
  if (!debugResponse.ok) {
    throw new Error(`Browserbase debug URL lookup failed (${debugResponse.status})`);
  }

  const debugPayload = await parseJsonResponse(debugResponse);
  return {
    externalId: sessionId,
    liveViewUrl:
      typeof debugPayload.debuggerFullscreenUrl === 'string'
        ? debugPayload.debuggerFullscreenUrl
        : undefined,
    statusUrl: `${connection.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`,
    stopUrl: `${connection.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}`,
    webSocketUrl: typeof debugPayload.wsUrl === 'string' ? debugPayload.wsUrl : undefined,
  };
}

async function launchBrowserlessSession(
  config: BrowserProviderConfig,
): Promise<BrowserLaunchResult> {
  const connection = await resolveBrowserProviderConnection(config);
  const createRequest = withBrowserProviderAuth(`${connection.baseUrl}/session`, connection);
  const createResponse = await fetch(createRequest.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(createRequest.headers || {}),
    },
    body: JSON.stringify({
      ttl: 600000,
      stealth: true,
      browser: 'chromium',
    }),
  });

  if (!createResponse.ok) {
    throw new Error(`Browser session failed (${createResponse.status})`);
  }

  const created = await parseJsonResponse(createResponse);
  const externalId = String(created.id || '');
  const browserQlUrl =
    typeof created.browserQL === 'string'
      ? created.browserQL
      : typeof created.browserQLEndpoint === 'string'
        ? created.browserQLEndpoint
        : '';
  if (!externalId || !browserQlUrl) {
    throw new Error('Browserless did not return a reconnect endpoint');
  }

  const reconnectRequest = withBrowserProviderAuth(browserQlUrl, connection);
  const reconnectResponse = await fetch(reconnectRequest.url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(reconnectRequest.headers || {}),
    },
    body: JSON.stringify(BROWSERLESS_RECONNECT_MUTATION),
  });
  if (!reconnectResponse.ok) {
    throw new Error(`Browserless live view lookup failed (${reconnectResponse.status})`);
  }

  const reconnectPayload = await parseJsonResponse(reconnectResponse);
  const reconnect = reconnectPayload.data?.reconnect || {};

  return {
    externalId,
    liveViewUrl:
      typeof reconnect.devtoolsFrontendUrl === 'string' ? reconnect.devtoolsFrontendUrl : undefined,
    statusUrl: browserQlUrl,
    stopUrl: typeof created.stop === 'string' ? created.stop : undefined,
    webSocketUrl:
      typeof reconnect.browserWSEndpoint === 'string'
        ? reconnect.browserWSEndpoint
        : typeof reconnect.webSocketDebuggerUrl === 'string'
          ? reconnect.webSocketDebuggerUrl
          : undefined,
  };
}

async function launchProviderSession(config: BrowserProviderConfig): Promise<BrowserLaunchResult> {
  if ((config.provider || 'browserbase') === 'browserbase') {
    return launchBrowserbaseSession(config);
  }
  return launchBrowserlessSession(config);
}

export async function launchBrowserLiveSession(config: BrowserProviderConfig): Promise<string> {
  requireLiveProvider(config);
  const providerLabel = getBrowserProviderLabel(config.provider);
  const jobId = startRemoteJob({
    jobType: 'browser-job',
    targetId: config.id,
    providerId: config.id,
    status: 'running',
    requestedBy: 'user',
    executionSurface: 'browser-job',
    summary: `Launch live browser session on ${providerLabel}`,
    progressText: 'Creating browser session',
  });
  const sessionId = openRemoteSession({
    targetId: config.id,
    providerId: config.id,
    kind: 'browser-live',
    status: 'connecting',
    summary: `${config.name} live view`,
    reconnectable: true,
  });

  try {
    const launched = await launchProviderSession(config);
    setRemoteSessionRuntime(sessionId, {
      stopUrl: launched.stopUrl || '',
      statusUrl: launched.statusUrl || '',
      webSocketUrl: launched.webSocketUrl || '',
    });
    updateRemoteSession(sessionId, {
      externalId: launched.externalId,
      liveViewUrl: launched.liveViewUrl,
      status: 'connected',
      summary: launched.liveViewUrl
        ? `${config.name} live view ready`
        : `${config.name} session active`,
    });
    updateRemoteJob(jobId, {
      status: 'completed',
      externalId: launched.externalId,
      progressText: launched.liveViewUrl ? 'Live view ready' : 'Session started',
    });

    if (launched.liveViewUrl) {
      addRemoteArtifact(jobId, {
        kind: 'log-snippet',
        title: 'Live view',
        uri: launched.liveViewUrl,
        value: launched.liveViewUrl,
      });
    }
    if (launched.webSocketUrl) {
      addRemoteArtifact(jobId, {
        kind: 'log-snippet',
        title: 'Debugger endpoint',
        value: launched.webSocketUrl,
      });
    }

    return sessionId;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser session failed';
    updateRemoteJob(jobId, {
      status: 'failed',
      error: message,
      progressText: 'Launch failed',
    });
    closeRemoteSession(sessionId, 'error', message);
    throw error;
  }
}

export async function stopBrowserLiveSession(sessionId: string): Promise<void> {
  const runtime = getRemoteSessionRuntime(sessionId);
  const session = useRemoteStore.getState().sessions[sessionId];
  if (!session) {
    throw new Error('browser-session-not-found');
  }

  const provider = (useSettingsStore.getState().browserProviders || []).find(
    (entry) => entry.id === session.providerId,
  );
  if (!provider) {
    closeRemoteSession(sessionId, 'closed');
    return;
  }

  const connection = await resolveBrowserProviderConnection(provider);
  const stopUrl =
    runtime?.stopUrl ||
    ((provider.provider || 'browserbase') === 'browserbase' && session.externalId
      ? `${connection.baseUrl}/v1/sessions/${encodeURIComponent(session.externalId)}`
      : '');
  if (stopUrl) {
    const stopRequest = withBrowserProviderAuth(
      stopUrl,
      connection,
      (provider.provider || 'browserbase') === 'browserbase' ? 'X-BB-API-Key' : 'X-API-Key',
    );
    await fetch(stopRequest.url, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        ...(stopRequest.headers || {}),
      },
    });
  }

  closeRemoteSession(sessionId, 'closed');
}

export async function takeScreenshot(sessionId: string): Promise<string | null> {
  const result = await browserScreenshot(sessionId);
  if (result?.ok && result.imageBase64) {
    return `data:image/png;base64,${result.imageBase64}`;
  }
  return null;
}
