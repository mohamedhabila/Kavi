import {
  createInitialAgentControlGraphSnapshot,
  getAgentControlGraphModelTurnBlocker,
  reduceAgentControlGraph,
  selectAgentControlGraphRuntimeCommand,
} from '../../src/engine/graph/agentControlGraph';
import {
  isAgentRunControlGraphTerminal,
  prepareAgentRunControlGraphForResume,
} from '../../src/services/agents/agentControlGraphState';

describe('agent control graph clarification state', () => {
  it('parks the request, admits exact reply fields, and clears them on model start', () => {
    const waiting = reduceAgentControlGraph(createInitialAgentControlGraphSnapshot(), [
      {
        type: 'USER_INPUT_REQUIRED',
        requestedAfterUserMessageId: 'user-1',
        requiredInformation: [
          {
            key: 'alarm.time',
            requiredFor: 'execution',
            semanticRole: 'time',
            resolution: 'unresolved',
          },
        ],
        timestamp: 100,
      },
    ]);

    expect(waiting).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        pendingUserInput: expect.objectContaining({
          requiredInformation: [
            expect.objectContaining({ key: 'alarm.time', resolution: 'unresolved' }),
          ],
        }),
      }),
    );
    expect(isAgentRunControlGraphTerminal(waiting)).toBe(false);
    expect(getAgentControlGraphModelTurnBlocker(waiting)).toContain('waiting for the user');
    expect(selectAgentControlGraphRuntimeCommand(waiting).type).toBe('blocked');

    const resumed = prepareAgentRunControlGraphForResume(waiting, {
      resolvedUserInformationKeys: ['alarm.time'],
      updatedAt: 101,
    });
    expect(resumed).toEqual(
      expect.objectContaining({
        status: 'ready',
        pendingUserInput: expect.objectContaining({
          requiredInformation: [
            expect.objectContaining({ key: 'alarm.time', resolution: 'user_provided' }),
          ],
        }),
      }),
    );

    const started = reduceAgentControlGraph(resumed, [
      { type: 'MODEL_TURN_STARTED', iteration: 2, timestamp: 102 },
    ]);
    expect(started.status).toBe('model_turn');
    expect(started.pendingUserInput).toBeUndefined();
  });
});
