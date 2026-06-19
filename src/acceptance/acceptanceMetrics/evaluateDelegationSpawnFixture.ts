// ---------------------------------------------------------------------------
// Kavi — Delegation spawn fixture evaluator
// ---------------------------------------------------------------------------

import { resolveDelegatedWorkerSpawnPlan } from '../../engine/graph/delegatedWorkerSpawn';
import type { DelegationSpawnFixture } from './delegationSpawnFixtures';
import type { AcceptanceFixtureOutcome } from './types';

export function evaluateDelegationSpawnFixture(
  fixture: DelegationSpawnFixture,
): AcceptanceFixtureOutcome {
  const plan = resolveDelegatedWorkerSpawnPlan({
    request: fixture.request,
    conversation: fixture.conversation,
    parentConversationId: fixture.conversation.id,
    agentRunId: fixture.agentRunId ?? fixture.conversation.activeAgentRunId,
    liveWorkers: fixture.liveWorkers ?? [],
  });

  if (fixture.expectation === 'must_block') {
    if (plan.status === 'ready') {
      return {
        fixtureId: fixture.id,
        passed: false,
        detail: 'spawn gate returned ready when dependency/worker guard expected block',
      };
    }
    return { fixtureId: fixture.id, passed: true };
  }

  if (plan.status !== 'ready') {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: `spawn gate blocked (${plan.status}): ${plan.spawnGate.error ?? plan.response?.error ?? 'unknown'}`,
    };
  }

  if (plan.spawnGate.status !== 'ready') {
    return {
      fixtureId: fixture.id,
      passed: false,
      detail: 'spawn gate status not ready',
    };
  }

  return { fixtureId: fixture.id, passed: true };
}