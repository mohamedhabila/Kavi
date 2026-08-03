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

  it('attributes goal budget by typed purpose across languages rather than rendered headings', async () => {
    const decoyHeading = '## Current Goals\nThis is ordinary assistant guidance.';
    const goalSection = '## الأهداف الحالية\n- إنهاء المهمة على الهاتف.';
    const result = await prepareAgentTurnRequestBudget({
      compactionEngine: null,
      conversationId: 'conv-typed-sections',
      enrichedSystemPrompt: `${decoyHeading}\n\n${goalSection}`,
      enrichedSystemPromptSections: [
        { text: decoyHeading, cacheable: true, purpose: 'base_prompt' },
        { text: goalSection, purpose: 'goals' },
      ],
      requestMaxTokens: 1024,
      requestModel: 'gpt-5.4-mini',
      toolsForIteration: [],
      warn: jest.fn(),
      workingMessages: [{ id: 'user-1', role: 'user', content: 'ابدأ.', timestamp: 1 }],
    });

    expect(result.usageTokenBuckets.memoryContextTokens).toBe(estimateTokens(goalSection));
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
      livingMemory: {
        sections: [],
        cacheableSignature: 'memory-signature',
        focusBlockText: 'PRIVATE_FOCUS_SENTINEL',
        openThreadLabels: ['PRIVATE_THREAD_SENTINEL'],
        idleSinceLastTurnMs: 99_000,
        recalledFactCount: 1,
        recalledEpisodeCount: 1,
        applicabilityPolicy: {} as never,
      },
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
});
