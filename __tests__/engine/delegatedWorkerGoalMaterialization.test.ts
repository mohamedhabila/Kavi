import { materializeDelegatedWorkerGoal } from '../../src/engine/graph/delegatedWorkerGoalMaterialization';
import { resolveDelegatedWorkerSpawnPlan } from '../../src/engine/graph/delegatedWorkerSpawn';
import {
  DELEGATED_WORKER_EVIDENCE_CRITERION,
  DELEGATED_WORKER_GOAL_OWNER,
  DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
} from '../../src/engine/goals/delegation';
import { createGoal } from '../../src/engine/goals/types';
import type { AgentGoal } from '../../src/types/agentRun';

// Traced live on an Android emulator. The spawn gate refuses any run without a goal of
// one exact shape, and states that shape in full inside `repair.expectedShape`. So the
// first `sessions_spawn` always failed, the `update_goals` that followed often produced
// criteria the second gate also refused, and only a third attempt launched a worker.
// The user saw it as "the spawn calls always fail" with duplicated, failing goal updates
// between them. The gate had already computed the answer; it just would not apply it.

const SPAWN = [{ name: 'sessions_spawn' }];

const deliverable = () =>
  createGoal({
    id: 'feasibility-study',
    title: 'Produce the feasibility study',
    status: 'active',
    completionPolicy: 'blocking',
    successCriteria: ['evidence.artifact:artifacts/verdict.md'],
  });

function spawnPlanStatus(goals: ReadonlyArray<AgentGoal>) {
  return resolveDelegatedWorkerSpawnPlan({
    request: { prompt: 'Run the simulation and report P10/P50/P90.' },
    conversation: undefined,
    parentConversationId: 'conversation-1',
    agentRunId: 'run-1',
    liveWorkers: [],
    parentGoals: goals,
  });
}

describe('the graph opens the delegated workstream a spawn needs', () => {
  it('creates the goal instead of refusing the launch', () => {
    const result = materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals: [deliverable()] });

    expect(result.status).toBe('materialized');
    const created = result.goals.find((goal) => goal.owner === DELEGATED_WORKER_GOAL_OWNER);
    expect(created).toBeDefined();
    expect(created?.completionPolicy).toBe('blocking');
    expect(created?.requiredCapabilities).toContain('coordinate');
    expect(created?.successCriteria).toEqual(
      expect.arrayContaining([
        DELEGATED_WORKER_EVIDENCE_CRITERION,
        DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
      ]),
    );
  });

  it('produces a goal the spawn gate accepts, so the first launch succeeds', () => {
    // The gate is the real assertion: before, it blocked; after, it is ready.
    expect(spawnPlanStatus([deliverable()]).status).toBe('blocked');

    const materialized = materializeDelegatedWorkerGoal({
      toolCalls: SPAWN,
      goals: [deliverable()],
    });
    expect(spawnPlanStatus(materialized.goals).status).toBe('ready');
  });

  it('leaves the parent deliverable untouched rather than repurposing it', () => {
    const result = materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals: [deliverable()] });
    const parent = result.goals.find((goal) => goal.id === 'feasibility-study');

    expect(parent?.owner).not.toBe(DELEGATED_WORKER_GOAL_OWNER);
    expect(parent?.successCriteria).toEqual(['evidence.artifact:artifacts/verdict.md']);
  });
});

describe('an existing delegation goal is repaired, not duplicated', () => {
  const halfBuilt = () =>
    createGoal({
      id: 'worker-1',
      title: 'Delegated workstream',
      status: 'pending',
      completionPolicy: 'blocking',
      owner: DELEGATED_WORKER_GOAL_OWNER,
      successCriteria: [DELEGATED_WORKER_EVIDENCE_CRITERION],
    });

  it('completes the contract on the goal the run already opened', () => {
    const result = materializeDelegatedWorkerGoal({
      toolCalls: SPAWN,
      goals: [deliverable(), halfBuilt()],
    });

    expect(result.status).toBe('materialized');
    expect(result.goals.filter((goal) => goal.owner === DELEGATED_WORKER_GOAL_OWNER)).toHaveLength(
      1,
    );
    const repaired = result.goals.find((goal) => goal.id === 'worker-1');
    expect(repaired?.requiredCapabilities).toContain('coordinate');
    expect(repaired?.successCriteria).toEqual(
      expect.arrayContaining([
        DELEGATED_WORKER_EVIDENCE_CRITERION,
        DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
      ]),
    );
  });

  it('makes the previously refused goal acceptable to the gate', () => {
    expect(spawnPlanStatus([halfBuilt()]).status).toBe('blocked');
    const materialized = materializeDelegatedWorkerGoal({
      toolCalls: SPAWN,
      goals: [halfBuilt()],
    });
    expect(spawnPlanStatus(materialized.goals).status).toBe('ready');
  });

  it('keeps criteria the goal already carried', () => {
    const withExtra = createGoal({
      id: 'worker-1',
      title: 'Delegated workstream',
      status: 'pending',
      completionPolicy: 'blocking',
      owner: DELEGATED_WORKER_GOAL_OWNER,
      requiredCapabilities: ['coordinate', 'compute'],
      successCriteria: ['evidence.tool:python'],
    });
    const result = materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals: [withExtra] });
    const repaired = result.goals.find((goal) => goal.id === 'worker-1');

    expect(repaired?.successCriteria).toContain('evidence.tool:python');
    expect(repaired?.requiredCapabilities).toEqual(
      expect.arrayContaining(['coordinate', 'compute']),
    );
  });
});

