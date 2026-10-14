import { prepareAgentTurnRequestBudget } from '../../src/engine/graph/agentTurnRequestBudget';
import { estimateTokens } from '../../src/services/context/tokenCounter';
import type { Message } from '../../src/types/message';

function makeMessage(index: number): Message {
  return {
    id: `msg-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Long context turn ${index}\n${'x'.repeat(8000)}`,
    timestamp: index,
  };
}

describe('prepareAgentTurnRequestBudget', () => {
  it('does not compact long-context requests before real budget pressure', async () => {
    const compact = jest.fn();
    const messages = Array.from({ length: 30 }, (_, index) => makeMessage(index));

    const result = await prepareAgentTurnRequestBudget({
      compactionEngine: { compact },
      conversationId: 'conv-cache-prefix',
      enrichedSystemPrompt: 'Stable assistant instructions.',
      enrichedSystemPromptSections: [
        {
          text: 'Stable assistant instructions.',
          cacheable: true,
          purpose: 'base_prompt',
        },
      ],
      requestMaxTokens: 8192,
      requestModel: 'gpt-5.4-mini',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: messages,
    });

    expect(compact).not.toHaveBeenCalled();
    expect(result.budgetResult.messages).toHaveLength(messages.length);
    expect(result.budgetResult.result.adjustments).toEqual([]);
  });

  it('attributes plan budget by typed purpose across languages rather than rendered headings', async () => {
    const decoyHeading = '## Plan\nThis is ordinary assistant guidance.';
    const planSection = '## الخطة\n- [>] إنهاء المهمة على الهاتف.';
    const result = await prepareAgentTurnRequestBudget({
      compactionEngine: null,
      conversationId: 'conv-typed-sections',
      enrichedSystemPrompt: `${decoyHeading}\n\n${planSection}`,
      enrichedSystemPromptSections: [
        { text: decoyHeading, cacheable: true, purpose: 'base_prompt' },
        { text: planSection, purpose: 'plan' },
      ],
      requestMaxTokens: 1024,
      requestModel: 'gpt-5.4-mini',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: [{ id: 'user-1', role: 'user', content: 'ابدأ.', timestamp: 1 }],
    });

    expect(result.usageTokenBuckets.memoryContextTokens).toBe(estimateTokens(planSection));
  });

  it('never forwards recalled memory as generic compaction-engine hints', async () => {
    const compact = jest.fn().mockResolvedValue({
      ok: true,
      compacted: false,
      tier: 'selective',
      reason: 'test did not compact',
    });
    const messages = Array.from({ length: 100 }, (_, index) => makeMessage(index));

    await prepareAgentTurnRequestBudget({
      compactionEngine: { compact },
      conversationId: 'conv-memory-authority',
      enrichedSystemPrompt: 'Stable assistant instructions.',
      requestMaxTokens: 8192,
      // A small-window model guarantees budget pressure so compaction actually runs;
      // the working window is now a large share of the model's real context.
      requestModel: 'phi4',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: messages,
      memorySectionText: '## Memory\n- (2026-10-01) PRIVATE_MEMORY_SENTINEL [id: item-1]',
    });

    expect(compact).toHaveBeenCalled();
    for (const [request] of compact.mock.calls) {
      expect(request).not.toHaveProperty('focusBlock');
      expect(request).not.toHaveProperty('openThreads');
      expect(request).not.toHaveProperty('idleSinceLastTurnMs');
      expect(JSON.stringify(request)).not.toContain('PRIVATE_');
    }
  });

  it('forwards code-owned open threads so a compaction summary keeps unfinished work', async () => {
    const compact = jest.fn().mockResolvedValue({
      ok: true,
      compacted: false,
      tier: 'selective',
      reason: 'test did not compact',
    });
    const messages = Array.from({ length: 100 }, (_, index) => makeMessage(index));

    await prepareAgentTurnRequestBudget({
      compactionEngine: { compact },
      conversationId: 'conv-open-threads',
      enrichedSystemPrompt: 'Stable assistant instructions.',
      requestMaxTokens: 8192,
      requestModel: 'phi4',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: messages,
      compactionContext: {
        openThreads: ['[active] Book the flight — criteria: evidence.min:1'],
      },
    });

    expect(compact).toHaveBeenCalled();
    const forwarded = compact.mock.calls.map(([request]) => request.compactionContext);
    expect(forwarded.some((context) => context?.openThreads?.length > 0)).toBe(true);
  });

  it('marks an on-device turn so compaction never spends a second local inference pass', async () => {
    const compact = jest.fn().mockResolvedValue({
      ok: true,
      compacted: false,
      tier: 'selective',
      reason: 'test did not compact',
    });
    const messages = Array.from({ length: 100 }, (_, index) => makeMessage(index));

    await prepareAgentTurnRequestBudget({
      compactionEngine: { compact },
      conversationId: 'conv-on-device',
      enrichedSystemPrompt: 'Stable assistant instructions.',
      onDeviceProvider: true,
      requestMaxTokens: 8192,
      requestModel: 'gemma3',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: messages,
    });

    expect(compact).toHaveBeenCalled();
    for (const [request] of compact.mock.calls) {
      expect(request.compactionContext?.onDeviceProvider).toBe(true);
    }
  });

  // A run read memory before its request was budgeted, leaving out the rounds it carried.
  // When the budget then compacted, the request went out with that read: the rounds the
  // summary replaced were in neither the messages nor the memory section.
  it('sends the memory section read for what the request carries after compaction', async () => {
    const messages = Array.from({ length: 100 }, (_, index) => makeMessage(index));
    const compact = jest.fn().mockResolvedValue({
      ok: true,
      compacted: true,
      tier: 'selective',
      result: {
        summary: 'Earlier turns, summarized.',
        firstKeptEntryId: 'msg-98',
        tokensBefore: 1,
      },
    });
    const staleMemory = '## Memory\nSTALE_READ';
    const refreshMemorySection = jest.fn((carried: ReadonlyArray<Message>) =>
      carried.some((message) => message.id === 'msg-0') ? undefined : '## Memory\nFRESH_READ',
    );

    const result = await prepareAgentTurnRequestBudget({
      compactionEngine: { compact },
      conversationId: 'conv-memory-after-compaction',
      enrichedSystemPrompt: `Stable assistant instructions.\n\n${staleMemory}`,
      enrichedSystemPromptSections: [
        { text: 'Stable assistant instructions.', cacheable: true, purpose: 'base_prompt' },
        { text: staleMemory, purpose: 'memory' },
      ],
      memorySectionText: staleMemory,
      refreshMemorySection,
      requestMaxTokens: 1024,
      requestModel: 'phi4',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: messages,
    });

    expect(compact).toHaveBeenCalled();
    expect(refreshMemorySection).toHaveBeenLastCalledWith(result.workingMessages);
    expect(result.budgetResult.systemPrompt).toContain('FRESH_READ');
    expect(result.budgetResult.systemPrompt).not.toContain('STALE_READ');
    expect(result.enrichedSystemPromptSections?.map((section) => section.text)).toEqual([
      'Stable assistant instructions.',
      '## Memory\nFRESH_READ',
    ]);
  });

  it('keeps the memory section while the read still fits the request', async () => {
    const memory = '## Memory\nCURRENT_READ';
    const result = await prepareAgentTurnRequestBudget({
      compactionEngine: null,
      conversationId: 'conv-memory-current',
      enrichedSystemPrompt: `Stable assistant instructions.\n\n${memory}`,
      enrichedSystemPromptSections: [
        { text: 'Stable assistant instructions.', cacheable: true, purpose: 'base_prompt' },
        { text: memory, purpose: 'memory' },
      ],
      memorySectionText: memory,
      refreshMemorySection: () => undefined,
      requestMaxTokens: 1024,
      requestModel: 'gpt-5.4-mini',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: [{ id: 'user-1', role: 'user', content: 'Hi.', timestamp: 1 }],
    });

    expect(result.budgetResult.systemPrompt).toContain('CURRENT_READ');
  });
});
