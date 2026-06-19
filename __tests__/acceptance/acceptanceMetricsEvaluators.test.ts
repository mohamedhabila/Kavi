import { evaluateAgentBootstrapFixture } from '../../src/acceptance/acceptanceMetrics/evaluateAgentBootstrapFixture';
import { evaluateDelegationEvidenceFixture } from '../../src/acceptance/acceptanceMetrics/evaluateDelegationEvidenceFixture';
import { evaluateDelegationSpawnFixture } from '../../src/acceptance/acceptanceMetrics/evaluateDelegationSpawnFixture';
import { evaluateFalseFinalizeFixture } from '../../src/acceptance/acceptanceMetrics/evaluateFalseFinalizeFixture';
import { evaluateMemoryRecallResult } from '../../src/acceptance/acceptanceMetrics/evaluateMemoryRecallResult';
import { AGENT_BOOTSTRAP_FIXTURES } from '../../src/acceptance/acceptanceMetrics/agentBootstrapFixtures';
import { DELEGATION_EVIDENCE_FIXTURES } from '../../src/acceptance/acceptanceMetrics/delegationEvidenceFixtures';
import { DELEGATION_SPAWN_FIXTURES } from '../../src/acceptance/acceptanceMetrics/delegationSpawnFixtures';
import { FALSE_FINALIZE_FIXTURES } from '../../src/acceptance/acceptanceMetrics/falseFinalizeFixtures';

describe('acceptance metric evaluators', () => {
  it('detects missing structural recall tokens', () => {
    const outcome = evaluateMemoryRecallResult({
      fixtureId: 'test',
      facts: [
        {
          id: 'f1',
          predicate: 'wrote_file',
          objectText: 'projects/atlas/metadata.json',
          importance: 0.5,
          accessCount: 1,
          createdAt: 1,
          updatedAt: 1,
          originConversationId: 'conv-1',
        },
      ],
      requiredStructuralTokens: ['projects/atlas/metadata.json', 'missing-token'],
    });

    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain('missing-token');
  });

  it('passes all agent bootstrap fixtures structurally', () => {
    for (const fixture of AGENT_BOOTSTRAP_FIXTURES) {
      expect(evaluateAgentBootstrapFixture(fixture).passed).toBe(true);
    }
  });

  it('passes all false-finalize fixtures against the completion gate', () => {
    for (const fixture of FALSE_FINALIZE_FIXTURES) {
      expect(evaluateFalseFinalizeFixture(fixture).passed).toBe(true);
    }
  });

  it('passes all delegation spawn fixtures structurally', () => {
    for (const fixture of DELEGATION_SPAWN_FIXTURES) {
      expect(evaluateDelegationSpawnFixture(fixture).passed).toBe(true);
    }
  });

  it('passes all delegation evidence fixtures structurally', () => {
    for (const fixture of DELEGATION_EVIDENCE_FIXTURES) {
      expect(evaluateDelegationEvidenceFixture(fixture).passed).toBe(true);
    }
  });
});