import { resolveExplicitDelegationToolNames } from '../../src/engine/graph/explicitDelegationToolSurface';
import { resolveModelTurnGroundedToolSurface } from '../../src/engine/graph/modelTurn/resolveGroundedToolSurface';
import { tools } from '../helpers/turnToolSurfaceHarness';

function messages(content: string) {
  return [{ id: 'u1', role: 'user' as const, content, timestamp: 2 }];
}

describe('explicit delegated-work tool activation', () => {
  it('activates the bounded lifecycle bundle for an explicit delegation request', () => {
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Please spawn a sub-agent for this research and wait for it.',
      }),
    ).toEqual(['sessions_spawn', 'sessions_status', 'sessions_wait', 'sessions_cancel']);
  });

  it('supports localized explicit delegation language', () => {
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: '请委派一个子智能体来研究这个问题。',
      }),
    ).toContain('sessions_spawn');
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Bitte delegiere diese Recherche an einen Subagenten.',
      }),
    ).toContain('sessions_spawn');
  });

  it('activates only the directly named session control', () => {
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Call sessions_wait for the existing helper.',
      }),
    ).toEqual(['sessions_wait']);
  });

  it('does not activate from explanatory questions or a negated request', () => {
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'What is a sub-agent?',
      }),
    ).toEqual([]);
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Do not use sessions_spawn or delegate this to a sub-agent.',
      }),
    ).toEqual([]);
  });

  it('keeps delegated-work tools out of ordinary chat mode', () => {
    expect(
      resolveExplicitDelegationToolNames({
        conversationMode: 'chitchat',
        latestUserMessageText: 'Please delegate this to a sub-agent.',
      }),
    ).toEqual([]);
  });

  it('grounds and admits the explicit route even beside an unrelated live goal', async () => {
    const result = await resolveModelTurnGroundedToolSurface({
      allTools: tools,
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set(),
      latestUserMessageText: 'Spawn a subagent to compare the sources, then wait for it.',
      goals: [
        {
          id: 'research',
          title: 'Research directly',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['discover'],
        },
      ],
      trackedAsyncOperations: new Map(),
      workingMessages: messages('Spawn a subagent to compare the sources, then wait for it.'),
    });

    const names = new Set(result.groundedRequestScopedTools.map((tool) => tool.name));
    expect(names.has('sessions_spawn')).toBe(true);
    expect(names.has('sessions_status')).toBe(true);
    expect(names.has('sessions_wait')).toBe(true);
    expect(result.allowSessionCoordinationTools).toBe(true);
  });
});
