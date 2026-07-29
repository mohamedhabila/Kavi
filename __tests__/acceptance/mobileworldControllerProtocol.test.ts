import {
  buildMobileWorldControllerCapability,
  buildMobileWorldControllerOutcome,
  buildMobileWorldObservationRef,
  mapMobileControllerActionToMobileWorld,
  resolveMobileWorldBridgeEvent,
} from '../../benchmarks/mobileworld/controllerProtocol';
import { qualifyMobileControllerCapability } from '../../src/engine/mobileController/validation';
import { buildMobileControllerPublishedHandoff } from '../../src/engine/mobileController/publication';
import { createInitialAgentControlGraphSnapshot } from '../../src/engine/graph/agentControlGraph';
import {
  buildEffectCompletionCriterion,
  buildToolEffectReceiptEvidence,
} from '../../src/engine/goals/effectCompletionEvidence';
import { createGoal } from '../../src/engine/goals/types';
import { createPersistedMobileControllerHandoffFixture } from '../helpers/mobileControllerHandoffFixture';
import { effectReceipt } from '../helpers/effectDispatchCoordinatorFixtures';
import { makeTestAgentRun, makeTestConversation, makeTestMessage } from '../helpers/factories';

describe('MobileWorld graph-owned controller protocol', () => {
  it('builds one screenshot-only sandbox capability with a stable app allowlist', async () => {
    const capability = await buildMobileWorldControllerCapability([
      'com.google.android.documentsui',
      'com.google.android.deskclock',
    ]);

    expect(qualifyMobileControllerCapability(capability)).toEqual(capability);
    expect(capability).toEqual(
      expect.objectContaining({
        environmentClass: 'sandbox',
        allowedAppIds: ['com.google.android.deskclock', 'com.google.android.documentsui'],
        observationEvidence: ['screenshot', 'window_identity'],
        outcomeDeliveryModes: ['deferred'],
        normalizedCoordinateScale: 1_000,
        maxPendingActions: 1,
      }),
    );
  });

  it.each([
    [
      { kind: 'activate', target: { kind: 'coordinate', observationId: 'screen-1', x: 10, y: 20 } },
      { action_type: 'click', coordinate: [10, 20] },
    ],
    [
      { kind: 'input_text', text: 'draft' },
      { action_type: 'input_text', text: 'draft' },
    ],
    [{ kind: 'keyboard_enter' }, { action_type: 'keyboard_enter' }],
    [{ kind: 'back' }, { action_type: 'navigate_back' }],
    [{ kind: 'home' }, { action_type: 'navigate_home' }],
    [
      { kind: 'open_app', appId: 'com.google.android.documentsui' },
      { action_type: 'open_app', app_name: 'com.google.android.documentsui' },
    ],
    [
      { kind: 'scroll', direction: 'down' },
      { action_type: 'scroll', direction: 'down' },
    ],
    [{ kind: 'wait', durationMs: 500 }, { action_type: 'wait' }],
  ] as const)(
    'maps a product action into the unchanged upstream parser shape',
    (action, expected) => {
      expect(mapMobileControllerActionToMobileWorld(action)).toEqual(expected);
    },
  );

  it('rejects semantic targets that a screenshot-only host cannot execute', () => {
    expect(() =>
      mapMobileControllerActionToMobileWorld({
        kind: 'activate',
        target: { kind: 'element', observationId: 'screen-1', elementId: 'save-button' },
      }),
    ).toThrow('mobileworld_controller_element_target_unsupported');
  });

  it('reports an unchanged screen as acknowledged execution rather than semantic failure', () => {
    const persisted = createPersistedMobileControllerHandoffFixture();
    const publication = buildMobileControllerPublishedHandoff(persisted, {
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
    });
    if (!publication) throw new Error('expected publication fixture');
    const afterObservation = buildMobileWorldObservationRef({
      observationId: 'observation-after-1',
      screenshotDigest: `sha256:${'9'.repeat(64)}`,
      appId: 'files',
      windowId: 'picker',
    });

    const outcome = buildMobileWorldControllerOutcome({
      outcomeId: `mco_${'2'.repeat(32)}`,
      publication,
      afterObservation,
      observableDelta: 'unchanged',
      observedAt: 200,
      stabilization: { durationMs: 250, sampleCount: 2 },
    });

    expect(outcome).toEqual(
      expect.objectContaining({
        handoffId: persisted.handoffRef.handoffId,
        executionState: 'completed',
        effectState: 'applied',
        verificationState: 'acknowledged',
        observableDelta: 'unchanged',
        afterObservation,
      }),
    );
  });

  it('translates only graph-owned host events into upstream lifecycle actions', () => {
    const persisted = createPersistedMobileControllerHandoffFixture();
    const publication = buildMobileControllerPublishedHandoff(persisted, {
      conversationId: 'conversation-1',
      agentRunId: 'agent-run-1',
    });
    if (!publication) throw new Error('expected publication fixture');
    const pendingConversation = makeTestConversation({
      id: 'conversation-1',
      agentRuns: [makeTestAgentRun({ id: 'agent-run-1' })],
    });
    expect(
      resolveMobileWorldBridgeEvent({
        conversation: pendingConversation,
        agentRunId: 'agent-run-1',
        publication,
      }),
    ).toEqual(expect.objectContaining({ kind: 'controller_action', publication }));

    const clarificationConversation = makeTestConversation({
      id: 'conversation-1',
      messages: [
        makeTestMessage(1, {
          content: 'Which time should I use?',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'request_clarification',
          },
        }),
      ],
      agentRuns: [makeTestAgentRun({ id: 'agent-run-1', status: 'completed' })],
    });
    expect(
      resolveMobileWorldBridgeEvent({
        conversation: clarificationConversation,
        agentRunId: 'agent-run-1',
      }),
    ).toEqual({ kind: 'ask_user', text: 'Which time should I use?' });

    const completedGoal = createGoal({
      id: 'mobile-goal',
      title: 'Complete the mobile task',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:mobile_ui_action'],
      evidence: ['mobile_ui_action:{"status":"completed"}'],
    });
    const completedConversation = makeTestConversation({
      id: 'conversation-1',
      messages: [
        makeTestMessage(1, {
          content: '',
          toolCalls: [
            {
              id: 'mobile-1',
              name: 'mobile_ui_action',
              arguments: '{}',
              status: 'completed',
            },
          ],
        }),
        makeTestMessage(2, {
          content: 'Done.',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        }),
      ],
      agentRuns: [
        makeTestAgentRun({
          id: 'agent-run-1',
          status: 'completed',
          controlGraph: createInitialAgentControlGraphSnapshot({
            status: 'finalized',
            terminalReason: 'completed',
            goals: [completedGoal],
          }),
        }),
      ],
    });
    expect(
      resolveMobileWorldBridgeEvent({
        conversation: completedConversation,
        agentRunId: 'agent-run-1',
      }),
    ).toEqual({ kind: 'answer', text: 'Done.' });
  });

  it('emits verified completion only from exact code-owned goal effect evidence', () => {
    const receipt = effectReceipt();
    if (!receipt.resource) throw new Error('expected resource-backed receipt');
    const criterion = buildEffectCompletionCriterion({
      effectKind: receipt.effectKind,
      requestDigest: receipt.requestDigest,
      resource: receipt.resource,
      verificationState: 'verified',
    });
    const completedGoal = createGoal({
      id: 'verified-goal',
      title: 'Persist the requested event',
      status: 'completed',
      completionPolicy: 'blocking',
      successCriteria: [criterion],
      evidence: [buildToolEffectReceiptEvidence(receipt)],
    });
    const conversation = makeTestConversation({
      id: 'conversation-1',
      messages: [
        makeTestMessage(1, {
          content: '',
          toolCalls: [
            {
              id: 'mobile-1',
              name: 'mobile_ui_action',
              arguments: '{}',
              status: 'completed',
            },
          ],
        }),
        makeTestMessage(2, {
          content: 'The requested event is saved.',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        }),
      ],
      agentRuns: [
        makeTestAgentRun({
          id: 'agent-run-1',
          status: 'completed',
          controlGraph: createInitialAgentControlGraphSnapshot({
            status: 'finalized',
            terminalReason: 'completed',
            goals: [completedGoal],
          }),
        }),
      ],
    });

    expect(
      resolveMobileWorldBridgeEvent({
        conversation,
        agentRunId: 'agent-run-1',
      }),
    ).toEqual({ kind: 'status', goalStatus: 'complete' });
  });

  it('fails closed when a completed mobile run has no structurally proven goal', () => {
    const conversation = makeTestConversation({
      id: 'conversation-1',
      messages: [
        makeTestMessage(1, {
          content: '',
          toolCalls: [
            {
              id: 'mobile-1',
              name: 'mobile_ui_action',
              arguments: '{}',
              status: 'completed',
            },
          ],
        }),
        makeTestMessage(2, {
          content: 'I could not verify the requested result.',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        }),
      ],
      agentRuns: [makeTestAgentRun({ id: 'agent-run-1', status: 'completed' })],
    });

    expect(
      resolveMobileWorldBridgeEvent({
        conversation,
        agentRunId: 'agent-run-1',
      }),
    ).toEqual({ kind: 'status', goalStatus: 'infeasible' });
  });

  it('does not inherit actions or final responses from another run', () => {
    const conversation = makeTestConversation({
      id: 'conversation-1',
      messages: [
        makeTestMessage(1, { id: 'user-1', role: 'user', content: 'First task.' }),
        makeTestMessage(2, {
          content: '',
          toolCalls: [
            {
              id: 'mobile-1',
              name: 'mobile_ui_action',
              arguments: '{}',
              status: 'completed',
            },
          ],
        }),
        makeTestMessage(3, {
          content: 'First task finished.',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        }),
        makeTestMessage(4, { id: 'user-2', role: 'user', content: 'Second task.' }),
        makeTestMessage(5, {
          content: 'Here is the answer to the second task.',
          assistantMetadata: {
            kind: 'final',
            completionStatus: 'complete',
            finishReason: 'stop',
          },
        }),
      ],
      agentRuns: [
        makeTestAgentRun({ id: 'run-1', userMessageId: 'user-1', status: 'completed' }),
        makeTestAgentRun({ id: 'run-2', userMessageId: 'user-2', status: 'completed' }),
      ],
    });

    expect(
      resolveMobileWorldBridgeEvent({
        conversation,
        agentRunId: 'run-2',
      }),
    ).toEqual({ kind: 'answer', text: 'Here is the answer to the second task.' });
  });
});
