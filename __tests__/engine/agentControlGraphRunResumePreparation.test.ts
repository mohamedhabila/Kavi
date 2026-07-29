import { prepareAgentRunResumeForOrchestrator } from '../../src/engine/graph/runResumePreparation';
import { createInitialAgentRunControlGraphState } from '../../src/services/agents/agentControlGraphState';
import type { AgentRun } from '../../src/types/agentRun';
import type { Message } from '../../src/types/message';

function userMessage(id: string): Message {
  return {
    id,
    role: 'user',
    content: id,
    timestamp: 1,
  };
}

function resumableRun(): Pick<AgentRun, 'controlGraph' | 'userMessageId' | 'workflowTaskAnchor'> {
  return {
    userMessageId: 'user-original',
    workflowTaskAnchor: {
      sourceMessageId: 'user-original',
      content: 'user-original',
      attachments: [],
    },
    controlGraph: createInitialAgentRunControlGraphState({
      status: 'finalized',
      iteration: 3,
      terminalReason: 'completed',
      updatedAt: 1,
    }),
  };
}

describe('agent control graph run resume preparation', () => {
  it('requires a newer user message before resuming a clarification run', () => {
    const awaitingUserRun = {
      ...resumableRun(),
      controlGraph: createInitialAgentRunControlGraphState({
        status: 'awaiting_user',
        pendingUserInput: {
          requestedAfterUserMessageId: 'user-original',
          requiredInformation: [
            {
              key: 'alarm.time',
              requiredFor: 'execution',
              semanticRole: 'time',
              resolution: 'unresolved',
            },
          ],
          updatedAt: 10,
        },
      }),
    };

    expect(
      prepareAgentRunResumeForOrchestrator({
        existingRun: awaitingUserRun,
        messages: [userMessage('user-original')],
      }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'missing_user_response',
      requestedSourceMessageId: 'user-original',
    });

    const resumed = prepareAgentRunResumeForOrchestrator({
      existingRun: awaitingUserRun,
      messages: [userMessage('user-original'), userMessage('user-response')],
      resolvedUserInformationKeys: ['alarm.time'],
      updatedAt: 20,
    });
    expect(resumed).toMatchObject({
      kind: 'ready',
      workflowScopeUserMessageId: 'user-original',
      initialAgentControlGraphState: {
        status: 'ready',
        pendingUserInput: {
          requestedAfterUserMessageId: 'user-original',
          requiredInformation: [
            {
              key: 'alarm.time',
              requiredFor: 'execution',
              semanticRole: 'time',
              resolution: 'user_provided',
            },
          ],
        },
      },
    });
    expect(
      resumed.initialAgentControlGraphState?.audit.some(
        (event) => event.type === 'RUN_RESUMED_FROM_USER_INPUT_WAIT',
      ),
    ).toBe(true);
  });

  it('rejects a reply admission key that was never registered by the paused run', () => {
    const awaitingUserRun = {
      ...resumableRun(),
      controlGraph: createInitialAgentRunControlGraphState({
        status: 'awaiting_user',
        pendingUserInput: {
          requestedAfterUserMessageId: 'user-original',
          requiredInformation: [
            {
              key: 'alarm.time',
              requiredFor: 'execution',
              semanticRole: 'time',
              resolution: 'unresolved',
            },
          ],
          updatedAt: 10,
        },
      }),
    };

    expect(() =>
      prepareAgentRunResumeForOrchestrator({
        existingRun: awaitingUserRun,
        messages: [userMessage('user-original'), userMessage('user-response')],
        resolvedUserInformationKeys: ['alarm.label'],
      }),
    ).toThrow('clarification_resolution_key_unknown');
  });

  it('resolves workflow scope without a resumable run', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      fallbackUserMessageId: 'user-1',
      messages: [userMessage('user-1'), userMessage('user-2')],
      updatedAt: 100,
    });

    expect(result.kind).toBe('ready');
    expect(result.workflowScopeUserMessageId).toBe('user-1');
    expect(result.initialAgentControlGraphState).toBeUndefined();
    expect(result.workflowTaskAnchor).toEqual({
      sourceMessageId: 'user-1',
      content: 'user-1',
      attachments: [],
    });
  });

  it('resumes from the persisted anchor when the source message is absent', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: resumableRun(),
      fallbackUserMessageId: 'missing-user',
      messages: [userMessage('user-visible-1'), userMessage('user-visible-2')],
      updatedAt: 100,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      workflowScopeUserMessageId: 'user-original',
      workflowTaskAnchor: {
        sourceMessageId: 'user-original',
        content: 'user-original',
      },
    });
  });

  it('rejects an existing run without a valid stored anchor', () => {
    const existingRun = resumableRun();
    delete existingRun.workflowTaskAnchor;

    expect(
      prepareAgentRunResumeForOrchestrator({
        existingRun,
        messages: [userMessage('user-original'), userMessage('user-visible-2')],
      }),
    ).toEqual({
      kind: 'unavailable',
      reason: 'missing_existing_owner',
      requestedSourceMessageId: 'user-original',
    });
  });

  it('rejects a malformed or mismatched stored anchor', () => {
    expect(
      prepareAgentRunResumeForOrchestrator({
        existingRun: {
          ...resumableRun(),
          workflowTaskAnchor: {
            sourceMessageId: 'different-owner',
            content: 'wrong task',
            attachments: [],
          },
        },
        messages: [],
      }),
    ).toMatchObject({ kind: 'unavailable', reason: 'missing_existing_owner' });
  });

  it('keeps the original owner when a later user correction is present', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: resumableRun(),
      messages: [userMessage('user-original'), userMessage('user-correction')],
      updatedAt: 100,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      workflowScopeUserMessageId: 'user-original',
      workflowTaskAnchor: {
        sourceMessageId: 'user-original',
        content: 'user-original',
      },
    });
  });

  it('preserves interrupted graph-owned state for waiting_async resume', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: {
        userMessageId: 'user-original',
        workflowTaskAnchor: {
          sourceMessageId: 'user-original',
          content: 'user-original',
          attachments: [],
        },
        controlGraph: createInitialAgentRunControlGraphState({
          status: 'waiting_async',
          iteration: 4,
          activeTaskId: 'goal-1',
          goals: [
            {
              id: 'goal-1',
              title: 'Collect sources',
              status: 'active',
              dependencies: [],
              evidence: ['worker:earlier'],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
          asyncWork: {
            awaitingBackgroundWorkers: true,
            pendingOperations: [
              {
                key: 'session:sub-1',
                kind: 'session',
                resourceId: 'sub-1',
                displayName: 'Session sub-1',
                status: 'running',
                blocksFinalization: false,
                lastUpdatedByTool: 'sessions_spawn',
                updatedAt: 50,
                monitorToolNames: ['sessions_wait'],
              },
            ],
            updatedAt: 50,
          },
          turnDirectives: {
            forceFinalText: false,
            requireWorkflowTool: false,
            incompleteFinalTextRecoveryCount: 1,
          },
          updatedAt: 50,
        }),
      },
      messages: [userMessage('user-original')],
      updatedAt: 100,
    });

    expect(result.initialAgentControlGraphState).toEqual(
      expect.objectContaining({
        status: 'waiting_async',
        activeTaskId: 'goal-1',
        goals: [
          expect.objectContaining({
            id: 'goal-1',
            evidence: ['worker:earlier'],
          }),
        ],
        asyncWork: expect.objectContaining({
          awaitingBackgroundWorkers: true,
          pendingOperations: [
            expect.objectContaining({
              resourceId: 'sub-1',
            }),
          ],
        }),
        turnDirectives: expect.objectContaining({
          incompleteFinalTextRecoveryCount: 1,
        }),
      }),
    );
  });

  it('prepares a terminal graph for resume without pilot correction reopening', () => {
    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: resumableRun(),
      messages: [userMessage('user-original')],
      updatedAt: 100,
    });

    expect(result.workflowScopeUserMessageId).toBe('user-original');
    expect(result.initialAgentControlGraphState).toEqual(
      expect.objectContaining({
        status: 'ready',
        terminalReason: undefined,
      }),
    );
    expect(result.initialAgentControlGraphState?.audit.map((event) => event.type)).toEqual(
      expect.arrayContaining(['RUN_RESUMED_FROM_TERMINAL_GRAPH']),
    );
  });

  it('requires the explicit stored anchor when a persisted graph turn resumes', () => {
    const graphState = createInitialAgentRunControlGraphState({
      status: 'waiting_async',
      updatedAt: 50,
    });
    const workflowTaskAnchor = {
      sourceMessageId: 'user-original',
      content: 'Original task',
      attachments: [],
    } as const;

    const result = prepareAgentRunResumeForOrchestrator({
      existingRun: {
        controlGraph: graphState,
        userMessageId: 'user-original',
        workflowTaskAnchor,
      },
      fallbackUserMessageId: 'user-original',
      messages: [],
      updatedAt: 100,
    });

    expect(result).toMatchObject({
      kind: 'ready',
      workflowScopeUserMessageId: 'user-original',
      workflowTaskAnchor,
    });
  });
});
