import { buildToolEffectReceipt as buildReceiptWithExecutionIdentity } from '../../src/engine/toolExecution/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import {
  appendToolEffectReceipt,
  decodeToolEffectReceipt,
} from '../../src/utils/toolEffectReceipt';

const EXECUTION_RUN_ID = 'execution-run-1';

function buildToolEffectReceipt(
  params: Omit<Parameters<typeof buildReceiptWithExecutionIdentity>[0], 'executionRunId'>,
) {
  return buildReceiptWithExecutionIdentity({ executionRunId: EXECUTION_RUN_ID, ...params });
}

describe('ToolEffectReceipt code execution truth', () => {
  it('covers code-owned execution while keeping unowned runtimes non-evidentiary', () => {
    expect(getCodeOwnedToolEffectContract('javascript')).toBeDefined();
    expect(getCodeOwnedToolEffectContract('python')).toBeDefined();
    expect(getCodeOwnedToolEffectContract('ssh_exec')?.completionMode).toBe('operational');
    expect(getCodeOwnedToolEffectContract('expo_eas_build')?.completionMode).toBe('operational');
    expect(getCodeOwnedToolEffectContract('skill__github__commit_files')).toEqual({
      completionMode: 'operational',
      effectKind: 'remote.mutate',
      effectMode: 'effectful',
    });

    for (const deferredName of ['shell', 'mcp__filesystem__write_file']) {
      expect(getCodeOwnedToolEffectContract(deferredName)).toBeUndefined();
    }
  });

  it('does not mint durable identity for an unregistered shell-shaped result', async () => {
    await expect(
      buildToolEffectReceipt({
        toolCallId: 'tc-shell-unregistered',
        toolName: 'shell',
        argumentsText: '{"command":"echo ok"}',
        resultText: JSON.stringify({ status: 'completed', exitCode: 0, output: 'ok' }),
        transportState: 'returned',
        recordedAt: 9,
      }),
    ).rejects.toThrow(/code-owned identity or live runtime-external evidence/u);
  });

  it('rejects invalid execution states and transport combinations during durable decode', async () => {
    const completed = await buildToolEffectReceipt({
      toolCallId: 'tc-javascript-decode',
      toolName: 'javascript',
      argumentsText: '{"code":"42"}',
      resultText: JSON.stringify({ status: 'completed', output: '42' }),
      transportState: 'returned',
      recordedAt: 9,
    });

    expect(
      decodeToolEffectReceipt({ ...completed, executionState: 'provider_claimed' }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({ ...completed, effectKind: 'calendar.create' }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...completed,
        transportState: 'threw',
        effectState: 'unknown',
      }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...completed,
        executionState: 'failed',
        transportState: 'rejected',
        effectState: 'failed',
      }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...completed,
        executionState: 'cancelled',
        transportState: 'threw',
        effectState: 'unknown',
      }),
    ).toBeUndefined();
  });

  it.each(['javascript', 'python'])(
    'records %s completion separately from unverified arbitrary side effects',
    async (toolName) => {
      const receipt = await buildToolEffectReceipt({
        toolCallId: `tc-${toolName}-completed`,
        toolName,
        argumentsText: '{"code":"42"}',
        resultText: JSON.stringify({
          status: 'completed',
          workspaceMutationState: 'none_observed',
          output: '42',
        }),
        transportState: 'returned',
        recordedAt: 10,
      });

      expect(receipt).toEqual(
        expect.objectContaining({
          transportState: 'returned',
          executionState: 'completed',
          effectKind: 'compute.execute',
          effectState: 'unknown',
          verificationState: 'unverified',
        }),
      );
      expect(receipt.resource).toBeUndefined();
      expect(receipt.operationHandle).toBeUndefined();
    },
  );

  it.each([
    ['javascript failure', 'javascript', 'failed', 'failed'],
    ['javascript post-execution failure', 'javascript', 'effect_failed', 'completed'],
    ['python failure', 'python', 'failed', 'failed'],
    ['python post-execution failure', 'python', 'effect_failed', 'completed'],
    ['python timeout', 'python', 'timed_out', 'timed_out'],
  ] as const)(
    'keeps returned transport truth separate from %s',
    async (_label, toolName, status, executionState) => {
      const receipt = await buildToolEffectReceipt({
        toolCallId: `tc-${toolName}-${status}`,
        toolName,
        argumentsText: '{}',
        resultText: JSON.stringify({ status, isError: true, error: 'runtime failure' }),
        transportState: 'returned',
        resultIsError: true,
        recordedAt: 11,
      });

      expect(receipt).toEqual(
        expect.objectContaining({
          transportState: 'returned',
          executionState,
          effectKind: 'compute.execute',
          effectState: 'unknown',
          verificationState: 'unverified',
        }),
      );
      expect(receipt.resource).toBeUndefined();
      expect(receipt.operationHandle).toBeUndefined();
    },
  );

  it('fails malformed and thrown JavaScript execution truth closed', async () => {
    const malformed = await buildToolEffectReceipt({
      toolCallId: 'tc-javascript-malformed',
      toolName: 'javascript',
      argumentsText: '{}',
      resultText: 'completed',
      transportState: 'returned',
      recordedAt: 12,
    });
    const threw = await buildToolEffectReceipt({
      toolCallId: 'tc-javascript-threw',
      toolName: 'javascript',
      argumentsText: '{}',
      resultText: 'bridge crashed',
      transportState: 'threw',
      recordedAt: 13,
    });

    expect(malformed).toEqual(
      expect.objectContaining({
        transportState: 'returned',
        executionState: 'unknown',
        effectState: 'unknown',
      }),
    );
    expect(threw).toEqual(
      expect.objectContaining({
        transportState: 'threw',
        executionState: 'unknown',
        effectState: 'unknown',
      }),
    );
  });

  it('rejects contradictory completed-error execution truth as unknown', async () => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: 'tc-javascript-contradictory',
      toolName: 'javascript',
      argumentsText: '{}',
      resultText: JSON.stringify({ status: 'completed', isError: true, error: 'corrupt result' }),
      transportState: 'returned',
      resultIsError: true,
      recordedAt: 13,
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        transportState: 'returned',
        executionState: 'unknown',
        effectState: 'unknown',
        verificationState: 'unverified',
      }),
    );
  });

  it('records pre-execution cancellation without claiming interpreter execution', async () => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: 'tc-python-cancelled',
      toolName: 'python',
      argumentsText: '{}',
      resultText: 'cancelled before execution',
      transportState: 'rejected',
      terminalEffectState: 'cancelled',
      recordedAt: 14,
    });
    const rejected = await buildToolEffectReceipt({
      toolCallId: 'tc-python-rejected',
      toolName: 'python',
      argumentsText: '{}',
      resultText: 'runtime request rejected',
      transportState: 'rejected',
      terminalEffectState: 'failed',
      recordedAt: 15,
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        transportState: 'rejected',
        executionState: 'cancelled',
        effectKind: 'compute.execute',
        effectState: 'cancelled',
        verificationState: 'unverified',
      }),
    );
    expect(rejected).toEqual(
      expect.objectContaining({
        transportState: 'rejected',
        executionState: 'unknown',
        effectState: 'failed',
        verificationState: 'unverified',
      }),
    );
  });

  it('deduplicates an exact code execution replay and rejects execution-state conflict', async () => {
    const build = (recordedAt: number) =>
      buildToolEffectReceipt({
        toolCallId: 'tc-javascript-replay',
        toolName: 'javascript',
        argumentsText: '{"code":"42"}',
        resultText: JSON.stringify({ status: 'completed', output: '42' }),
        transportState: 'returned',
        recordedAt,
      });
    const parent = { toolCallId: 'tc-javascript-replay', toolName: 'javascript' };
    const first = await build(15);
    const replay = await build(15);
    const receipts = appendToolEffectReceipt(undefined, first, parent);

    expect(replay.receiptId).toBe(first.receiptId);
    expect(appendToolEffectReceipt(receipts, replay, parent)).toBe(receipts);
    expect(() =>
      appendToolEffectReceipt(receipts, { ...first, executionState: 'failed' }, parent),
    ).toThrow(/Conflicting tool effect receipt identity/u);
  });
});
