import { createGoal } from '../../src/engine/goals/types';
import { CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER } from '../../src/engine/goals/types';
import { buildToolEffectReceiptEvidence } from '../../src/engine/goals/effectCompletionEvidence';
import { materializeToolEffectCompletionGoals } from '../../src/engine/graph/toolEffectGoalMaterialization';
import { resolveToolEffectCompletionRequirement } from '../../src/engine/toolExecution/toolEffectCompletionContract';
import { buildToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import { MEMORY_REMEMBER_TOOL } from '../../src/engine/tools/builtin-definitions-memory';

async function effectCriterion(toolName: string, argumentsText: string): Promise<string> {
  const requirement = await resolveToolEffectCompletionRequirement({ toolName, argumentsText });
  if (requirement.kind !== 'effectful') {
    throw new Error(`${toolName} must have an effect completion contract`);
  }
  return requirement.serializedCriterion;
}

async function failedReceiptEvidence(params: {
  argumentsText: string;
  toolCallId: string;
}): Promise<string> {
  return buildToolEffectReceiptEvidence(
    await buildToolEffectReceipt({
      toolCallId: params.toolCallId,
      toolName: 'memory_remember',
      argumentsText: params.argumentsText,
      resultText: JSON.stringify({
        status: 'rejected',
        ok: false,
        code: 'invalid_args',
      }),
      transportState: 'returned',
      resultIsError: true,
      executionRunId: 'execution-memory-retry',
      recordedAt: 100,
    }),
  );
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
        owner: CODE_OWNED_EFFECT_COMPLETION_GOAL_OWNER,
        successCriteria: [expect.stringMatching(/^evidence\.effect:/u)],
      }),
    );
    expect(
      JSON.stringify({ id: result.goals[0]?.id, title: result.goals[0]?.title }),
    ).not.toContain('private');
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

  it('does not materialize an effect goal for structurally invalid tool arguments', async () => {
    await expect(
      materializeToolEffectCompletionGoals({
        toolCalls: [
          {
            name: 'memory_remember',
            arguments: JSON.stringify({ semanticEvidence: 'not-an-object' }),
          },
        ],
        goals: [],
        tools: [MEMORY_REMEMBER_TOOL],
        now: 100,
      }),
    ).resolves.toEqual({ status: 'unchanged', goals: [] });
  });

  // This batch used to be skipped entirely, deferring materialization to the next
  // iteration. Traced live on an Android emulator, that deferral never arrived: the batch
  // boundary refused the write, and skipping materialization meant the goal that would
  // have admitted it was never created, so the retry failed identically. The model
  // escaped only by happening to send the write alone.
  //
  //   10:05:36  update_goals ok, write_file  -> goal_mutation_boundary
  //   10:06:19  write_file, update_goals ok  -> goal_mutation_boundary
  //   10:06:34  write_file alone             -> written
  //
  // The skip guarded against clobbering the model's pending mutation. It cannot: this
  // commits before the batch executes, and the canonicalization that applies the model's
  // mutation reads a fresh graph snapshot afterwards, so the mutation lands on top of the
  // materialized goal rather than replacing it.
  it('materializes the admitting goal even when the batch also mutates goals', async () => {
    const result = await materializeToolEffectCompletionGoals({
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
    });

    expect(result.status).toBe('materialized');
    expect(result.goals).toHaveLength(1);
    // A code-owned id, which no model-authored mutation addresses.
    expect(result.goals[0].id).toMatch(/^effect-write-file-/);
    expect(result.goals[0].owner).toBe('system:effect-completion');
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

  it('replaces one exact failed attempt when the model corrects the same effect', async () => {
    const rejectedArguments = JSON.stringify({
      semanticEvidence: {
        version: 4,
        subject: { kind: 'self', type: 'person' },
        predicate: 'meeting_duration',
        value: '30 minutes',
      },
    });
    const correctedArguments = JSON.stringify({
      semanticEvidence: {
        version: 4,
        subject: { kind: 'self' },
        predicate: 'meeting_duration',
        value: '30 minutes',
      },
    });
    const initial = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'memory_remember', arguments: rejectedArguments }],
      goals: [],
      now: 10,
    });
    expect(initial.status).toBe('materialized');
    const rejectedCriterion = await effectCriterion('memory_remember', rejectedArguments);
    const correctedCriterion = await effectCriterion('memory_remember', correctedArguments);
    const failedGoal = {
      ...initial.goals[0]!,
      evidence: [
        await failedReceiptEvidence({
          argumentsText: rejectedArguments,
          toolCallId: 'memory-rejected',
        }),
      ],
    };

    const retried = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'memory_remember', arguments: correctedArguments }],
      goals: [failedGoal],
      now: 20,
    });

    expect(retried).toEqual(
      expect.objectContaining({
        status: 'materialized',
        reason: 'effect_completion_contract:retry_replaced',
        timestamp: 20,
      }),
    );
    expect(retried.goals[0]?.successCriteria).toEqual([correctedCriterion]);
    expect(retried.goals[0]?.successCriteria).not.toContain(rejectedCriterion);
    expect(retried.goals[0]?.evidence).toEqual(failedGoal.evidence);
  });

  it('does not weaken an ambiguous batch of failed effects', async () => {
    const firstArguments = JSON.stringify({ semanticEvidence: { value: 'first' } });
    const secondArguments = JSON.stringify({ semanticEvidence: { value: 'second' } });
    const retryArguments = JSON.stringify({ semanticEvidence: { value: 'corrected' } });
    const initial = await materializeToolEffectCompletionGoals({
      toolCalls: [
        { name: 'memory_remember', arguments: firstArguments },
        { name: 'memory_remember', arguments: secondArguments },
      ],
      goals: [],
      now: 10,
    });
    expect(initial.status).toBe('materialized');
    const failedGoal = {
      ...initial.goals[0]!,
      evidence: [
        await failedReceiptEvidence({
          argumentsText: firstArguments,
          toolCallId: 'memory-first-rejected',
        }),
        await failedReceiptEvidence({
          argumentsText: secondArguments,
          toolCallId: 'memory-second-rejected',
        }),
      ],
    };

    const retried = await materializeToolEffectCompletionGoals({
      toolCalls: [{ name: 'memory_remember', arguments: retryArguments }],
      goals: [failedGoal],
      now: 20,
    });

    expect(retried.status).toBe('materialized');
    expect(retried.goals[0]?.successCriteria).toEqual([
      ...(failedGoal.successCriteria ?? []),
      await effectCriterion('memory_remember', retryArguments),
    ]);
  });
});
