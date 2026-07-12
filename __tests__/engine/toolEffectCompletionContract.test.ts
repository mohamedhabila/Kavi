import {
  buildEffectCompletionContractBlock,
  findGoalForEffectCompletionRequirement,
  resolveToolEffectCompletionRequirement,
} from '../../src/engine/toolExecution/toolEffectCompletionContract';
import {
  buildToolEffectReceipt,
  digestToolEffectRequest,
  digestToolEffectText,
} from '../../src/engine/toolExecution/toolEffectReceipt';
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

  it('permits an untrusted dynamic tool only as non-completing operational work', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'mcp__docs__fetch',
        argumentsText: JSON.stringify({ path: '/docs' }),
      }),
    ).resolves.toEqual({ kind: 'operational', toolName: 'mcp__docs__fetch' });
  });

  it('classifies the read branch of a mixed memory tool as effect-free', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'memory_block',
        argumentsText: JSON.stringify({ action: 'read' }),
      }),
    ).resolves.toEqual({ kind: 'effect_free', toolName: 'memory_block' });
  });

  it.each(['phone_call', 'share_text'])(
    'keeps the handed-off %s action operational and non-completing',
    async (toolName) => {
      await expect(
        resolveToolEffectCompletionRequirement({
          toolName,
          argumentsText: JSON.stringify({ value: 'test' }),
        }),
      ).resolves.toEqual({ kind: 'operational', toolName });
    },
  );

  it('keeps an acknowledged but unverifiable canvas mutation operational', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'canvas_create',
        argumentsText: JSON.stringify({ html: '<p>test</p>' }),
      }),
    ).resolves.toEqual({ kind: 'operational', toolName: 'canvas_create' });
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
          requestDigest: await digestToolEffectRequest(argumentsText),
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
        retryable: true,
        code: 'completion_contract_required',
        tool: 'update_goals',
        expectedShape: {
          action: 'add',
          id: expect.stringMatching(/^effect-write-file-[a-f0-9]{24}$/u),
          name: 'Verify write_file effect',
          completionPolicy: 'blocking',
          status: 'active',
          successCriteria: [requirement.serializedCriterion],
        },
        retryArguments: {
          action: 'add',
          id: expect.stringMatching(/^effect-write-file-[a-f0-9]{24}$/u),
          name: 'Verify write_file effect',
          completionPolicy: 'blocking',
          status: 'active',
          successCriteria: [requirement.serializedCriterion],
        },
        sideEffectApplied: false,
      },
      message:
        'Call update_goals with repair.retryArguments. After that graph mutation commits, retry the original effect on the following iteration.',
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
          requestDigest: await digestToolEffectRequest(argumentsText),
          resource: { kind: 'memory_fact', id: '*' },
          verificationState: 'verified',
        },
      }),
    );
  });

  it('keeps request identity stable across reordered and whitespace-varied JSON retries', async () => {
    const first = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText: '{"path":"artifacts/out.txt","content":"EXPECTED"}',
    });
    const retry = await resolveToolEffectCompletionRequirement({
      toolName: 'write_file',
      argumentsText: '{  "content" : "EXPECTED", "path" : "artifacts/out.txt" }',
    });

    expect(first.kind).toBe('effectful');
    expect(retry.kind).toBe('effectful');
    if (first.kind !== 'effectful' || retry.kind !== 'effectful') {
      throw new Error('write_file must have an effect completion contract');
    }
    expect(retry.serializedCriterion).toBe(first.serializedCriterion);
    const contentDigest = await digestToolEffectText('EXPECTED');
    const receipt = await buildToolEffectReceipt({
      executionRunId: 'execution-run-1',
      toolCallId: 'tc-write-retry',
      toolName: 'write_file',
      argumentsText: '{  "content" : "EXPECTED", "path" : "artifacts/out.txt" }',
      resultText: JSON.stringify({
        status: 'written',
        path: 'artifacts/out.txt',
        sha256: contentDigest.slice(7),
      }),
      transportState: 'returned',
    });
    expect(receipt.requestDigest).toBe(first.criterion.requestDigest);
  });

  it('fails closed when effect arguments are not a structured object', async () => {
    await expect(
      resolveToolEffectCompletionRequirement({
        toolName: 'write_file',
        argumentsText: 'not-json',
      }),
    ).resolves.toEqual({
      kind: 'unsupported',
      toolName: 'write_file',
      code: 'effect_arguments_invalid',
    });
  });
});
