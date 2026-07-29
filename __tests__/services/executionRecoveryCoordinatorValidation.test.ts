jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
    ),
    digest: jest.fn(
      async (_algorithm: string, value: Uint8Array) =>
        Uint8Array.from(createHash('sha256').update(Buffer.from(value)).digest()).buffer,
    ),
  };
});

import type { ExecutionRecoveryCommand } from '../../src/services/executionJournal/recoveryPlanner';
import { coordinateExecutionRecovery } from '../../src/services/executionJournal/recoveryCoordinator';
import {
  COORDINATOR_COMMANDS,
  coordinatorPlan,
  expectNoHandlerCalls,
  makeHarness,
} from '../helpers/executionRecoveryCoordinatorFixtures';

const MOBILE_CONTROLLER_COMMAND: Extract<
  ExecutionRecoveryCommand,
  { kind: 'await_mobile_controller_handoff' }
> = {
  kind: 'await_mobile_controller_handoff',
  runId: 'run-1',
  checkpointId: 'checkpoint-1',
  controlEpoch: 0,
  stateRefId: 'state-1',
  stateDigest: 'e'.repeat(64),
  conversationId: 'conversation-1',
  foregroundExecutionRunId: 'execution-run-1',
  foregroundControlEpoch: 0,
  foregroundUpdatedAt: 90,
  agentRunId: 'agent-run-1',
  requestMessageId: 'message-1',
  externalStatus: 'pending',
  updatedAt: 100,
  handoff: {
    version: 1,
    effectRunId: 'run-1',
    executionRunId: 'execution-run-1',
    effectId: 'effect-1',
    externalHandleId: 'handle-1',
    toolCallId: 'tool-call-1',
    controlEpoch: 0,
    handoffId: `mch_${'a'.repeat(32)}`,
    controllerId: 'mobile-controller-1',
    controllerContractVersion: 1,
    capabilityDigest: `sha256:${'a'.repeat(64)}`,
    actionDigest: `sha256:${'b'.repeat(64)}`,
    beforeObservationId: 'observation-1',
    beforeObservationDigest: `sha256:${'c'.repeat(64)}`,
    expiresAt: 60_000,
  },
};

describe('execution recovery coordinator command prerequisites', () => {
  it.each([
    {
      ...COORDINATOR_COMMANDS.resume_persisted_tool_batch,
      requiresExecutionAuthorityRevalidation: false,
    },
    {
      ...COORDINATOR_COMMANDS.reconcile_external_handles,
      handleIds: [],
    },
    {
      ...COORDINATOR_COMMANDS.resume_model_step,
      prompt: 'must never cross the coordinator boundary',
    },
  ])('blocks a malformed or open command without consulting ports', async (command) => {
    const harness = makeHarness();
    const queryResult = coordinatorPlan(command as unknown as ExecutionRecoveryCommand);

    const outcome = await coordinateExecutionRecovery({ queryResult }, harness.ports);

    expect(outcome).toEqual(expect.objectContaining({ kind: 'blocked', reason: 'invalid_plan' }));
    expect(harness.events).toEqual([]);
    expectNoHandlerCalls(harness.handlers);
  });

  it('blocks a same-generation command substitution during revalidation', async () => {
    const initial = coordinatorPlan(COORDINATOR_COMMANDS.resume_model_step);
    const harness = makeHarness(COORDINATOR_COMMANDS.resume_model_step, {
      current: coordinatorPlan(COORDINATOR_COMMANDS.resume_review),
    });

    const outcome = await coordinateExecutionRecovery({ queryResult: initial }, harness.ports);

    expect(outcome).toEqual(
      expect.objectContaining({ kind: 'blocked', reason: 'revalidation_mismatch' }),
    );
    expect(harness.events).toEqual(['query']);
  });

  it('keeps a valid foreground mobile handoff out of the provider dispatch coordinator', async () => {
    const harness = makeHarness(MOBILE_CONTROLLER_COMMAND);

    const outcome = await coordinateExecutionRecovery(
      { queryResult: harness.initial },
      harness.ports,
    );

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: 'blocked',
        commandKind: 'await_mobile_controller_handoff',
        reason: 'handler_unavailable',
      }),
    );
    expect(harness.events).toEqual([]);
    expectNoHandlerCalls(harness.handlers);
  });

  it('rejects payload-bearing mobile recovery commands before consulting ports', async () => {
    const harness = makeHarness();
    const queryResult = coordinatorPlan({
      ...MOBILE_CONTROLLER_COMMAND,
      handoff: { ...MOBILE_CONTROLLER_COMMAND.handoff, action: { kind: 'tap' } },
    } as unknown as ExecutionRecoveryCommand);

    const outcome = await coordinateExecutionRecovery({ queryResult }, harness.ports);

    expect(outcome).toEqual(expect.objectContaining({ kind: 'blocked', reason: 'invalid_plan' }));
    expect(harness.events).toEqual([]);
    expectNoHandlerCalls(harness.handlers);
  });
});
