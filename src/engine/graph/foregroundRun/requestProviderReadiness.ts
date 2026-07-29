import type { Conversation } from '../../../types/conversation';
import type { RunChatOptions } from './contracts';
import type { ForegroundConversationRunState } from './executionTypes';
import { resolveForegroundRunPreflight, type ForegroundRunPreflightResult } from './preflight';

type ReadyPreflight = Extract<ForegroundRunPreflightResult, { kind: 'ready' }>;

export type ForegroundRequestProviderReadiness =
  | Readonly<{ kind: 'ready'; preflight: ReadyPreflight }>
  | Readonly<{ kind: 'unavailable'; message: string | null }>;

export async function resolveForegroundRequestProviderReadiness(params: {
  conversation: Conversation | undefined;
  conversationId: string;
  options?: RunChatOptions;
  state: ForegroundConversationRunState;
}): Promise<ForegroundRequestProviderReadiness> {
  let preflight: ForegroundRunPreflightResult;
  try {
    preflight = await resolveForegroundRunPreflight({
      activeModel: params.state.activeModel,
      activeProviderId: params.state.activeProviderId,
      conversation: params.conversation,
      conversationId: params.conversationId,
      options: params.options,
      providers: params.state.providers,
      systemPrompt: params.state.systemPrompt,
    });
  } catch (error: unknown) {
    return {
      kind: 'unavailable',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (preflight.kind === 'ready') return { kind: 'ready', preflight };
  return {
    kind: 'unavailable',
    message:
      preflight.kind === 'missing_provider'
        ? params.state.chatNoProviderMessage
        : preflight.kind === 'missing_api_key'
          ? params.state.chatNoApiKeyMessage
          : params.state.chatNoModelMessage,
  };
}
