import {
  buildUpdateGoalsResult,
  executeUpdateGoals,
  parseUpdateGoalsArgs,
} from '../../../src/engine/tools/toolGoalExecution';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import { validateGoalMutation } from '../../../src/engine/goals/validation';

describe('toolGoalExecution', () => {
  describe('update_goals schema contract', () => {
    it('exposes one root-level provider-visible goal mutation', () => {
      expect(UPDATE_GOALS_TOOL.input_schema.required).toEqual(
        expect.arrayContaining(['action', 'id', 'name']),
      );
      expect(UPDATE_GOALS_TOOL.input_schema.properties.goals).toBeUndefined();
      expect(UPDATE_GOALS_TOOL.input_schema.properties.name).toEqual(
        expect.objectContaining({ type: 'string' }),
      );
      expect(UPDATE_GOALS_TOOL.input_schema.properties.completionPolicy).toEqual(
        expect.objectContaining({ enum: ['blocking', 'persistent'] }),
      );
    });
  });

  describe('parseUpdateGoalsArgs', () => {
    it('parses a root-level active persistent add into the graph mutation shape', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'meal-plan',
        name: 'meal-planning-scope',
        status: 'active',
        completionPolicy: 'persistent',
      });

      expect(result.errors).toHaveLength(0);
      expect(result.mutation).toEqual({
        action: 'add',
        goals: [
          {
            id: 'meal-plan',
            title: 'meal-planning-scope',
            status: 'active',
            completionPolicy: 'persistent',
          },
        ],
      });
    });

    it('parses complete, activate, block, remove, and update actions with root id', () => {
      for (const action of ['complete', 'activate', 'block', 'remove', 'update'] as const) {
        const result = parseUpdateGoalsArgs({ action, id: 'g1' });
        expect(result.errors).toHaveLength(0);
        expect(result.mutation).toEqual({ action, goals: [{ id: 'g1' }] });
      }
    });

    it('drops structural completion criteria from persistent focus goals', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'scope-b',
        name: 'scope-b-planning',
        status: 'active',
        completionPolicy: 'persistent',
        successCriteria: ['memory_recall', 'evidence.min:1'],
      });

      expect(result.errors).toHaveLength(0);
      expect(result.mutation.goals[0]).toEqual({
        id: 'scope-b',
        title: 'scope-b-planning',
        status: 'active',
        completionPolicy: 'persistent',
      });
    });

    it('rejects stale nested goal arrays instead of silently accepting two contracts', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        goals: [
          {
            id: 'nested-goal',
            name: 'Nested goal',
            completionPolicy: 'persistent',
          },
        ],
      });

      expect(result.errors).toEqual([
        'id is required for update_goals. Provide the goal fields at the tool argument root.',
      ]);
      expect(result.mutation).toEqual({ action: 'add', goals: [] });
    });

    it('parses all supported root goal fields', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        name: 'Build feature',
        description: 'Implement auth',
        status: 'active',
        dependencies: ['dep1'],
        evidence: ['file created'],
        requiredCapabilities: ['read', 'write'],
        requiredResourceKinds: ['conversation_workspace'],
        owner: 'supervisor',
        successCriteria: ['evidence.min:2', 'evidence.prefix:python'],
        completionPolicy: 'blocking',
        blockedReason: 'Waiting on dependency',
      });

      expect(result.errors).toHaveLength(0);
      expect(result.mutation.goals[0]).toEqual({
        id: 'g1',
        title: 'Build feature',
        description: 'Implement auth',
        status: 'active',
        dependencies: ['dep1'],
        evidence: ['file created'],
        requiredCapabilities: ['read', 'write'],
        requiredResourceKinds: ['conversation_workspace'],
        owner: 'supervisor',
        successCriteria: ['evidence.min:2', 'evidence.prefix:python'],
        completionPolicy: 'blocking',
        blockedReason: 'Waiting on dependency',
      });
    });

    it('preserves missing add titles for graph validation instead of inventing focus labels', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'scope-b',
        status: 'active',
        completionPolicy: 'persistent',
      });

      expect(result.errors).toHaveLength(0);
      expect(result.mutation.goals[0]).toEqual(
        expect.objectContaining({
          id: 'scope-b',
          status: 'active',
          completionPolicy: 'persistent',
        }),
      );
      expect(result.mutation.goals[0].title).toBeUndefined();
      expect(validateGoalMutation(result.mutation, []).errors).toContainEqual(
        expect.objectContaining({ code: 'missing_title', goalId: 'scope-b' }),
      );
    });

    it('normalizes invalid status and completion policy out of parsed goals', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        name: 'Test',
        status: 'unknown',
        completionPolicy: 'invalid',
      });

      expect(result.errors).toHaveLength(0);
      expect(result.mutation.goals[0].status).toBeUndefined();
      expect(result.mutation.goals[0].completionPolicy).toBeUndefined();
    });

    it('filters non-string array items', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        name: 'Test',
        completionPolicy: 'persistent',
        dependencies: ['a', 123, null, 'b'],
        evidence: [true, 'x'],
        requiredCapabilities: [{}, 'cap'],
      });

      expect(result.mutation.goals[0].dependencies).toEqual(['a', 'b']);
      expect(result.mutation.goals[0].evidence).toEqual(['x']);
      expect(result.mutation.goals[0].requiredCapabilities).toEqual(['cap']);
    });
  });

  describe('buildUpdateGoalsResult', () => {
    it('builds success result', () => {
      const result = buildUpdateGoalsResult({
        mutation: { action: 'add', goals: [{ id: 'g1', title: 'Build' }] },
        validationErrors: [],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('ok');
      expect(parsed.action).toBe('add');
      expect(parsed.goals).toHaveLength(1);
    });

    it('builds error result', () => {
      const result = buildUpdateGoalsResult({
        mutation: { action: 'add', goals: [{ id: 'g1', title: 'Build' }] },
        validationErrors: ['Title too short'],
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
      expect(parsed.errors).toContain('Title too short');
    });
  });

  describe('executeUpdateGoals', () => {
    it('returns ok for valid root add', () => {
      const result = executeUpdateGoals({
        action: 'add',
        id: 'g1',
        name: 'Build feature',
        completionPolicy: 'persistent',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('ok');
    });

    it('returns error for invalid action', () => {
      const result = executeUpdateGoals({
        action: 'invalid',
        id: 'g1',
        name: 'X',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
    });

    it('returns error for missing id', () => {
      const result = executeUpdateGoals({
        action: 'add',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('error');
    });

    it('returns ok for complete with id because graph validation is deferred', () => {
      const result = executeUpdateGoals({
        action: 'complete',
        id: 'g1',
      });
      const parsed = JSON.parse(result);
      expect(parsed.status).toBe('ok');
      expect(parsed.action).toBe('complete');
    });
  });
});
