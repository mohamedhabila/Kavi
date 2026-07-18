import type { Message } from '../../../types/message';
import type { AgentRunMobileControllerRecoveryState } from '../../../types/agentRun';
import { deduplicateToolResults, ensureToolResultPairing } from '../../toolResultPairingGuard';
import type { MobileControllerHostPort } from '../../mobileController/runtimeBinding';
import { appendEphemeralMobileControllerObservation } from './mobileControllerObservation';

export function buildModelReadyMessages(messages: Message[]): Message[] {
  return deduplicateToolResults(ensureToolResultPairing(messages));
}

export function buildForegroundOrchestratorMessages(params: {
  persistedMessages: Message[];
  excludedAssistantMessageId?: string;
  additionalInternalPrompt?: string;
  mobileController?: MobileControllerHostPort;
  mobileControllerRecoveryState?: AgentRunMobileControllerRecoveryState;
  createId: () => string;
  timestamp: number;
}): { durableMessages: Message[]; modelMessages: Message[] } {
  const sourceMessages = params.excludedAssistantMessageId
    ? params.persistedMessages.filter(
        (message) => message.id !== params.excludedAssistantMessageId,
      )
    : params.persistedMessages;
  const modelReadyMessages = buildModelReadyMessages(sourceMessages);
  const internalPrompt = params.additionalInternalPrompt?.trim();
  const durableMessages = internalPrompt
    ? [
        ...modelReadyMessages,
        {
          id: params.createId(),
          role: 'system' as const,
          content: internalPrompt,
          timestamp: params.timestamp,
        },
      ]
    : modelReadyMessages;
  return {
    durableMessages,
    modelMessages: appendEphemeralMobileControllerObservation({
      messages: durableMessages,
      controller: params.mobileController,
      recoveryState: params.mobileControllerRecoveryState,
      createId: params.createId,
      timestamp: params.timestamp,
    }),
  };
}
