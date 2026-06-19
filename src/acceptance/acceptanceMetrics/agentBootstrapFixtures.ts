// ---------------------------------------------------------------------------
// Kavi — Goal bootstrap fixtures (graph state only)
// ---------------------------------------------------------------------------

import type { AgentGoal } from '../../types/agentRun';

export type AgentBootstrapFixture = {
  id: string;
  turn1Goals: AgentGoal[];
  turn2Goals: AgentGoal[];
};

function goal(id: string, title: string, status: AgentGoal['status'] = 'active'): AgentGoal {
  return {
    id,
    title,
    status,
    dependencies: [],
    evidence: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function bootstrapFixture(
  id: string,
  turn2Goals: AgentGoal[],
  overrides: Partial<AgentBootstrapFixture> = {},
): AgentBootstrapFixture {
  const turn1Goals = overrides.turn1Goals ?? [];
  return {
    id,
    turn1Goals,
    turn2Goals,
    ...overrides,
  };
}

export const AGENT_BOOTSTRAP_FIXTURES: AgentBootstrapFixture[] = [
  bootstrapFixture('bootstrap-ship-release', [goal('g-ship', 'Ship release')]),
  bootstrapFixture('bootstrap-fix-regression', [goal('g-fix', 'Fix regression')]),
  bootstrapFixture('bootstrap-audit-repo', [goal('g-audit', 'Audit repository')]),
  bootstrapFixture('bootstrap-verify-build', [goal('g-verify', 'Verify build')]),
  bootstrapFixture('bootstrap-deploy-staging', [goal('g-deploy', 'Deploy staging')]),
  bootstrapFixture('bootstrap-refactor-module', [goal('g-refactor', 'Refactor module')]),
  bootstrapFixture('bootstrap-update-docs', [goal('g-docs', 'Update docs')]),
  bootstrapFixture('bootstrap-run-tests', [goal('g-tests', 'Run tests')]),
  bootstrapFixture('bootstrap-migrate-schema', [goal('g-migrate', 'Migrate schema')]),
  bootstrapFixture('bootstrap-optimize-query', [goal('g-optimize', 'Optimize query')]),
  bootstrapFixture('bootstrap-multi-goal', [
    goal('g-plan', 'Plan work'),
    goal('g-execute', 'Execute work', 'pending'),
  ]),
  bootstrapFixture('bootstrap-pending-goal', [goal('g-queue', 'Queued task', 'pending')]),
  bootstrapFixture(
    'bootstrap-completed-seed',
    [goal('g-done', 'Completed seed', 'completed'), goal('g-next', 'Next live focus')],
    {
      turn1Goals: [goal('g-done', 'Completed seed', 'completed')],
    },
  ),
  bootstrapFixture('bootstrap-evidence-goal', [
    {
      ...goal('g-evidence', 'Collect evidence'),
      evidence: ['read_file:config.json'],
    },
  ]),
  bootstrapFixture('bootstrap-criteria-goal', [
    {
      ...goal('g-criteria', 'Meet criteria'),
      successCriteria: ['evidence.min:1'],
    },
  ]),
  bootstrapFixture('bootstrap-dependency-goal', [
    {
      ...goal('g-child', 'Child goal'),
      dependencies: ['g-parent'],
    },
    goal('g-parent', 'Parent goal', 'completed'),
  ]),
  bootstrapFixture('bootstrap-turn1-empty-turn2-active', [goal('g-late', 'Late bootstrap')]),
  bootstrapFixture('bootstrap-already-present', [goal('g-early', 'Early bootstrap')], {
    turn1Goals: [goal('g-early', 'Early bootstrap')],
  }),
  bootstrapFixture(
    'bootstrap-expanded-set',
    [goal('g-one', 'First goal'), goal('g-two', 'Second goal', 'pending')],
    {
      turn1Goals: [goal('g-one', 'First goal')],
    },
  ),
  bootstrapFixture('bootstrap-blocked-goal', [goal('g-blocked', 'Blocked goal', 'blocked')]),
];
