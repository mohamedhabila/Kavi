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
