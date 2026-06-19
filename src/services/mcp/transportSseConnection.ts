import { unrefTimerIfSupported } from '../../utils/timers';
import type { JsonRpcNotification, JsonRpcResponse, McpTransportConfig } from './transport';

type MessageHandler = (msg: JsonRpcResponse | JsonRpcNotification) => void;

export function isSseTransportAvailable(): boolean {
  return typeof EventSource === 'function';
}

function resolveSseMessageEndpoint(baseUrl: string, endpointPath: string): string {
  if (endpointPath.startsWith('http')) {
    return endpointPath;
  }

  const url = new URL(baseUrl);
  return `${url.origin}${endpointPath}`;
}

export function connectMcpSseTransport(params: {
  config: Pick<McpTransportConfig, 'url' | 'sseUrl' | 'timeout'>;
  onMessage: MessageHandler | null;
  onDisconnect: () => void;
}): Promise<{ eventSource: EventSource; messageEndpoint: string }> {
  return new Promise((resolve, reject) => {
    if (!isSseTransportAvailable()) {
      reject(new Error('SSE transport is not available in this runtime'));
      return;
    }

    const baseUrl = params.config.url.replace(/\/$/, '');
    const candidates = Array.from(
      new Set(
        [params.config.sseUrl?.trim(), baseUrl, `${baseUrl}/sse`].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );

    let index = 0;

    const tryNext = () => {
      const sseUrl = candidates[index++];
      if (!sseUrl) {
        reject(new Error('SSE connection failed'));
        return;
      }

      const eventSource = new EventSource(sseUrl);
      let resolved = false;
      const connectTimeout = setTimeout(() => {
        if (!resolved) {
          eventSource.close();
          tryNext();
        }
      }, params.config.timeout ?? 10000);
      unrefTimerIfSupported(connectTimeout);

      const clearConnectTimeout = () => {
        clearTimeout(connectTimeout);
      };

      eventSource.addEventListener('endpoint', ((event: MessageEvent) => {
        const messageEndpoint = resolveSseMessageEndpoint(baseUrl, event.data);
        if (!resolved) {
          resolved = true;
          clearConnectTimeout();
          resolve({ eventSource, messageEndpoint });
        }
      }) as EventListener);

      eventSource.addEventListener('message', ((event: MessageEvent) => {
        try {
          params.onMessage?.(JSON.parse(event.data));
        } catch {
          // Ignore malformed server-sent messages.
        }
      }) as EventListener);

      eventSource.onerror = () => {
        if (!resolved) {
          clearConnectTimeout();
          eventSource.close();
          tryNext();
          return;
        }
        params.onDisconnect();
      };
    };

    tryNext();
  });
}