describe('it does nothing when there is nothing to reconcile', () => {
  const eligible = () =>
    createGoal({
      id: 'worker-1',
      title: 'Delegated workstream',
      status: 'pending',
      completionPolicy: 'blocking',
      owner: DELEGATED_WORKER_GOAL_OWNER,
      requiredCapabilities: ['coordinate'],
      successCriteria: [
        DELEGATED_WORKER_EVIDENCE_CRITERION,
        DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
      ],
    });

  it('leaves a run that already has a usable delegation goal alone', () => {
    const goals = [deliverable(), eligible()];
    expect(materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals }).status).toBe('unchanged');
  });

  it('does not block a launch the supervisor detached from this request', () => {
    // `waitForCompletion:false` hands control back now. A blocking goal would stop the
    // run finalizing until a worker it was told not to wait for reported back.
    const result = materializeDelegatedWorkerGoal({
      toolCalls: [
        { name: 'sessions_spawn', arguments: '{"prompt":"Research","waitForCompletion":false}' },
      ],
      goals: [deliverable()],
    });

    expect(result.status).toBe('unchanged');
    expect(result.goals).toHaveLength(1);
  });

  it('still opens one for a joined launch that omits waitForCompletion', () => {
    const result = materializeDelegatedWorkerGoal({
      toolCalls: [{ name: 'sessions_spawn', arguments: '{"prompt":"Research"}' }],
      goals: [deliverable()],
    });

    expect(result.status).toBe('materialized');
  });

  it('leaves a run with no goal graph alone, which the gate never refuses', () => {
    // `hasStructuredGoalGraph` gates the refusal, so a goal-less run was already going to
    // launch. Adding a blocking obligation to it would create work, not remove it.
    expect(materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals: [] }).status).toBe(
      'unchanged',
    );
  });

  it('does not open a workstream on a turn that spawns nothing', () => {
    const result = materializeDelegatedWorkerGoal({
      toolCalls: [{ name: 'write_file' }, { name: 'python' }],
      goals: [deliverable()],
    });

    expect(result.status).toBe('unchanged');
    expect(result.goals).toHaveLength(1);
  });

  it('does not resurrect a completed delegation goal', () => {
    const completed = createGoal({
      id: 'worker-done',
      title: 'Delegated workstream',
      status: 'completed',
      completionPolicy: 'blocking',
      owner: DELEGATED_WORKER_GOAL_OWNER,
      requiredCapabilities: ['coordinate'],
      successCriteria: [
        DELEGATED_WORKER_EVIDENCE_CRITERION,
        DELEGATED_WORKER_MIN_EVIDENCE_CRITERION,
      ],
    });
    const result = materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals: [completed] });

    // A second worker gets its own workstream; the finished one stays finished.
    expect(result.status).toBe('materialized');
    expect(result.goals.find((goal) => goal.id === 'worker-done')?.status).toBe('completed');
    expect(result.goals).toHaveLength(2);
  });

  it('names a fresh workstream when the default id is taken', () => {
    const taken = createGoal({ id: 'delegated-workstream', title: 'Something else' });
    const result = materializeDelegatedWorkerGoal({ toolCalls: SPAWN, goals: [taken] });

    expect(result.status).toBe('materialized');
    expect(result.goals.some((goal) => goal.id === 'delegated-workstream-2')).toBe(true);
  });
});
