import { prepareAgentTurnRequestBudget } from '../../src/engine/graph/agentTurnRequestBudget';
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
      enrichedSystemPromptSections: [{ text: 'Stable assistant instructions.', cacheable: true }],
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
});
