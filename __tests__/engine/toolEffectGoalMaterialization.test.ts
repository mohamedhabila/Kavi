import { createGoal } from '../../src/engine/goals/types';
import { materializeToolEffectCompletionGoals } from '../../src/engine/graph/toolEffectGoalMaterialization';
import { resolveToolEffectCompletionRequirement } from '../../src/engine/toolExecution/toolEffectCompletionContract';

async function effectCriterion(toolName: string, argumentsText: string): Promise<string> {
  const requirement = await resolveToolEffectCompletionRequirement({ toolName, argumentsText });
  if (requirement.kind !== 'effectful') {
    throw new Error(`${toolName} must have an effect completion contract`);
  }
  return requirement.serializedCriterion;
}

describe('code-owned effect completion goal materialization', () => {
  it('creates content-free completion bookkeeping before an unowned effect', async () => {
    const argumentsText = JSON.stringify({
      subject: 'private-user',
      predicate: 'favorite_color',
      value: 'private-value',
      scope: 'global',
    });

    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'memory_remember', arguments: argumentsText }],
      goals: [],
      now: 100,
    });

    expect(result.status).toBe('materialized');
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^effect-memory-remember-[a-f0-9]{24}$/u),
        title: 'Verify memory_remember effect',
        status: 'active',
        completionPolicy: 'blocking',
        successCriteria: [expect.stringMatching(/^evidence\.effect:/u)],
      }),
    );
    expect(JSON.stringify({ id: result.goals[0]?.id, title: result.goals[0]?.title })).not.toContain(
      'private',
    );
  });

  it('adds the exact receipt criterion to the active blocking deliverable', async () => {
    const argumentsText = JSON.stringify({ path: 'reports/final.md', content: 'done' });
    const criterion = await effectCriterion('write_file', argumentsText);
    const existing = createGoal({
      id: 'deliverable',
      title: 'Prepare report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: ['evidence.tool:read_file'],
      evidence: ['read_file:observed_result:tc-read'],
      now: 10,
    });

    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'write_file', arguments: argumentsText }],
      goals: [existing],
      now: 100,
    });

    expect(result.status).toBe('materialized');
    expect(result.goals).toHaveLength(1);
    expect(result.goals[0]).toEqual(
      expect.objectContaining({
        id: 'deliverable',
        title: 'Prepare report',
        status: 'active',
        evidence: ['read_file:observed_result:tc-read'],
        successCriteria: ['evidence.tool:read_file', criterion],
      }),
    );
  });

  it('does not rewrite an already-owned contract', async () => {
    const argumentsText = JSON.stringify({ path: 'reports/final.md', content: 'done' });
    const criterion = await effectCriterion('write_file', argumentsText);
    const existing = createGoal({
      id: 'deliverable',
      title: 'Prepare report',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: [criterion],
      now: 10,
    });

    await expect(
      materializeToolEffectCompletionGoals({
        toolCalls: [{ name: 'write_file', arguments: argumentsText }],
        goals: [existing],
        now: 100,
      }),
    ).resolves.toEqual({ status: 'unchanged', goals: [existing] });
  });

  it('leaves mixed model-authored goal mutations on the existing iteration boundary', async () => {
    await expect(
      materializeToolEffectCompletionGoals({
        toolCalls: [
          {
            name: 'update_goals',
            arguments: JSON.stringify({ action: 'add', id: 'g1', name: 'Goal' }),
          },
          {
            name: 'write_file',
            arguments: JSON.stringify({ path: 'reports/final.md', content: 'done' }),
          },
        ],
        goals: [],
        now: 100,
      }),
    ).resolves.toEqual({ status: 'unchanged', goals: [] });
  });

  it('never rematerializes a blocked applied-but-unverified effect contract', async () => {
    const argumentsText = JSON.stringify({ path: 'reports/final.md', content: 'done' });
    const criterion = await effectCriterion('write_file', argumentsText);
    const blocked = createGoal({
      id: 'effect-write',
      title: 'Verify write_file effect',
      status: 'blocked',
      completionPolicy: 'blocking',
      successCriteria: [criterion],
      blockedReason: 'Effect applied but verification was incomplete.',
      now: 10,
    });

    const result = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'write_file', arguments: argumentsText }],
      goals: [blocked],
      now: 100,
    });

    expect(result).toEqual({
      status: 'rejected',
      goals: [blocked],
      errors: ['effect_completion_verification_blocked'],
    });
  });
});
