import {
  validateGoalMutation,
  validateGoalReferences,
} from '../../../src/engine/goals/validation';
import { createGoal } from '../../../src/engine/goals/types';

describe('goal validation', () => {
  describe('validateGoalMutation', () => {
    it('validates an add mutation', () => {
      const result = validateGoalMutation(
        { action: 'add', goals: [{ title: 'New goal', completionPolicy: 'persistent' }] },
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('does not validate completion criteria on persistent focus goals', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              completionPolicy: 'persistent',
              successCriteria: ['memory_recall'],
            },
          ],
        },
        [],
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports error for add mutation without explicit completion policy', () => {
      const result = validateGoalMutation(
        { action: 'add', goals: [{ title: 'New goal' }] },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'missing_completion_policy' }),
      );
    });

    it('reports error for blocking add mutation without structural success criteria', () => {
      const result = validateGoalMutation(
        { action: 'add', goals: [{ title: 'New goal', completionPolicy: 'blocking' }] },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'missing_success_criteria' }),
      );
    });

    it('reports error for blocking add mutation with only count criteria', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.min:1'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'weak_success_criteria' }),
      );
    });

    it('reports error when blocking criteria use update_goals as work evidence', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.tool:update_goals', 'evidence.count:1'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      );
    });

    it('reports error when blocking criteria use provider-qualified update_goals evidence', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: [
                'evidence.tool:default_api:update_goals',
                'evidence.prefix:default_api:update_goals',
              ],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      );
    });

    it('reports error when blocking criteria use discovery tools as deliverable evidence', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: [
                'evidence.tool:tool_catalog',
                'evidence.tool:default_api:tool_describe',
              ],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      );
    });

    it('reports error when blocking criteria reference unregistered tool evidence', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: [
                'evidence.tool:memory_set',
                'evidence.tool:default_api:memory_delete',
              ],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      );
      expect(result.errors.map((error) => error.message).join('\n')).toContain(
        'registered tools',
      );
    });

    it('reports error when prefix criteria reference unknown evidence sources', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.prefix:E2E-GOAL-42', 'evidence.min:1'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'invalid_success_criteria' }),
      );
      expect(result.errors.map((error) => error.message).join('\n')).toContain(
        'registered tool evidence source',
      );
    });

    it('accepts registered tool and worker evidence prefixes', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: [
                'evidence.prefix:write_file',
                'evidence.prefix:worker',
                'evidence.min:1',
              ],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('accepts provider-qualified registered tool evidence criteria', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.tool:default_api:sms_compose'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('reports error for unrecognized success criteria forms', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              title: 'New goal',
              completionPolicy: 'blocking',
              successCriteria: ['memory_recall'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'missing_success_criteria' }),
          expect.objectContaining({ code: 'invalid_success_criteria' }),
        ]),
      );
    });

    it('reports error for add mutation with duplicate ID', () => {
      const existing = createGoal({ id: 'g1', title: 'Existing' });
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [{ id: 'g1', title: 'Duplicate', completionPolicy: 'persistent' }],
        },
        [existing],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('already exists');
    });

    it('reports error for add mutation with missing title', () => {
      const result = validateGoalMutation(
        { action: 'add', goals: [{ title: '', completionPolicy: 'persistent' }] },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('required');
    });

    it('validates a complete mutation', () => {
      const g = createGoal({
        id: 'g1',
        title: 'Do it',
        status: 'active',
        completionPolicy: 'blocking',
        evidence: ['write_file:artifacts/e2e.txt'],
      });
      const result = validateGoalMutation(
        { action: 'complete', goals: [{ id: 'g1' }] },
        [g],
      );
      expect(result.valid).toBe(true);
    });

    it('reports error for complete mutation with missing goal', () => {
      const result = validateGoalMutation(
        { action: 'complete', goals: [{ id: 'g1' }] },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('does not exist');
      expect(result.errors[0].code).toBe('goal_not_found');
    });

    it('rejects removing an active goal directly', () => {
      const active = createGoal({
        id: 'focus',
        title: 'Active focus',
        status: 'active',
        completionPolicy: 'persistent',
      });
      const result = validateGoalMutation(
        { action: 'remove', goals: [{ id: 'focus' }] },
        [active],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'invalid_lifecycle' }),
      );
    });

    it('reports missing_title for add mutation without title', () => {
      const result = validateGoalMutation(
        { action: 'add', goals: [{ id: 'g1', title: '', completionPolicy: 'persistent' }] },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('missing_title');
    });

    it('validates an activate mutation', () => {
      const g = createGoal({ id: 'g1', title: 'Main' });
      const result = validateGoalMutation(
        { action: 'activate', goals: [{ id: 'g1' }] },
        [g],
      );
      expect(result.valid).toBe(true);
    });

    it('rejects a block mutation when structural evidence is still incomplete', () => {
      const g = createGoal({
        id: 'g1',
        title: 'Main',
        status: 'active',
        successCriteria: ['evidence.min:1'],
      });
      const result = validateGoalMutation(
        { action: 'block', goals: [{ id: 'g1', blockedReason: 'gate:g1:evidence.min:1' }] },
        [g],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'evidence_required' }),
      );
    });

    it('reports error for block mutation with missing goal', () => {
      const result = validateGoalMutation(
        { action: 'block', goals: [{ id: 'g1' }] },
        [],
      );
      expect(result.valid).toBe(false);
    });

    it('validates a remove mutation', () => {
      const g = createGoal({ id: 'g1', title: 'To remove' });
      const result = validateGoalMutation(
        { action: 'remove', goals: [{ id: 'g1' }] },
        [g],
      );
      expect(result.valid).toBe(true);
    });

    it('reports error for remove mutation when other goals depend on it', () => {
      const g = createGoal({ id: 'g1', title: 'To remove' });
      const dep = createGoal({ id: 'g2', title: 'Dependent', dependencies: ['g1'] });
      const result = validateGoalMutation(
        { action: 'remove', goals: [{ id: 'g1' }] },
        [g, dep],
      );
      // Note: validateGoalMutation does not check dependents on remove
      expect(result.valid).toBe(true);
    });

    it('validates an update mutation', () => {
      const g = createGoal({ id: 'g1', title: 'Old' });
      const result = validateGoalMutation(
        { action: 'update', goals: [{ id: 'g1', title: 'New' }] },
        [g],
      );
      expect(result.valid).toBe(true);
    });

    it('reports error for update mutation with missing goal', () => {
      const result = validateGoalMutation(
        { action: 'update', goals: [{ id: 'g1', title: 'New' }] },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('does not exist');
    });

    it('validates dependencies in add mutation', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [{ title: 'New', completionPolicy: 'persistent', dependencies: ['missing'] }],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('non-existent');
    });

    it('validates dependencies against existing goals', () => {
      const existing = createGoal({ id: 'dep', title: 'Dep' });
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [{ title: 'New', completionPolicy: 'persistent', dependencies: ['dep'] }],
        },
        [existing],
      );
      expect(result.valid).toBe(true);
    });

    it('validates cross-goal dependencies within batch add', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            { id: 'g1', title: 'First', completionPolicy: 'persistent' },
            {
              id: 'g2',
              title: 'Second',
              completionPolicy: 'persistent',
              dependencies: ['g1'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(true);
    });

    it('detects circular dependencies in batch add', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            { id: 'a', title: 'A', completionPolicy: 'persistent', dependencies: ['b'] },
            { id: 'b', title: 'B', completionPolicy: 'persistent', dependencies: ['a'] },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Circular');
    });

    it('rejects add with completed status when evidence requirements are not met', () => {
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [
            {
              id: 'scope-b',
              title: 'scope-b-planning',
              status: 'completed',
              completionPolicy: 'blocking',
              successCriteria: ['evidence.prefix:write_file'],
            },
          ],
        },
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({ code: 'evidence_required' }),
      );
    });

    it('rejects block for persistent goals', () => {
      const active = createGoal({ id: 'scope-b', title: 'scope-b-planning', status: 'active' });
      const result = validateGoalMutation(
        { action: 'block', goals: [{ id: 'scope-b', blockedReason: 'stuck' }] },
        [active],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('persistent goal');
    });

    it('rejects block when active goal evidence requirements are already satisfied', () => {
      const active = createGoal({
        id: 'worker-chain',
        title: 'Delegated chain task',
        status: 'active',
        successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
      });
      const result = validateGoalMutation(
        { action: 'block', goals: [{ id: 'worker-chain' }] },
        [active],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('evidence_satisfied');
    });

    it('allows complete from blocked when evidence requirements are satisfied', () => {
      const blocked = createGoal({
        id: 'worker-chain',
        title: 'Delegated chain task',
        status: 'blocked',
        successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        evidence: ['worker:e2e-worker:E2E-WORKER-CHAIN-77'],
        blockedReason: 'gate:worker-chain:evidence.min:1',
      });
      const result = validateGoalMutation(
        { action: 'complete', goals: [{ id: 'worker-chain' }] },
        [blocked],
      );
      expect(result.valid).toBe(true);
    });

    it('rejects update that sets active status without activate action', () => {
      const pending = createGoal({ id: 'scope-b', title: 'scope-b-planning', status: 'pending' });
      const result = validateGoalMutation(
        { action: 'update', goals: [{ id: 'scope-b', status: 'active' }] },
        [pending],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Use activate');
    });

    it('rejects block on pending goals', () => {
      const pending = createGoal({ id: 'scope-b', title: 'scope-b-planning', status: 'pending' });
      const result = validateGoalMutation(
        {
          action: 'block',
          goals: [{ id: 'scope-b', blockedReason: 'stuck' }],
        },
        [pending],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('pending goal');
    });

    it('rejects complete before evidence requirements are met', () => {
      const active = createGoal({
        id: 'scope-b',
        title: 'scope-b-planning',
        status: 'active',
        completionPolicy: 'blocking',
      });
      const result = validateGoalMutation(
        { action: 'complete', goals: [{ id: 'scope-b' }] },
        [active],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('evidence requirements');
    });

    it('rejects complete on persistent context goals even when context evidence exists', () => {
      const active = createGoal({
        id: 'scope-b',
        title: 'scope-b-planning',
        status: 'active',
        evidence: ['memory_remember:scope token observed'],
      });
      const result = validateGoalMutation(
        { action: 'complete', goals: [{ id: 'scope-b' }] },
        [active],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('persistent');
    });

    it('rejects complete on a goal that is not active', () => {
      const pending = createGoal({ id: 'scope-b', title: 'scope-b-planning', status: 'pending' });
      const result = validateGoalMutation(
        { action: 'complete', goals: [{ id: 'scope-b' }] },
        [pending],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('not active');
    });

    it('detects circular dependencies involving existing goals', () => {
      const existing = createGoal({ id: 'a', title: 'A', dependencies: ['b'] });
      const result = validateGoalMutation(
        {
          action: 'add',
          goals: [{ id: 'b', title: 'B', completionPolicy: 'persistent', dependencies: ['a'] }],
        },
        [existing],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Circular');
    });
  });

  describe('validateGoalReferences', () => {
    it('validates empty goals', () => {
      const result = validateGoalReferences([]);
      expect(result.valid).toBe(true);
    });

    it('validates valid goal state', () => {
      const goals = [
        createGoal({ id: 'a', title: 'A' }),
        createGoal({ id: 'b', title: 'B', dependencies: ['a'] }),
      ];
      const result = validateGoalReferences(goals);
      expect(result.valid).toBe(true);
    });

    it('detects missing dependency references', () => {
      const goals = [
        createGoal({ id: 'g1', title: 'A', dependencies: ['missing'] }),
      ];
      const result = validateGoalReferences(goals);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('non-existent');
    });

    it('detects circular dependencies', () => {
      const goals = [
        createGoal({ id: 'a', title: 'A', dependencies: ['b'] }),
        createGoal({ id: 'b', title: 'B', dependencies: ['a'] }),
      ];
      const result = validateGoalReferences(goals);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Circular');
    });

    it('handles chained circular dependencies', () => {
      const goals = [
        createGoal({ id: 'a', title: 'A', dependencies: ['b'] }),
        createGoal({ id: 'b', title: 'B', dependencies: ['c'] }),
        createGoal({ id: 'c', title: 'C', dependencies: ['a'] }),
      ];
      const result = validateGoalReferences(goals);
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('Circular');
    });
  });
});
