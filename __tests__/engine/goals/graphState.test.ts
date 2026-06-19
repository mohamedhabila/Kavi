import {
  applyGoalMutation,
  addGoalEvidence,
  computeGoalStateFromSnapshot,
  buildInitialGoalState,
} from '../../../src/engine/goals/graphState';
import { createGoal } from '../../../src/engine/goals/types';

describe('goal graph state', () => {
  const now = 1000000;

  describe('applyGoalMutation', () => {
    it('adds a new goal', () => {
      const { goals, errors } = applyGoalMutation(
        [],
        { action: 'add', goals: [{ title: 'Build feature', completionPolicy: 'persistent' }] },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('Build feature');
      expect(goals[0].status).toBe('pending');
    });

    it('adds multiple goals in one mutation', () => {
      const { goals } = applyGoalMutation(
        [],
        {
          action: 'add',
          goals: [
            { title: 'A', completionPolicy: 'persistent' },
            { title: 'B', completionPolicy: 'persistent' },
          ],
        },
        now,
      );
      expect(goals).toHaveLength(2);
    });

    it('completes a blocked goal when evidence requirements are already satisfied', () => {
      const g = createGoal({
        id: 'worker-chain',
        title: 'Delegated chain task',
        status: 'blocked',
        successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
        blockedReason: 'gate:worker-chain:evidence.min:1',
      });
      const { goals, errors } = applyGoalMutation(
        [g],
        { action: 'complete', goals: [{ id: 'worker-chain' }] },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals[0].status).toBe('completed');
      expect(goals[0].blockedReason).toBeUndefined();
      expect(goals[0].completedAt).toBe(now);
    });

    it('completes a goal', () => {
      const g = createGoal({
        id: 'g1',
        title: 'Do it',
        status: 'active',
        completionPolicy: 'blocking',
        evidence: ['write_file:artifacts/e2e.txt'],
      });
      const { goals, errors } = applyGoalMutation(
        [g],
        { action: 'complete', goals: [{ id: 'g1' }] },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals[0].status).toBe('completed');
      expect(goals[0].completedAt).toBe(now);
      expect(goals[0].updatedAt).toBe(now);
    });

    it('completes a goal and adds evidence', () => {
      const g = createGoal({
        id: 'g1',
        title: 'Do it',
        status: 'active',
        completionPolicy: 'blocking',
      });
      const { goals } = applyGoalMutation(
        [g],
        {
          action: 'complete',
          goals: [{ id: 'g1', evidence: ['file written', 'test passed'] }],
        },
        now,
      );
      expect(goals[0].evidence).toEqual(['file written', 'test passed']);
    });

    it('treats completion of persistent context goals as evidence update', () => {
      const g = createGoal({
        id: 'scope-b',
        title: 'scope-b-planning',
        status: 'active',
        evidence: ['memory_remember:scope token observed'],
      });
      const { goals, errors } = applyGoalMutation(
        [g],
        { action: 'complete', goals: [{ id: 'scope-b', evidence: ['user_turn:scope-b-token'] }] },
        now,
      );

      expect(errors).toHaveLength(0);
      expect(goals[0].status).toBe('active');
      expect(goals[0].evidence).toEqual([
        'memory_remember:scope token observed',
        'user_turn:scope-b-token',
      ]);
    });

    it('activates a goal', () => {
      const g = createGoal({ id: 'g1', title: 'Do it' });
      const { goals, errors } = applyGoalMutation(
        [g],
        { action: 'activate', goals: [{ id: 'g1' }] },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals[0].status).toBe('active');
    });

    it('treats add with active status as pending plus activation', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'active',
              completionPolicy: 'persistent',
            },
          ],
        },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('pending');
      expect(goals.find((goal) => goal.id === 'scope-b')?.status).toBe('active');
    });

    it('drops completion criteria when adding a persistent focus goal', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'active',
              completionPolicy: 'persistent',
              successCriteria: ['memory_recall'],
            },
          ],
        },
        now,
      );

      expect(errors).toHaveLength(0);
      expect(goals.find((goal) => goal.id === 'scope-b')?.status).toBe('active');
      expect(goals.find((goal) => goal.id === 'scope-b')?.successCriteria).toBeUndefined();
    });

    it('treats update with active status as activation', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const g2 = createGoal({ id: 'scope-b', title: 'scope-b-planning' });
      const { goals, errors } = applyGoalMutation(
        [g1, g2],
        {
          action: 'update',
          goals: [{ id: 'scope-b', status: 'active' }],
        },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('pending');
      expect(goals.find((goal) => goal.id === 'scope-b')?.status).toBe('active');
    });

    it('treats add on an existing pending goal as idempotent activation', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const g2 = createGoal({ id: 'scope-b', title: 'scope-b-planning', status: 'pending' });
      const { goals, errors } = applyGoalMutation(
        [g1, g2],
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'active',
              completionPolicy: 'persistent',
            },
          ],
        },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals).toHaveLength(2);
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('pending');
      expect(goals.find((goal) => goal.id === 'scope-b')?.status).toBe('active');
    });

    it('stores active goals with unrecognized completion criteria as persistent focus', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'active',
              completionPolicy: 'blocking',
              successCriteria: ['scope-b-planning'],
            },
          ],
        },
        now,
      );

      expect(errors).toHaveLength(0);
      const scopeB = goals.find((goal) => goal.id === 'scope-b');
      expect(scopeB).toEqual(
        expect.objectContaining({
          status: 'active',
          completionPolicy: 'persistent',
        }),
      );
      expect(scopeB?.successCriteria).toBeUndefined();
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('pending');
    });

    it('rejects mixed structural and non-structural deliverable criteria', () => {
      const { goals, errors } = applyGoalMutation(
        [],
        {
          action: 'add',
          goals: [
            {
              id: 'mixed-deliverable',
              title: 'mixed deliverable',
              status: 'active',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.prefix:write_file', 'freeform deliverable note'],
            },
          ],
        },
        now,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Unrecognized successCriteria');
      expect(goals).toEqual([]);
    });

    it('keeps unsafe recognized deliverable evidence criteria rejected', () => {
      const { goals, errors } = applyGoalMutation(
        [],
        {
          action: 'add',
          goals: [
            {
              id: 'internal-evidence',
              title: 'internal evidence',
              status: 'active',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.tool:update_goals'],
            },
          ],
        },
        now,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Graph-control and discovery tools');
      expect(goals).toEqual([]);
    });

    it('preserves specific blocking criteria on add when graph already has goals', () => {
      const g1 = createGoal({
        id: 'scope-a',
        title: 'scope-a-planning',
        status: 'active',
        completionPolicy: 'persistent',
      });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'active',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
            },
          ],
        },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((goal) => goal.id === 'scope-b')?.successCriteria).toEqual([
        'evidence.prefix:write_file',
        'evidence.min:1',
      ]);
      expect(goals.find((goal) => goal.id === 'scope-b')?.completionPolicy).toBe('blocking');
      expect(goals.find((goal) => goal.id === 'scope-b')?.status).toBe('active');
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('active');
    });

    it('preserves requested pending status when adding beside an active goal', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'pending',
              completionPolicy: 'persistent',
            },
          ],
        },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((goal) => goal.id === 'scope-b')?.status).toBe('pending');
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('active');
    });

    it('clears stale completion criteria when updating a goal to persistent', () => {
      const goal = createGoal({
        id: 'deliverable',
        title: 'Deliverable',
        status: 'pending',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.prefix:write_file', 'evidence.min:1'],
      });
      const { goals, errors } = applyGoalMutation(
        [goal],
        {
          action: 'update',
          goals: [{ id: 'deliverable', completionPolicy: 'persistent' }],
        },
        now,
      );

      expect(errors).toHaveLength(0);
      expect(goals[0].completionPolicy).toBe('persistent');
      expect(goals[0].successCriteria).toBeUndefined();
    });

    it('rejects add without an explicit completion policy', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'add',
          goals: [{ id: 'scope-b', title: 'scope-b-planning' }],
        },
        now,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('completionPolicy');
      expect(goals).toEqual([g1]);
    });

    it('treats activate on a named missing goal as active persistent add', () => {
      const g1 = createGoal({ id: 'scope-a', title: 'scope-a-planning', status: 'active' });
      const { goals, errors } = applyGoalMutation(
        [g1],
        {
          action: 'activate',
          goals: [{ id: 'scope-b', title: 'scope-b-planning' }],
        },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((goal) => goal.id === 'scope-a')?.status).toBe('pending');
      expect(goals.find((goal) => goal.id === 'scope-b')).toEqual(
        expect.objectContaining({
          title: 'scope-b-planning',
          status: 'active',
          completionPolicy: 'persistent',
        }),
      );
    });

    it('demotes previously active goal when activating another', () => {
      const g1 = createGoal({ id: 'g1', title: 'First', status: 'active' });
      const g2 = createGoal({ id: 'g2', title: 'Second' });
      const { goals } = applyGoalMutation(
        [g1, g2],
        { action: 'activate', goals: [{ id: 'g2' }] },
        now,
      );
      expect(goals.find((g) => g.id === 'g1')?.status).toBe('pending');
      expect(goals.find((g) => g.id === 'g2')?.status).toBe('active');
    });

    it('keeps active persistent scope while activating blocking work', () => {
      const scope = createGoal({
        id: 'scope-a',
        title: 'scope-a-planning',
        status: 'active',
        completionPolicy: 'persistent',
      });
      const work = createGoal({
        id: 'work-1',
        title: 'Write artifact',
        status: 'pending',
        completionPolicy: 'blocking',
      });
      const { goals, errors } = applyGoalMutation(
        [scope, work],
        { action: 'activate', goals: [{ id: 'work-1' }] },
        now,
      );

      expect(errors).toHaveLength(0);
      expect(goals.find((g) => g.id === 'scope-a')?.status).toBe('active');
      expect(goals.find((g) => g.id === 'work-1')?.status).toBe('active');
    });

    it('refuses to activate a goal with uncompleted dependencies', () => {
      const dep = createGoal({ id: 'd1', title: 'Dep', status: 'pending' });
      const g = createGoal({ id: 'g1', title: 'Main', dependencies: ['d1'] });
      const { goals, errors } = applyGoalMutation(
        [dep, g],
        { action: 'activate', goals: [{ id: 'g1' }] },
        now,
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('dependencies');
      expect(goals.find((x) => x.id === 'g1')?.status).toBe('pending');
    });

    it('activates a goal when all dependencies are completed', () => {
      const dep = createGoal({ id: 'd1', title: 'Dep', status: 'completed' });
      const g = createGoal({ id: 'g1', title: 'Main', dependencies: ['d1'] });
      const { goals, errors } = applyGoalMutation(
        [dep, g],
        { action: 'activate', goals: [{ id: 'g1' }] },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((x) => x.id === 'g1')?.status).toBe('active');
    });

    it('rejects blocking a goal with unmet evidence requirements', () => {
      const g = createGoal({
        id: 'g1',
        title: 'Stuck',
        status: 'active',
        successCriteria: ['evidence.min:1'],
      });
      const { goals, errors } = applyGoalMutation(
        [g],
        { action: 'block', goals: [{ id: 'g1', blockedReason: 'gate:g1:evidence.min:1' }] },
        now,
      );
      expect(errors[0]).toContain('Cannot block a blocking goal');
      expect(goals[0].status).toBe('active');
    });

    it('removes a goal', () => {
      const g = createGoal({ id: 'g1', title: 'Remove me' });
      const { goals } = applyGoalMutation([g], { action: 'remove', goals: [{ id: 'g1' }] }, now);
      expect(goals).toHaveLength(0);
    });

    it('cascades removal to dependent goals', () => {
      const g1 = createGoal({ id: 'g1', title: 'Base' });
      const g2 = createGoal({ id: 'g2', title: 'Dependent', dependencies: ['g1'] });
      const { goals } = applyGoalMutation(
        [g1, g2],
        { action: 'remove', goals: [{ id: 'g1' }] },
        now,
      );
      expect(goals).toHaveLength(0);
    });

    it('cascades removal through dependency chains', () => {
      const a = createGoal({ id: 'a', title: 'A' });
      const b = createGoal({ id: 'b', title: 'B', dependencies: ['a'] });
      const c = createGoal({ id: 'c', title: 'C', dependencies: ['b'] });
      const { goals } = applyGoalMutation(
        [a, b, c],
        { action: 'remove', goals: [{ id: 'a' }] },
        now,
      );
      expect(goals).toHaveLength(0);
    });

    it('updates a goal title', () => {
      const g = createGoal({ id: 'g1', title: 'Old' });
      const { goals } = applyGoalMutation(
        [g],
        { action: 'update', goals: [{ id: 'g1', title: 'New' }] },
        now,
      );
      expect(goals[0].title).toBe('New');
      expect(goals[0].updatedAt).toBe(now);
    });

    it('updates a goal description', () => {
      const g = createGoal({ id: 'g1', title: 'A' });
      const { goals } = applyGoalMutation(
        [g],
        { action: 'update', goals: [{ id: 'g1', description: 'New desc' }] },
        now,
      );
      expect(goals[0].description).toBe('New desc');
    });

    it('rejects updating a goal to blocked with unmet evidence requirements', () => {
      const g = createGoal({
        id: 'g1',
        title: 'A',
        status: 'active',
        successCriteria: ['evidence.min:1'],
      });
      const { goals, errors } = applyGoalMutation(
        [g],
        {
          action: 'update',
          goals: [{ id: 'g1', status: 'blocked', blockedReason: 'gate:g1:evidence.min:1' }],
        },
        now,
      );
      expect(errors[0]).toContain('Cannot block a blocking goal');
      expect(goals[0].status).toBe('active');
    });

    it('updates goal dependencies', () => {
      const g = createGoal({ id: 'g1', title: 'A' });
      const dep = createGoal({ id: 'd1', title: 'Dep' });
      const { goals, errors } = applyGoalMutation(
        [g, dep],
        { action: 'update', goals: [{ id: 'g1', dependencies: ['d1'] }] },
        now,
      );
      expect(errors).toHaveLength(0);
      expect(goals.find((x) => x.id === 'g1')?.dependencies).toEqual(['d1']);
    });

    it('appends evidence on update', () => {
      const g = createGoal({ id: 'g1', title: 'A', evidence: ['old'] });
      const { goals } = applyGoalMutation(
        [g],
        { action: 'update', goals: [{ id: 'g1', evidence: ['new'] }] },
        now,
      );
      expect(goals[0].evidence).toEqual(['old', 'new']);
    });

    it('deduplicates evidence', () => {
      const g = createGoal({ id: 'g1', title: 'A', evidence: ['x'] });
      const { goals } = applyGoalMutation(
        [g],
        { action: 'update', goals: [{ id: 'g1', evidence: ['x'] }] },
        now,
      );
      expect(goals[0].evidence).toEqual(['x']);
    });

    it('skips goals with no ID for non-add actions', () => {
      const g = createGoal({ id: 'g1', title: 'A' });
      const { goals } = applyGoalMutation([g], { action: 'complete', goals: [{ id: '' }] }, now);
      expect(goals[0].status).toBe('pending');
    });

    it('returns validation errors without mutating', () => {
      const g = createGoal({ id: 'g1', title: 'A' });
      const { goals, errors } = applyGoalMutation(
        [g],
        { action: 'complete', goals: [{ id: 'missing' }] },
        now,
      );
      expect(errors).toHaveLength(1);
      expect(goals[0].status).toBe('pending');
    });
  });

  describe('addGoalEvidence', () => {
    it('adds evidence to a goal', () => {
      const g = createGoal({ id: 'g1', title: 'A' });
      const goals = addGoalEvidence([g], 'g1', 'tool result', now);
      expect(goals[0].evidence).toContain('tool result');
      expect(goals[0].updatedAt).toBe(now);
    });

    it('does not modify other goals', () => {
      const a = createGoal({ id: 'a', title: 'A' });
      const b = createGoal({ id: 'b', title: 'B' });
      const goals = addGoalEvidence([a, b], 'a', 'evidence', now);
      expect(goals[1].evidence).toHaveLength(0);
    });

    it('deduplicates evidence', () => {
      const g = createGoal({ id: 'g1', title: 'A', evidence: ['x'] });
      const goals = addGoalEvidence([g], 'g1', 'x', now);
      expect(goals[0].evidence).toEqual(['x']);
    });
  });

  describe('computeGoalStateFromSnapshot', () => {
    it('normalizes goals from snapshot', () => {
      const result = computeGoalStateFromSnapshot({
        goals: [{ title: 'A' }, { title: '' }],
        updatedAt: now,
      });
      expect(result.goals).toHaveLength(1);
      expect(result.goals[0].title).toBe('A');
      expect(result.updatedAt).toBe(now);
    });

    it('returns empty state for undefined snapshot', () => {
      const result = computeGoalStateFromSnapshot(undefined);
      expect(result.goals).toHaveLength(0);
      expect(result.updatedAt).toBeGreaterThan(0);
    });
  });

  describe('buildInitialGoalState', () => {
    it('returns empty goals', () => {
      const state = buildInitialGoalState();
      expect(state.goals).toHaveLength(0);
      expect(state.updatedAt).toBeGreaterThan(0);
    });
  });
});
