import { buildToolEffectReceipt as buildReceiptWithExecutionIdentity } from '../../src/engine/toolExecution/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';

function buildToolEffectReceipt(
  params: Omit<Parameters<typeof buildReceiptWithExecutionIdentity>[0], 'executionRunId'>,
) {
  return buildReceiptWithExecutionIdentity({ executionRunId: 'execution-run-1', ...params });
}

describe('tool effect completion receipts', () => {
  it('classifies every mutating builtin with a closed code-owned effect contract', () => {
    const missing = TOOL_DEFINITIONS.filter(
      (tool) =>
        tool.contract?.sideEffects?.some((effect) => effect !== 'none') &&
        !getCodeOwnedToolEffectContract(tool.name),
    ).map((tool) => tool.name);

    expect(missing).toEqual([]);
  });

  it.each([
    ['write_file', 'written_unverified'],
    ['file_edit', 'edited_unverified'],
  ])('keeps an applied %s result unverified when readback fails', async (toolName, status) => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: `tc-${toolName}-unverified`,
      toolName,
      argumentsText: '{}',
      resultText: JSON.stringify({
        status,
        path: 'reports/final.md',
        sha256: 'a'.repeat(64),
        verificationError: 'workspace_readback_failed',
      }),
      transportState: 'returned',
      recordedAt: 228,
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: {
          kind: 'workspace_file',
          id: 'reports/final.md',
          digest: `sha256:${'a'.repeat(64)}`,
        },
      }),
    );
  });

  it.each([
    [
      'memory_remember',
      '{}',
      { status: 'created', fact: { id: 'fact-1' } },
      {
        effectKind: 'memory.write',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'memory_fact', id: 'fact-1' },
      },
    ],
    [
      'memory_manage',
      '{"action":"pin","factId":"fact-1"}',
      { status: 'pinned', fact: { id: 'fact-1' } },
      {
        effectKind: 'memory.update',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'memory_fact', id: 'fact-1' },
      },
    ],
    [
      'memory_forget',
      '{"factId":"fact-1"}',
      { status: 'withdrawn', factId: 'fact-1' },
      {
        effectKind: 'memory.delete',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'memory_fact', id: 'fact-1' },
      },
    ],
  ])(
    'maps %s memory results to verified code-owned state',
    async (toolName, argumentsText, result, expected) => {
      const receipt = await buildToolEffectReceipt({
        toolCallId: `tc-${toolName}`,
        toolName,
        argumentsText,
        resultText: JSON.stringify(result),
        transportState: 'returned',
        recordedAt: 228,
      });

      expect(receipt).toEqual(expect.objectContaining(expected));
    },
  );
});
