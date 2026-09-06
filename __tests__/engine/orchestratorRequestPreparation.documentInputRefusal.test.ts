// ---------------------------------------------------------------------------
// Tests — orchestrator request preparation: document-input refusal persistence
// ---------------------------------------------------------------------------
// `runMediaUnderstanding` (services/media/service.ts) decides, at request time, whether the
// active provider/model can accept a PDF attachment as a provider-native document block. When
// it can't, `prepareOrchestratorRequestBundle` must carry that structured refusal reason onto
// the attachment and hand it to `onUserMessageAttachmentsUpdated` so the UI can render it —
// never just fold a notice into the enriched text and drop the structured signal.

jest.mock('../../src/services/memory/memoryAccessGateway', () => ({
  buildUnifiedMemoryAccessContext: jest.fn(),
}));

jest.mock('../../src/services/skills/manager', () => ({
  getSkillSystemPrompts: jest.fn().mockResolvedValue([]),
}));

import { prepareOrchestratorRequestBundle } from '../../src/engine/orchestratorRequestPreparation';
import { buildUnifiedMemoryAccessContext } from '../../src/services/memory/memoryAccessGateway';
import type { LlmProviderConfig } from '../../src/types/provider';
import type { Message } from '../../src/types/message';

const mockedBuildUnifiedMemoryAccessContext = jest.mocked(buildUnifiedMemoryAccessContext);

const provider = {
  id: 'provider-1',
  name: 'Provider',
  enabled: true,
  baseUrl: 'https://example.com',
  apiKey: 'key',
  model: 'model-1',
} as LlmProviderConfig;

function gatewayResult(messages: Message[]) {
  return {
    boundary: {
      startIndex: 0,
      reason: 'full_history' as const,
      similarityScore: 1,
      idleGapMs: 0,
      droppedMessageCount: 0,
    },
    scopedMessages: messages,
    livingMemory: null,
    consistencyBarrier: {
      outcome: 'no_job' as const,
      durationMs: 0,
      waitedMs: 0,
      queryCount: 1,
      matchedJobCount: 0,
      queueAgeMs: null,
      initialJobStatus: null,
      finalJobStatus: null,
    },
  };
}

describe('orchestrator request preparation — document-input refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists an unsupported-provider refusal onto the attachment and notifies the callback', async () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Review this contract',
        timestamp: 1,
        attachments: [
          {
            id: 'att-1',
            type: 'file',
            uri: 'file:///contract.pdf',
            name: 'contract.pdf',
            mimeType: 'application/pdf',
            size: 4096,
          },
        ],
      },
    ];
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValue(gatewayResult(messages));
    const onUserMessageAttachmentsUpdated = jest.fn();

    const result = await prepareOrchestratorRequestBundle({
      activeModel: provider.model,
      activeProvider: provider,
      callbacks: { onUserMessageAttachmentsUpdated },
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: true,
      memoryConversationId: 'memory-1',
      messages,
    });

    expect(onUserMessageAttachmentsUpdated).toHaveBeenCalledWith('user-1', [
      expect.objectContaining({
        id: 'att-1',
        documentInputRefusalReason: 'unsupported_provider',
      }),
    ]);
    const persistedAttachments = onUserMessageAttachmentsUpdated.mock.calls[0][1];
    expect(persistedAttachments[0]).not.toHaveProperty('documentInputRefusalMaxBytes');

    const workingUserMessage = result.workingMessages.find((message) => message.id === 'user-1');
    expect(workingUserMessage?.attachments?.[0]).toMatchObject({
      documentInputRefusalReason: 'unsupported_provider',
    });
  });

  it('persists the exceeded byte ceiling alongside a size-limit refusal', async () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Review this contract',
        timestamp: 1,
        attachments: [
          {
            id: 'att-1',
            type: 'file',
            uri: 'file:///contract.pdf',
            name: 'contract.pdf',
            mimeType: 'application/pdf',
            size: 40 * 1024 * 1024,
          },
        ],
      },
    ];
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValue(gatewayResult(messages));
    const onUserMessageAttachmentsUpdated = jest.fn();
    const anthropicProvider = {
      ...provider,
      protocol: 'anthropic-messages',
      modelCapabilities: { [provider.model]: { vision: false, tools: true, fileInput: true } },
    } as LlmProviderConfig;

    await prepareOrchestratorRequestBundle({
      activeModel: provider.model,
      activeProvider: anthropicProvider,
      callbacks: { onUserMessageAttachmentsUpdated },
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: true,
      memoryConversationId: 'memory-1',
      messages,
    });

    expect(onUserMessageAttachmentsUpdated).toHaveBeenCalledWith('user-1', [
      expect.objectContaining({
        id: 'att-1',
        documentInputRefusalReason: 'exceeds_size_limit',
        documentInputRefusalMaxBytes: 32 * 1024 * 1024,
      }),
    ]);
  });

  it('never calls the attachments callback when the provider can read the PDF natively', async () => {
    const messages: Message[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Review this contract',
        timestamp: 1,
        attachments: [
          {
            id: 'att-1',
            type: 'file',
            uri: 'file:///contract.pdf',
            name: 'contract.pdf',
            mimeType: 'application/pdf',
            size: 4096,
          },
        ],
      },
    ];
    mockedBuildUnifiedMemoryAccessContext.mockResolvedValue(gatewayResult(messages));
    const onUserMessageAttachmentsUpdated = jest.fn();
    const anthropicProvider = {
      ...provider,
      protocol: 'anthropic-messages',
      modelCapabilities: { [provider.model]: { vision: false, tools: true, fileInput: true } },
    } as LlmProviderConfig;

    await prepareOrchestratorRequestBundle({
      activeModel: provider.model,
      activeProvider: anthropicProvider,
      callbacks: { onUserMessageAttachmentsUpdated },
      conversationId: 'source-thread-1',
      graphOwnedRun: false,
      internalUserMessageCount: 0,
      linkUnderstandingEnabled: false,
      logger: { devLog: jest.fn(), devWarn: jest.fn() },
      maxLinks: 3,
      mediaUnderstandingEnabled: true,
      memoryConversationId: 'memory-1',
      messages,
    });

    expect(onUserMessageAttachmentsUpdated).not.toHaveBeenCalled();
  });
});
