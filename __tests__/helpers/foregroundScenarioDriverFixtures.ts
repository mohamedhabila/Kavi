import type { IngestionJob } from '../../src/services/memory/ingestionQueue';
import type { IngestionProviderFinalReceipt } from '../../src/services/memory/ingestionStructuralReceiptStore';
import type { Conversation } from '../../src/types/conversation';
import type { LlmProviderConfig } from '../../src/types/provider';

export function makeForegroundScenarioProvider(id: string): LlmProviderConfig {
  return {
    id,
    name: id,
    enabled: true,
    kind: 'remote',
    protocol: 'openai-chat',
    providerFamily: 'custom',
    baseUrl: `https://${id}.example.com`,
    apiKey: `${id}-key`,
    model: `${id}-model`,
  };
}

export function makeOriginalForegroundScenarioConversation(): Conversation {
  return {
    id: 'original-conversation',
    title: 'Original conversation',
    messages: [],
    providerId: 'original-provider',
    systemPrompt: 'Original prompt',
    createdAt: 1,
    updatedAt: 1,
  };
}

export function makeCompletedForegroundScenarioJob(id: string): IngestionJob {
  return {
    id,
    threadId: 'scenario-conversation',
    threadTitle: 'Scenario title',
    memoryConversationId: 'scenario-conversation',
    personaId: 'default',
    taskId: null,
    sourceRunId: null,
    chatProviderId: 'scenario-provider',
    chatModel: 'scenario-provider-model',
    sourceStartMessageId: null,
    sourceEndMessageId: `assistant-${id}`,
    sourceSnapshotVersion: 1,
    sourceSnapshotSha256: 'a'.repeat(64),
    sourceSnapshotByteLength: 1,
    sourceAt: 1,
    reason: 'turn_completed',
    status: 'completed_enriched',
    attemptCount: 1,
    providerEnrichment: true,
    providerOutcome: 'valid',
    outcomeCode: null,
    nextAttemptAt: null,
    leaseExpiresAt: null,
    claimToken: null,
    structuralCompletedAt: 2,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
  };
}

export function makeForegroundScenarioProviderReceipt(
  jobId: string,
  overrides: Partial<IngestionProviderFinalReceipt> = {},
): IngestionProviderFinalReceipt {
  return {
    phase: 'provider_final',
    jobId,
    attemptNumber: 1,
    episodeId: `episode-${jobId}`,
    deterministicFactIds: [`deterministic-${jobId}`],
    providerFactIds: [`provider-${jobId}`],
    invalidatedFactIds: [],
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
    activeFocusUpdated: true,
    openThreadsUpdated: false,
    providerOutcome: 'valid',
    providerOutcomeCode: null,
    persistedAt: 2,
    ...overrides,
  };
}
