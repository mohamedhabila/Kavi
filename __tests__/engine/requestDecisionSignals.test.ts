import { resolveGraphEntryRequestDecision } from '../../src/engine/graph/requestDecisionSignals';
import { buildGraphEntryRequestFrame } from '../../src/engine/graph/requestEntrySignals';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import type { RequestFrame } from '../../src/services/agents/requestFrame';

function frame(overrides: Partial<Pick<RequestFrame, 'mode' | 'continuation'>> = {}): RequestFrame {
  return buildGraphEntryRequestFrame({
    text: 'Continue the existing work',
    attachmentCount: 0,
    mode: overrides.mode ?? 'agentic',
    continuation: overrides.continuation ?? 'resume_waiting_async',
  });
}

function waitingGraph(monitorToolNames: string[] = ['sessions_status']) {
  return createInitialAgentRunControlGraphState({
    status: 'waiting_async',
    asyncWork: {
      awaitingBackgroundWorkers: false,
      pendingOperations: [
        {
          key: 'session:worker-1',
          kind: 'session',
          resourceId: 'worker-1',
          displayName: 'Worker 1',
          status: 'running',
          lastUpdatedByTool: 'sessions_spawn',
          updatedAt: 10,
          monitorToolNames,
        },
      ],
      updatedAt: 10,
    },
    updatedAt: 10,
  });
}

function decide(
  params: {
    requestFrame?: RequestFrame;
    graphSnapshot?: ReturnType<typeof waitingGraph>;
    available?: ReadonlyArray<string>;
    allowed?: ReadonlyArray<string>;
    approvalRequired?: ReadonlyArray<string>;
  } = {},
) {
  const available = new Set(params.available ?? ['sessions_status']);
  const allowed = new Set(params.allowed ?? ['sessions_status']);
  const approvalRequired = new Set(params.approvalRequired ?? []);
  return resolveGraphEntryRequestDecision({
    frame: params.requestFrame ?? frame(),
    graphSnapshot: params.graphSnapshot ?? waitingGraph(),
    toolAuthority: {
      isAvailable: (toolName) => available.has(toolName),
      isAllowed: (toolName) => allowed.has(toolName),
      requiresApproval: (toolName) => approvalRequired.has(toolName),
    },
  });
}

