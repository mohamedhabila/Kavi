import { collectConversationWorkspaceFallbackConversationIds } from '../../src/services/conversationWorkspace/fallbacks';

describe('conversation workspace fallbacks', () => {
  it('collects unique fallback workspace ids from messages, usage, evidence, and live workers', () => {
    const result = collectConversationWorkspaceFallbackConversationIds({
      conversationId: 'conv-1',
      messages: [
        {
          subAgentEvent: {
            type: 'sub-agent',
            event: 'started',
            snapshot: {
              sessionId: 'session-a',
              parentConversationId: 'conv-1',
              parentSessionId: 'session-root',
              depth: 1,
              startedAt: 1,
              updatedAt: 1,
              status: 'running',
              sandboxPolicy: 'inherit',
            },
          },
        } as any,
      ],
      usageEntries: [{ sessionId: 'session-b', parentSessionId: 'session-root' }],
      agentRuns: [
        {
          evidence: [
            {
              id: 'evidence-1',
              workerSessionId: 'session-c',
            } as any,
          ],
        },
      ] as any,
      liveSubAgents: [
        {
          sessionId: 'session-live',
          parentSessionId: 'session-a',
        },
      ],
    });

    expect(result).toEqual(['session-a', 'session-root', 'session-b', 'session-c', 'session-live']);
  });

  it('ignores the primary conversation id and duplicate ids', () => {
    const result = collectConversationWorkspaceFallbackConversationIds({
      conversationId: 'conv-1',
      messages: [
        {
          subAgentEvent: {
            type: 'sub-agent',
            event: 'started',
            snapshot: {
              sessionId: 'conv-1',
              parentConversationId: 'conv-1',
              depth: 1,
              startedAt: 1,
              updatedAt: 1,
              status: 'running',
              sandboxPolicy: 'inherit',
            },
          },
        } as any,
      ],
      usageEntries: [{ sessionId: 'session-a', parentSessionId: 'session-a' }],
      agentRuns: [
        {
          evidence: [
            {
              id: 'evidence-1',
              workerSessionId: 'session-a',
            } as any,
          ],
        },
      ] as any,
      liveSubAgents: [
        {
          sessionId: 'session-a',
          parentSessionId: 'conv-1',
        },
      ],
    });

    expect(result).toEqual(['session-a']);
  });
});
