import type { RunChatOptions } from '../../engine/graph/foregroundRun/contracts';

export type VoiceConversationTurnOptions = Pick<RunChatOptions, 'additionalSystemPrompt'> & {
  /** Everything the turn has said so far, each time more of it streams in. */
  onReplyText?: (replySoFar: string) => void;
};

export type VoiceConversationReply = Readonly<{
  /** The turn's final answer. */
  response: string;
  /** Everything the turn said, in the order it streamed: what onReplyText last reported. */
  spokenText: string;
}>;

export type VoiceConversationHandler = (
  input: string,
  options?: VoiceConversationTurnOptions,
) => Promise<VoiceConversationReply>;

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
export function registerVoiceConversationHandler(handler: VoiceConversationHandler): () => void {
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
): Promise<VoiceConversationReply> {
  const handler = registeredHandler;
  if (!handler) {
    throw new VoiceConversationBridgeError('unavailable');
  }

  const reply = await handler(input, options);
  const response = reply.response.trim();
  if (!response) {
    throw new VoiceConversationBridgeError('no_response');
  }

  return { response, spokenText: reply.spokenText.trim() };
}

export function resetVoiceConversationBridgeForTests(): void {
  registeredHandler = null;
}
