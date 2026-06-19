import {
  createGoal,
  getActiveGoal,
  getActiveGoalId,
  getGoalById,
  isBlockingGoal,
  normalizeGoal,
  normalizeGoalCompletionPolicy,
  normalizeGoals,
  normalizeGoalStatus,
  resolveGoalCompletionPolicy,
} from '../../../src/engine/goals/types';

describe('goal types', () => {
  describe('createGoal', () => {
    it('creates a goal with defaults', () => {
      const goal = createGoal({ title: 'Test goal' });
      expect(goal.title).toBe('Test goal');
      expect(goal.status).toBe('pending');
      expect(goal.completionPolicy).toBe('persistent');
      expect(goal.dependencies).toEqual([]);
      expect(goal.evidence).toEqual([]);
      expect(goal.id).toMatch(/^goal_/);
    });

    it('creates a goal with all fields', () => {
      const goal = createGoal({
        id: 'g1',
        title: 'Build feature',
        description: 'Implement the auth flow',
        status: 'active',
        dependencies: ['g0'],
        evidence: ['read_file result'],
        owner: 'supervisor',
        requiredCapabilities: ['write', 'commit'],
        requiredResourceKinds: ['conversation_workspace'],
        successCriteria: ['evidence.min:1'],
        now: 1000,
      });
      expect(goal).toMatchObject({
        id: 'g1',
        title: 'Build feature',
        description: 'Implement the auth flow',
        status: 'active',
        dependencies: ['g0'],
        evidence: ['read_file result'],
        owner: 'supervisor',
        requiredCapabilities: ['write', 'commit'],
        requiredResourceKinds: ['conversation_workspace'],
        successCriteria: ['evidence.min:1'],
        completionPolicy: 'blocking',
        createdAt: 1000,
        updatedAt: 1000,
      });
    });

    it('defaults goals with success criteria to blocking', () => {
      const goal = createGoal({
        title: 'Write artifact',
        successCriteria: ['evidence.prefix:write_file'],
      });

      expect(goal.completionPolicy).toBe('blocking');
      expect(resolveGoalCompletionPolicy(goal)).toBe('blocking');
      expect(isBlockingGoal(goal)).toBe(true);
    });

    it('allows explicit persistent policy for non-blocking scopes', () => {
      const goal = createGoal({
        title: 'Remember active focus',
        completionPolicy: 'persistent',
        successCriteria: ['evidence.min:1'],
      });

      expect(resolveGoalCompletionPolicy(goal)).toBe('persistent');
      expect(isBlockingGoal(goal)).toBe(false);
      expect(goal.successCriteria).toBeUndefined();
    });

    it('deduplicates dependencies and evidence', () => {
      const goal = createGoal({
        title: 'Test',
        dependencies: ['a', 'a', 'b'],
        evidence: ['x', 'x'],
      });
      expect(goal.dependencies).toEqual(['a', 'b']);
      expect(goal.evidence).toEqual(['x']);
    });
  });

  describe('normalizeGoal', () => {
    it('normalizes a valid goal object', () => {
      const result = normalizeGoal({
        id: 'g1',
        title: 'Test',
        status: 'active',
        dependencies: ['g0'],
        evidence: ['result'],
        createdAt: 1000,
        updatedAt: 2000,
        completionPolicy: 'persistent',
      });
      expect(result).toMatchObject({
        id: 'g1',
        title: 'Test',
        status: 'active',
        dependencies: ['g0'],
        evidence: ['result'],
        createdAt: 1000,
        updatedAt: 2000,
        completionPolicy: 'persistent',
      });
    });

    it('migrates legacy goals with success criteria to blocking', () => {
      const result = normalizeGoal({
        title: 'Write artifact',
        status: 'active',
        successCriteria: ['evidence.min:1'],
      });

      expect(result?.completionPolicy).toBe('blocking');
    });

    it('drops structural completion criteria from explicit persistent goals', () => {
      const result = normalizeGoal({
        title: 'Remember active focus',
        status: 'active',
        completionPolicy: 'persistent',
        successCriteria: ['evidence.min:1'],
      });

      expect(result?.completionPolicy).toBe('persistent');
      expect(result?.successCriteria).toBeUndefined();
    });

    it('returns null for invalid input', () => {
      expect(normalizeGoal(null)).toBeNull();
      expect(normalizeGoal({})).toBeNull();
      expect(normalizeGoal({ title: '' })).toBeNull();
      expect(normalizeGoal({ id: 'g1' })).toBeNull();
    });

    it('generates an ID if missing', () => {
      const result = normalizeGoal({ title: 'Test' });
      expect(result?.id).toMatch(/^goal_/);
    });

    it('defaults status to pending', () => {
      const result = normalizeGoal({ title: 'Test', status: 'unknown' });
      expect(result?.status).toBe('pending');
    });

    it('filters invalid dependencies and evidence', () => {
      const result = normalizeGoal({
        title: 'Test',
        dependencies: ['a', 123, '', null, 'b'],
        evidence: ['x', 456, ''],
      });
      expect(result?.dependencies).toEqual(['a', 'b']);
      expect(result?.evidence).toEqual(['x']);
    });

    it('sets completedAt only when status is completed', () => {
      const active = normalizeGoal({ title: 'Test', status: 'active', completedAt: 1000 });
      expect(active?.completedAt).toBeUndefined();

      const completed = normalizeGoal({ title: 'Test', status: 'completed', completedAt: 1000 });
      expect(completed?.completedAt).toBe(1000);
    });
  });

  describe('normalizeGoals', () => {
    it('normalizes an array of goals', () => {
      const results = normalizeGoals([
        { title: 'A' },
        { title: 'B', status: 'active' },
        null,
        { title: '' },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('A');
      expect(results[1].title).toBe('B');
    });

    it('returns empty array for non-array input', () => {
      expect(normalizeGoals(null)).toEqual([]);
      expect(normalizeGoals('string')).toEqual([]);
    });
  });

  describe('normalizeGoalStatus', () => {
    it('returns valid statuses', () => {
      expect(normalizeGoalStatus('pending')).toBe('pending');
      expect(normalizeGoalStatus('active')).toBe('active');
      expect(normalizeGoalStatus('completed')).toBe('completed');
      expect(normalizeGoalStatus('blocked')).toBe('blocked');
    });

    it('defaults invalid statuses to pending', () => {
      expect(normalizeGoalStatus('unknown')).toBe('pending');
      expect(normalizeGoalStatus(123)).toBe('pending');
      expect(normalizeGoalStatus(null)).toBe('pending');
    });
  });

  describe('normalizeGoalCompletionPolicy', () => {
    it('returns valid completion policies', () => {
      expect(normalizeGoalCompletionPolicy('blocking')).toBe('blocking');
      expect(normalizeGoalCompletionPolicy('persistent')).toBe('persistent');
    });

    it('returns undefined for invalid policies', () => {
      expect(normalizeGoalCompletionPolicy('unknown')).toBeUndefined();
      expect(normalizeGoalCompletionPolicy(null)).toBeUndefined();
    });
  });

  describe('getActiveGoalId', () => {
    it('returns the last active goal ID', () => {
      const goals = [
        createGoal({ title: 'A', status: 'completed' }),
        createGoal({ title: 'B', status: 'active' }),
        createGoal({ title: 'C', status: 'pending' }),
      ];
      expect(getActiveGoalId(goals)).toBe(goals[1].id);
    });

    it('returns null when no active goal', () => {
      expect(getActiveGoalId([createGoal({ title: 'A', status: 'pending' })])).toBeNull();
      expect(getActiveGoalId([])).toBeNull();
    });
  });

  describe('getActiveGoal', () => {
    it('returns the last active goal', () => {
      const goals = [
        createGoal({ title: 'A', status: 'active' }),
        createGoal({ title: 'B', status: 'pending' }),
      ];
      expect(getActiveGoal(goals)?.title).toBe('A');
    });

    it('returns null when no active goal', () => {
      expect(getActiveGoal([])).toBeNull();
    });
  });

  describe('getGoalById', () => {
    it('finds a goal by ID', () => {
      const g = createGoal({ id: 'x', title: 'Find me' });
      expect(getGoalById([g], 'x')?.title).toBe('Find me');
    });

    it('returns null when not found', () => {
      expect(getGoalById([], 'x')).toBeNull();
    });
  });
});
