import { buildDelegatedWorkQueuePresentation } from '../../src/services/agents/delegatedWorkQueuePresentation';
import type { SubAgentSnapshot } from '../../src/types/subAgent';

function snapshot(overrides: Partial<SubAgentSnapshot> = {}): SubAgentSnapshot {
  return {
    sessionId: 'worker-root',
    parentConversationId: 'conversation-1',
    depth: 0,
    startedAt: 100,
    updatedAt: 200,
    status: 'running',
    sandboxPolicy: 'inherit',
    launchState: 'active',
    ...overrides,
  };
}

describe('delegated work queue presentation', () => {
  it('groups a canonical worker tree and links it to its source conversation', () => {
    const root = snapshot({ activeToolName: 'web_search' });
    const child = snapshot({
      sessionId: 'worker-child',
      parentSessionId: root.sessionId,
      depth: 1,
      status: 'completed',
      updatedAt: 180,
      launchState: 'terminal',
    });

    const result = buildDelegatedWorkQueuePresentation({
      snapshots: [root, child],
      conversations: [{ id: 'conversation-1', title: 'Trip research' }],
    });

    expect(result.counts).toEqual({
      active: 1,
      attention: 0,
      recent: 0,
      total: 1,
      runningWorkers: 1,
    });
    expect(result.groups[0]).toMatchObject({
      id: root.sessionId,
      section: 'active',
      activityKind: 'researching',
      sourceConversationId: 'conversation-1',
      sourceConversationTitle: 'Trip research',
      canCancel: true,
      canOpenSourceConversation: true,
      canPrepareRetry: false,
      rollup: {
        totalAgents: 2,
        runningCount: 1,
        completedCount: 1,
      },
    });
    expect(result.groups[0].nodes.map((node) => node.snapshot)).toEqual([root, child]);
  });

  it('puts failures in attention and exposes only a chat-mediated retry path', () => {
    const failed = snapshot({
      status: 'error',
      launchState: 'terminal',
      terminationCause: 'provider_failure',
    });

    const result = buildDelegatedWorkQueuePresentation({
      snapshots: [failed],
      conversations: [{ id: 'conversation-1', title: 'Source chat' }],
    });

    expect(result.groups[0]).toMatchObject({
      section: 'attention',
      activityKind: 'needs_attention',
      canCancel: false,
      canPrepareRetry: true,
    });
  });

  it('surfaces the most informative live activity anywhere in the worker tree', () => {
    const root = snapshot({ updatedAt: 300 });
    const child = snapshot({
      sessionId: 'worker-child',
      parentSessionId: root.sessionId,
      depth: 1,
      activeToolName: 'read_web_page',
      updatedAt: 200,
    });

    const result = buildDelegatedWorkQueuePresentation({ snapshots: [root, child] });

    expect(result.groups[0].activityKind).toBe('reviewing');
  });

  it('keeps an untitled source conversation navigable', () => {
    const result = buildDelegatedWorkQueuePresentation({
      snapshots: [snapshot({ status: 'error', launchState: 'terminal' })],
      conversations: [{ id: 'conversation-1', title: '' }],
    });

    expect(result.groups[0]).toMatchObject({
      sourceConversationTitle: '',
      canOpenSourceConversation: true,
      canPrepareRetry: true,
    });
  });

  it('keeps completed and cancelled work in recent history', () => {
    const result = buildDelegatedWorkQueuePresentation({
      snapshots: [
        snapshot({ sessionId: 'done', status: 'completed', launchState: 'terminal' }),
        snapshot({
          sessionId: 'cancelled',
          status: 'cancelled',
          launchState: 'terminal',
          updatedAt: 300,
        }),
      ],
      conversations: [{ id: 'conversation-1', title: 'Source chat' }],
    });

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].key).toBe('recent');
    expect(result.sections[0].groups.map((group) => group.id)).toEqual(['cancelled', 'done']);
    expect(result.sections[0].groups.map((group) => group.activityKind)).toEqual([
      'cancelled',
      'completed',
    ]);
  });

  it('does not offer navigation or retry when the source conversation is gone', () => {
    const result = buildDelegatedWorkQueuePresentation({
      snapshots: [snapshot({ status: 'timeout', launchState: 'terminal' })],
      conversations: [],
    });

    expect(result.groups[0]).toMatchObject({
      canOpenSourceConversation: false,
      canPrepareRetry: false,
    });
  });

  it.each([
    ['sessions_wait', 'waiting'],
    ['read_file', 'reviewing'],
    ['write_file', 'creating'],
    ['python', 'working'],
  ] as const)('maps %s to human activity kind %s', (activeToolName, activityKind) => {
    const result = buildDelegatedWorkQueuePresentation({
      snapshots: [snapshot({ activeToolName })],
    });

    expect(result.groups[0].activityKind).toBe(activityKind);
  });
});
