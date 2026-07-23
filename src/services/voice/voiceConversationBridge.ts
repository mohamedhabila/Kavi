import type { RunChatOptions } from '../../engine/graph/foregroundRun/contracts';

export type VoiceConversationTurnOptions = Pick<RunChatOptions, 'additionalSystemPrompt'>;

export type VoiceConversationHandler = (
  input: string,
  options?: VoiceConversationTurnOptions,
) => Promise<string>;

export class VoiceConversationBridgeError extends Error {
  readonly kind: 'unavailable' | 'no_response';

  constructor(kind: VoiceConversationBridgeError['kind']) {
    super(kind === 'unavailable' ? 'Voice conversation bridge unavailable' : 'No voice response');
    this.name = 'VoiceConversationBridgeError';
    this.kind = kind;
  }
}

let registeredHandler: VoiceConversationHandler | null = null;

/**
 * Registers the canonical Chat execution path for immersive voice turns.
 *
 * Voice must never create its own hidden conversation runner: doing so would
 * bypass conversation history, tool approvals, persistence, and recovery.
 */
export function registerVoiceConversationHandler(
  handler: VoiceConversationHandler,
): () => void {
  registeredHandler = handler;

  return () => {
    if (registeredHandler === handler) {
      registeredHandler = null;
    }
  };
}

export async function sendVoiceConversationTurn(
  input: string,
  options?: VoiceConversationTurnOptions,
): Promise<string> {
  const handler = registeredHandler;
  if (!handler) {
    throw new VoiceConversationBridgeError('unavailable');
  }

  const response = (await handler(input, options)).trim();
  if (!response) {
    throw new VoiceConversationBridgeError('no_response');
  }

  return response;
}

export function resetVoiceConversationBridgeForTests(): void {
  registeredHandler = null;
}
