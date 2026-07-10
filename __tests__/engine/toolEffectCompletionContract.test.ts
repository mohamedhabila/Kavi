import {
  buildEffectCompletionContractBlock,
  findGoalForEffectCompletionRequirement,
  resolveToolEffectCompletionRequirement,
} from '../../src/engine/toolExecution/toolEffectCompletionContract';
import { digestToolEffectText } from '../../src/engine/toolExecution/toolEffectReceipt';
import { createGoal } from '../../src/engine/goals/types';

describe('tool effect completion contracts', () => {
  it('permits a code-owned read-only tool without a completion goal', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'read_file',
        argumentsText: JSON.stringify({ path: 'artifacts/out.txt' }),
      }),
    ).resolves.toEqual({ kind: 'effect_free', toolName: 'read_file' });
  });

  it('permits an explicit operational effect without treating its acknowledgement as completion', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'sessions_spawn',
        argumentsText: JSON.stringify({ prompt: 'Research the release.' }),
      }),
    ).resolves.toEqual({ kind: 'operational', toolName: 'sessions_spawn' });
  });

  it('classifies the read branch of a mixed memory tool as effect-free', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'memory_block',
        argumentsText: JSON.stringify({ action: 'read' }),
      }),
    ).resolves.toEqual({ kind: 'effect_free', toolName: 'memory_block' });
  });

  it('derives an exact request-bound file resource and content digest', async () => {
    const argumentsText = JSON.stringify({
      path: 'artifacts/out.txt',
      content: 'EXPECTED',
    });
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText,
    });

    expect(requirement).toEqual(
      expect.objectContaining({
        kind: 'effectful',
        toolName: 'write_file',
        criterion: {
          effectKind: 'artifact.write',
          requestDigest: await digestToolEffectText(argumentsText),
          resource: {
            kind: 'workspace_file',
            id: 'artifacts/out.txt',
            digest: await digestToolEffectText('EXPECTED'),
          },
          verificationState: 'verified',
        },
      }),
    );
  });

  it('authorizes only an active blocking goal with the exact criterion', async () => {
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText: JSON.stringify({ path: 'artifacts/out.txt', content: 'EXPECTED' }),
    });
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must have an effect completion contract');
    }
    const exact = createGoal({
      id: 'exact',
      title: 'Write exact artifact',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: [requirement.serializedCriterion],
    });
    const wrongResource = createGoal({
      id: 'wrong-resource',
      title: 'Write another artifact',
      status: 'active',
      completionPolicy: 'blocking',
      successCriteria: [
        requirement.serializedCriterion.replace('artifacts/out.txt', 'artifacts/other.txt'),
      ],
    });
    const persistent = createGoal({
      ...exact,
      id: 'persistent',
      completionPolicy: 'persistent',
    });

    expect(findGoalForEffectCompletionRequirement([wrongResource], requirement)).toBeUndefined();
    expect(findGoalForEffectCompletionRequirement([persistent], requirement)).toBeUndefined();
    expect(findGoalForEffectCompletionRequirement([wrongResource, exact], requirement)?.id).toBe(
      exact.id,
    );
  });

  it('returns a structured repair contract instead of weakening the requirement', async () => {
    const requirement = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText: JSON.stringify({ path: 'artifacts/out.txt', content: 'EXPECTED' }),
    });
    if (requirement.kind !== 'effectful') {
      throw new Error('write_file must have an effect completion contract');
    }

    expect(JSON.parse(buildEffectCompletionContractBlock(requirement))).toEqual({
      status: 'error',
      code: 'completion_contract_required',
      tool: 'write_file',
      requiredCriterion: requirement.serializedCriterion,
      repair: {
        tool: 'update_goals',
        completionPolicy: 'blocking',
        status: 'active',
        successCriteria: [requirement.serializedCriterion],
      },
      message:
        'Create or update an active blocking goal with the exact required criterion before retrying this effect.',
    });
  });

  it('derives a request-bound verified memory fact contract', async () => {
    const argumentsText = JSON.stringify({
      subject: 'user',
      predicate: 'city',
      value: 'Utrecht',
      scope: 'global',
    });

    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'memory_remember',
        argumentsText,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        kind: 'effectful',
        toolName: 'memory_remember',
        criterion: {
          effectKind: 'memory.write',
          requestDigest: await digestToolEffectText(argumentsText),
          resource: { kind: 'memory_fact', id: '*' },
          verificationState: 'verified',
        },
      }),
    );
  });

  it('fails closed when a mutating builtin lacks a code-owned result contract', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'unknown_mutation',
        argumentsText: JSON.stringify({ action: 'edit' }),
      }),
    ).resolves.toEqual({
      kind: 'unsupported',
      toolName: 'unknown_mutation',
      code: 'effect_contract_unavailable',
    });
  });
});
