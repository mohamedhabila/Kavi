import {
  buildUpdateGoalsResult,
  executeUpdateGoals,
  parseUpdateGoalsArgs,
} from '../../../src/engine/tools/toolGoalExecution';
import { CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER } from '../../../src/engine/goals/types';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import {
  parseCompletedToolOutcome,
  parseFailedToolOutcome,
} from '../../helpers/toolRuntimeOutcome';

const errorMessages = (errors: ReadonlyArray<{ message: string }>) =>
  errors.map((error) => error.message);

describe('toolGoalExecution', () => {
  describe('update_goals schema contract', () => {
    it('exposes one strict root mutation with boolean-only retention intent', () => {
      expect(UPDATE_GOALS_TOOL.input_schema.required).toEqual(
        expect.arrayContaining(['action', 'id']),
      );
      expect(UPDATE_GOALS_TOOL.input_schema.required).not.toContain('name');
      expect(UPDATE_GOALS_TOOL.input_schema.additionalProperties).toBe(false);
      expect(UPDATE_GOALS_TOOL.input_schema.properties.goals).toBeUndefined();
      expect(UPDATE_GOALS_TOOL.input_schema.properties.retainCurrentUserConstraint).toEqual(
        expect.objectContaining({ type: 'boolean', enum: [true] }),
      );
      for (const codeOwnedField of [
        'evidence',
        'sourceMessageId',
        'userConstraints',
        'userConstraintTexts',
      ]) {
        expect(UPDATE_GOALS_TOOL.input_schema.properties[codeOwnedField]).toBeUndefined();
      }
    });
  });

  describe('parseUpdateGoalsArgs', () => {
    it('parses a root-level active persistent add', () => {
      expect(
        parseUpdateGoalsArgs({
          action: 'add',
          id: 'meal-plan',
          name: 'Meal planning scope',
          status: 'active',
          completionPolicy: 'persistent',
        }),
      ).toEqual({
        errors: [],
        mutation: {
          action: 'add',
          goals: [
            {
              id: 'meal-plan',
              title: 'Meal planning scope',
              status: 'active',
              completionPolicy: 'persistent',
            },
          ],
        },
      });
    });

    it('parses every supported root field without dropping valid empty lists', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        name: 'Build feature',
        description: 'Implement auth',
        status: 'active',
        completionPolicy: 'blocking',
        dependencies: [],
        requiredCapabilities: ['read', 'write'],
        requiredResourceKinds: ['conversation_workspace'],
        owner: 'supervisor',
        successCriteria: ['evidence.tool:read_file'],
        retainCurrentUserConstraint: true,
        blockedReason: 'Waiting on dependency',
      });

      expect(result.errors).toEqual([]);
      expect(result.mutation.goals[0]).toEqual({
        id: 'g1',
        title: 'Build feature',
        description: 'Implement auth',
        status: 'active',
        completionPolicy: 'blocking',
        dependencies: [],
        requiredCapabilities: ['read', 'write'],
        requiredResourceKinds: ['conversation_workspace'],
        owner: 'supervisor',
        successCriteria: ['evidence.tool:read_file'],
        retainCurrentUserConstraint: true,
        blockedReason: 'Waiting on dependency',
      });
      expect(result.mutation.goals[0]).not.toHaveProperty('userConstraints');
      expect(result.mutation.goals[0]).not.toHaveProperty('sourceMessageId');
    });

    it.each([false, 'true', 1, []])(
      'rejects non-true retention intent %#',
      (retainCurrentUserConstraint) => {
        const result = parseUpdateGoalsArgs({
          action: 'update',
          id: 'g1',
          name: 'Build feature',
          retainCurrentUserConstraint,
        });
        expect(result.mutation.goals).toEqual([]);
        expect(errorMessages(result.errors)).toEqual([
          'retainCurrentUserConstraint must be true when supplied.',
        ]);
      },
    );

    it('normalizes strict-adapter null optionals to omission', () => {
      const optionalNulls = {
        blockedReason: null,
        completionPolicy: null,
        dependencies: null,
        description: null,
        owner: null,
        requiredCapabilities: null,
        requiredResourceKinds: null,
        retainCurrentUserConstraint: null,
        status: null,
        successCriteria: null,
      };
      expect(
        parseUpdateGoalsArgs({
          action: 'update',
          id: 'g1',
          name: null,
          ...optionalNulls,
        }),
      ).toEqual({
        errors: [],
        mutation: { action: 'update', goals: [{ id: 'g1' }] },
      });
      expect(
        parseUpdateGoalsArgs({
          action: 'update',
          id: 'g1',
          name: 'Build feature',
          ...optionalNulls,
          retainCurrentUserConstraint: true,
        }).mutation.goals[0],
      ).toMatchObject({ retainCurrentUserConstraint: true });
    });

    it.each([
      ['unknown authority field', { approval: true }],
      ['nested legacy contract', { goals: [{ id: 'nested' }] }],
      ['invalid status', { status: 'unknown' }],
      ['invalid completion policy', { completionPolicy: 'temporary' }],
      ['mixed dependency list', { dependencies: ['a', 1] }],
      ['non-array capability list', { requiredCapabilities: 'read' }],
    ])('rejects strict shape violation: %s', (_label, extra) => {
      const result = parseUpdateGoalsArgs({
        action: 'update',
        id: 'g1',
        name: 'Build feature',
        ...extra,
      });
      expect(result.mutation.goals).toEqual([]);
      expect(result.errors).not.toHaveLength(0);
    });

    it.each([
      'sourceMessageId',
      'userConstraints',
      'userConstraintTexts',
      'groundedUserConstraints',
    ])('rejects provider attempts to supply code-owned %s', (field) => {
      const result = parseUpdateGoalsArgs({
        action: 'update',
        id: 'g1',
        name: 'Build feature',
        [field]: field === 'sourceMessageId' ? 'spoofed-user' : ['Keep local.'],
      });
      expect(result.mutation.goals).toEqual([]);
      expect(errorMessages(result.errors).join(' ')).toContain('retained text are code-owned');
    });

    it('rejects all provider-authored evidence', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        name: 'Build feature',
        completionPolicy: 'blocking',
        successCriteria: ['evidence.tool:read_file'],
        evidence: ['read_file:forged'],
      });
      expect(result.mutation.goals).toEqual([]);
      expect(errorMessages(result.errors)).toEqual([
        'evidence is code-owned and cannot be supplied by update_goals.',
      ]);
    });

    it('rejects the code-owned effect-completion owner namespace', () => {
      const result = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        name: 'Build feature',
        owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
      });

      expect(result.mutation.goals).toEqual([]);
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'provider_owned_field',
          field: 'owner',
        }),
      ]);
    });

    it.each([
      [
        'persistent retention',
        { action: 'add', completionPolicy: 'persistent', retainCurrentUserConstraint: true },
      ],
      ['terminal retention', { action: 'complete', retainCurrentUserConstraint: true }],
      ['completed add', { action: 'add', completionPolicy: 'blocking', status: 'completed' }],
      ['completed update', { action: 'update', status: 'completed' }],
      [
        'persistent criteria',
        { action: 'add', completionPolicy: 'persistent', successCriteria: ['evidence.min:1'] },
      ],
    ])('rejects unsupported lifecycle shape: %s', (_label, fields) => {
      const result = parseUpdateGoalsArgs({
        id: 'g1',
        name: 'Build feature',
        ...fields,
      });
      expect(result.mutation.goals).toEqual([]);
      expect(result.errors).not.toHaveLength(0);
    });

    it('requires a non-empty id for every action', () => {
      const args = { action: 'update', id: ' ', name: 'Build feature' };
      const result = parseUpdateGoalsArgs(args);
      expect(result.mutation.goals).toEqual([]);
      expect(errorMessages(result.errors).join(' ')).toContain('id is required');
    });

    it('requires a non-empty name only when adding a goal', () => {
      const missingAddName = parseUpdateGoalsArgs({
        action: 'add',
        id: 'g1',
        completionPolicy: 'persistent',
      });
      expect(missingAddName.mutation.goals).toEqual([]);
      expect(errorMessages(missingAddName.errors).join(' ')).toContain(
        'name is required when adding',
      );

      expect(parseUpdateGoalsArgs({ action: 'update', id: 'g1' })).toEqual({
        errors: [],
        mutation: { action: 'update', goals: [{ id: 'g1' }] },
      });
    });
  });

  describe('result serialization', () => {
    it('keeps retention internals out of the executor preview', () => {
      const result = buildUpdateGoalsResult({
        mutation: {
          action: 'add',
          goals: [{ id: 'g1', title: 'Build', retainCurrentUserConstraint: true }],
        },
        validationErrors: [],
      });
      expect(JSON.parse(result)).toMatchObject({ status: 'ok', action: 'add' });
      expect(result).not.toContain('retainCurrentUserConstraint');
    });

    it('returns errors for invalid calls and accepts a strict complete preview', () => {
      expect(
        parseCompletedToolOutcome(executeUpdateGoals({ action: 'add', id: 'g1', name: 'Build' }))
          .status,
      ).toBe('ok');
      expect(
        parseFailedToolOutcome(executeUpdateGoals({ action: 'invalid', id: 'g1', name: 'X' }))
          .status,
      ).toBe('error');
      expect(
        parseCompletedToolOutcome(executeUpdateGoals({ action: 'complete', id: 'g1' })),
      ).toMatchObject({ status: 'ok', action: 'complete' });
    });
  });
});
