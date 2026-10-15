import { useEffect, useRef } from 'react';
import { createLogger } from '../utils/logger';

const logger = createLogger('IncomingChatRequest');

type IncomingChatRequest = Readonly<{ requestId: number; text: string }>;

function resolveIncomingChatRequest(value: unknown): IncomingChatRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<IncomingChatRequest>;
  if (
    typeof candidate.requestId !== 'number' ||
    !Number.isFinite(candidate.requestId) ||
    typeof candidate.text !== 'string' ||
    candidate.text.trim().length === 0
  ) {
    return null;
  }
  return { requestId: candidate.requestId, text: candidate.text };
}

/**
 * Sends a request the system opened Kavi with ("Ask Kavi" from Siri or Shortcuts) through the
 * conversation's normal send, once per request.
 */
export function useIncomingChatRequest(params: {
  incomingRequest: unknown;
  onConsumed: () => void;
  onSend: (text: string) => Promise<void>;
}): void {
  const consumedRequestIdsRef = useRef(new Set<number>());
  const { incomingRequest, onConsumed, onSend } = params;

  useEffect(() => {
    const request = resolveIncomingChatRequest(incomingRequest);
    if (!request || consumedRequestIdsRef.current.has(request.requestId)) return;
    consumedRequestIdsRef.current.add(request.requestId);
    onConsumed();
    onSend(request.text).catch((error: unknown) => {
      logger.warn('Could not send the incoming request.', { error: String(error) });
    });
  }, [incomingRequest, onConsumed, onSend]);
}
