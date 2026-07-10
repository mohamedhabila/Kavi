const mockExtractStructuralMemory = jest.fn();
const mockApplyConsolidatorResult = jest.fn();
const mockExtractProviderEnrichment = jest.fn();
const mockEnsureFactSchema = jest.fn();
const mockFindEntityByName = jest.fn();
const mockListFacts = jest.fn();
const mockUpsertState = jest.fn();
const mockRecordAgentRunEvidenceMemory = jest.fn();
const mockBridgeGraphGoalEvidence = jest.fn();

jest.mock('../../../src/services/memory/deterministicExtractor', () => ({
  extractStructuralMemory: (...args: any[]) => mockExtractStructuralMemory(...args),
}));

jest.mock('../../../src/services/memory/providerExtractor', () => ({
  extractProviderEnrichment: (...args: any[]) => mockExtractProviderEnrichment(...args),
}));

jest.mock('../../../src/services/memory/consolidator', () => ({
  applyConsolidatorResult: (...args: any[]) => mockApplyConsolidatorResult(...args),
}));

jest.mock('../../../src/services/memory/access/transaction', () => ({
  runMemoryTransaction: (callback: () => unknown) => callback(),
}));

jest.mock('../../../src/services/memory/schema', () => ({
  ensureFactSchema: (...args: any[]) => mockEnsureFactSchema(...args),
}));

jest.mock('../../../src/services/memory/entities', () => ({
  findEntityByName: (...args: any[]) => mockFindEntityByName(...args),
}));

jest.mock('../../../src/services/memory/facts/queries', () => ({
  listFacts: (...args: any[]) => mockListFacts(...args),
}));

jest.mock('../../../src/services/memory/consolidation/schedulerState', () => ({
  upsertState: (...args: any[]) => mockUpsertState(...args),
}));

jest.mock('../../../src/services/memory/agentRunEvidenceMemory', () => ({
  recordAgentRunEvidenceMemory: (...args: any[]) => mockRecordAgentRunEvidenceMemory(...args),
}));

jest.mock('../../../src/services/memory/evidenceBridge', () => ({
  bridgeGraphGoalEvidence: (...args: any[]) => mockBridgeGraphGoalEvidence(...args),
}));

import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import type { Message } from '../../../src/types/message';

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2)}`,
    role: 'user',
    content: '',
    createdAt: Date.now(),
    ...overrides,
  } as Message;
}

describe('turnProcessor memory namespace contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEnsureFactSchema.mockImplementation(() => undefined);
    mockFindEntityByName.mockReturnValue(null);
    mockListFacts.mockReturnValue([]);
    mockExtractStructuralMemory.mockReturnValue({
      episodeSummary: 'shared namespace turn',
      facts: [],
      activeFocus: null,
      openThreads: [],
    });
    mockApplyConsolidatorResult.mockReturnValue({
      recordedFactIds: [],
      invalidatedFactIds: [],
      activeFocusUpdated: false,
      openThreadsUpdated: false,
      episodeId: null,
    });
    mockRecordAgentRunEvidenceMemory.mockReturnValue({
      factIds: [],
      consumedEvidence: [],
    });
    mockBridgeGraphGoalEvidence.mockReturnValue({ bridged: [] });
  });

  it('persists child-thread turns under the shared memory conversation namespace', async () => {
    const assistant = makeMsg({
      role: 'assistant',
      content: 'Recorded.',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });

    await processIngestionTurn({
      threadId: 'child-conv-1',
      memoryConversationId: 'parent-conv-1',
      messages: [makeMsg({ role: 'user', content: 'Remember this.' }), assistant],
    });

    expect(mockExtractStructuralMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'parent-conv-1',
        threadId: 'child-conv-1',
      }),
    );
    expect(mockApplyConsolidatorResult).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        conversationId: 'parent-conv-1',
        threadId: 'child-conv-1',
      }),
    );
    expect(mockUpsertState).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'child-conv-1',
        lastConsolidatedMessageId: assistant.id,
      }),
    );
  });

  it('does not commit a terminal receipt when required graph evidence persistence fails', async () => {
    mockBridgeGraphGoalEvidence.mockImplementationOnce(() => {
      throw new Error('graph persistence failed');
    });
    const commitPersistenceReceipt = jest.fn(() => true);
    const assistant = makeMsg({
      role: 'assistant',
      content: 'Recorded.',
      assistantMetadata: { finishReason: 'stop', kind: 'final', completionStatus: 'complete' },
    });

    await expect(
      processIngestionTurn({
        threadId: 'conv-required-graph',
        messages: [makeMsg({ role: 'user', content: 'Remember this.' }), assistant],
        graphGoalEvidence: ['tool:required-evidence'],
        commitPersistenceReceipt,
      }),
    ).rejects.toThrow('graph persistence failed');
    expect(commitPersistenceReceipt).not.toHaveBeenCalled();
    expect(mockUpsertState).not.toHaveBeenCalled();
  });
});
