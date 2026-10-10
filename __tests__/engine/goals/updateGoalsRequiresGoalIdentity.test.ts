import { validateToolArgumentsAgainstSchema } from '../../../src/engine/toolExecution/toolArgumentSchemaValidation';
import { UPDATE_GOALS_TOOL } from '../../../src/engine/tools/goal-definitions';
import { executeUpdateGoals } from '../../../src/engine/tools/toolGoalExecution';

// On OpenRouter's InferenceNet upstream, GLM 5.3 Flash sent update_goals as bare
// {"action":"add"} — schema-valid while only `action` was required — and live runs looped
// into loop_detected. Declaring the documented `id` requirement made the same upstream
// identify the goal in every forced call, and a call that still names none is refused
// with repair guidance instead of being answered "ok, nothing recorded".

function validate(args: Record<string, unknown>) {
  const result = validateToolArgumentsAgainstSchema({
    toolName: 'update_goals',
    argumentsText: JSON.stringify(args),
    tools: [UPDATE_GOALS_TOOL],
  });
  return result
    ? (JSON.parse(result) as { code?: string; missingRequiredArguments?: string[] })
    : undefined;
}

describe('update_goals goal identity', () => {
  it('declares the goal id it documents as required', () => {
    expect(UPDATE_GOALS_TOOL.input_schema.required).toEqual(['action', 'id']);
  });

  it('refuses a call that names no goal', () => {
    expect(validate({ action: 'add' })).toMatchObject({
      code: 'missing_required_argument',
      missingRequiredArguments: ['id'],
    });
  });

  it('accepts a single goal named at the root', () => {
    expect(validate({ action: 'add', id: 'worker-task', name: 'Worker task' })).toBeUndefined();
  });

  it('accepts a batch whose every entry names its goal', () => {
    expect(
      validate({
        action: 'add',
        goals: [
          { id: 'study', name: 'Study', status: 'active' },
          { id: 'worker', name: 'Worker', status: 'pending' },
        ],
      }),
    ).toBeUndefined();
  });

  it('refuses a batch with an entry that names no goal', () => {
    expect(
      validate({ action: 'complete', goals: [{ id: 'study' }, { status: 'completed' }] }),
    ).toBeDefined();
  });

  it('classifies a refused goal mutation as invalid arguments', () => {
    // The upstream health check reads this classification to tell a mangled call apart
    // from any other failure.
    expect(executeUpdateGoals({ action: 'add', id: 'worker-task' })).toMatchObject({
      status: 'failed',
      failureKind: 'invalid_arguments',
    });
  });
});
