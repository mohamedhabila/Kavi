jest.mock('expo-crypto', () => {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA256' },
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) =>
      createHash('sha256').update(value, 'utf8').digest('hex'),
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
});