describe('graph entry request decision signals', () => {
  it('projects registered user fields as supplied on a clarification resume', () => {
    const requestFrame = frame({ continuation: 'resume_waiting_user' });
    const graphSnapshot = createInitialAgentRunControlGraphState({
      status: 'ready',
      pendingUserInput: {
        requestedAfterUserMessageId: 'user-1',
        requiredInformation: [
          {
            key: 'alarm.time',
            requiredFor: 'execution',
            semanticRole: 'time',
            resolution: 'user_provided',
          },
          {
            key: 'alarm.label',
            requiredFor: 'understanding',
            semanticRole: 'title',
            resolution: 'user_provided',
          },
        ],
        updatedAt: 10,
      },
    });

    expect(decide({ requestFrame, graphSnapshot })).toMatchObject({
      requiredInformation: [
        {
          key: 'alarm.time',
          authority: 'user',
          requiredFor: 'execution',
          resolution: 'user_provided',
        },
        {
          key: 'alarm.label',
          authority: 'user',
          requiredFor: 'understanding',
          resolution: 'user_provided',
        },
      ],
      decision: { action: 'act', reason: 'requirements_resolved' },
    });
  });

  it('keeps partially answered clarification fields unresolved without guessing', () => {
    const requestFrame = frame({ continuation: 'resume_waiting_user' });
    const graphSnapshot = createInitialAgentRunControlGraphState({
      status: 'ready',
      pendingUserInput: {
        requestedAfterUserMessageId: 'user-1',
        requiredInformation: [
          {
            key: 'message.recipient',
            requiredFor: 'execution',
            semanticRole: 'recipient',
            resolution: 'user_provided',
          },
          {
            key: 'message.content',
            requiredFor: 'execution',
            semanticRole: 'content',
            resolution: 'unresolved',
          },
        ],
        updatedAt: 10,
      },
    });

    expect(decide({ requestFrame, graphSnapshot })).toMatchObject({
      requiredInformation: [
        { key: 'message.recipient', resolution: 'user_provided' },
        { key: 'message.content', resolution: 'unresolved' },
      ],
      decision: { action: 'clarify', reason: 'required_information_missing' },
    });
  });

  it('uses an available allowed monitor as a safe status lookup', () => {
    expect(decide()).toMatchObject({
      requiredInformation: [
        {
          key: 'async.operation.0.status',
          authority: 'tool',
          requiredFor: 'execution',
          resolution: 'unresolved',
        },
      ],
      decision: { action: 'act', reason: 'information_lookup_required' },
    });
  });

  it('waits when background work has no exact operation to inspect', () => {
    const graphSnapshot = createInitialAgentRunControlGraphState({
      status: 'waiting_async',
      asyncWork: {
        awaitingBackgroundWorkers: true,
        pendingOperations: [],
        updatedAt: 10,
      },
      updatedAt: 10,
    });

    expect(decide({ graphSnapshot })).toMatchObject({
      requiredInformation: [{ key: 'async.background_workers', resolution: 'unresolved' }],
      decision: { action: 'wait', reason: 'waiting_for_async' },
    });
  });

  it('requests consent when every usable monitor needs structured approval', () => {
    expect(decide({ approvalRequired: ['sessions_status'] })).toMatchObject({
      requiredInformation: expect.arrayContaining([
        {
          key: 'async.monitor.authorization',
          authority: 'policy',
          requiredFor: 'authorization',
          resolution: 'unresolved',
        },
      ]),
      decision: { action: 'consent', reason: 'authorization_required' },
    });
  });

  it.each([
    { label: 'unavailable', available: [], allowed: ['sessions_status'] },
    { label: 'disabled', available: ['sessions_status'], allowed: [] },
  ])('declines when the exact monitor is $label', ({ available, allowed }) => {
    expect(decide({ available, allowed })).toMatchObject({
      requiredInformation: expect.arrayContaining([
        {
          key: 'async.monitor.policy',
          authority: 'policy',
          requiredFor: 'execution',
          resolution: 'unresolved',
        },
      ]),
      decision: { action: 'decline', reason: 'prohibited' },
    });
  });

  it('uses a safe alternative instead of requiring approval for another monitor', () => {
    expect(
      decide({
        graphSnapshot: waitingGraph(['sessions_status', 'sessions_wait']),
        available: ['sessions_status', 'sessions_wait'],
        allowed: ['sessions_status', 'sessions_wait'],
        approvalRequired: ['sessions_status'],
      }),
    ).toMatchObject({
      decision: { action: 'act', reason: 'information_lookup_required' },
    });
  });

  it('evaluates approval against the persisted monitor arguments', () => {
    const requiresApproval = jest.fn().mockReturnValue(false);
    const graphSnapshot = waitingGraph();
    graphSnapshot.asyncWork.pendingOperations[0].statusArgs = { sessionId: 'worker-1' };

    resolveGraphEntryRequestDecision({
      frame: frame(),
      graphSnapshot,
      toolAuthority: {
        isAvailable: () => true,
        isAllowed: () => true,
        requiresApproval,
      },
    });

    expect(requiresApproval).toHaveBeenCalledWith('sessions_status', {
      sessionId: 'worker-1',
    });
  });

  it('routes nonempty symbols through the same structured async authority', () => {
    const symbolFrame = buildGraphEntryRequestFrame({
      text: '...',
      attachmentCount: 0,
      mode: 'agentic',
      continuation: 'resume_waiting_async',
    });

    expect(decide({ requestFrame: symbolFrame, available: [] })).toMatchObject({
      decision: { action: 'decline', reason: 'prohibited' },
    });
  });

  it.each([
    { label: 'new user turn', requestFrame: frame({ continuation: 'new' }) },
    { label: 'concurrent chitchat', requestFrame: frame({ mode: 'chitchat' }) },
  ])('does not inherit stale async authority into a $label', ({ requestFrame }) => {
    expect(decide({ requestFrame, available: [], allowed: [] })).toBe(requestFrame);
    expect(requestFrame).toMatchObject({
      requiredInformation: [],
      decision: { action: 'act', reason: 'actionable_input' },
    });
  });
});
