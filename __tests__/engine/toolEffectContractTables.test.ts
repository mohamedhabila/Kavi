import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import { buildToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import { normalizeToolName } from '../../src/engine/tools/toolNameNormalization';

// One outcome the receipt contract cannot hold (sms_send declared "applied, unverified")
// voided the tool's whole outcome table: every result read as an effect of unknown outcome,
// so the first text Kavi sent stopped the run for reconciliation (long-task-trip-organizer).
/** A result carrying [status] where the tool's contract reads it. */
function atPath(path: ReadonlyArray<string>, status: string): Record<string, unknown> {
  return path.reduceRight<Record<string, unknown>>(
    (value, key, index) => (index === path.length - 1 ? { [key]: status } : { [key]: value }),
    {} as Record<string, unknown>,
  );
}

describe("every code-owned tool's outcome table", () => {
  const tables = TOOL_DEFINITIONS.map((tool) => normalizeToolName(tool.name))
    .map((name) => [name, getCodeOwnedToolEffectContract(name)] as const)
    .filter(
      ([, contract]) =>
        contract?.effectMode === 'effectful' &&
        contract.result !== undefined &&
        !contract.result.resource &&
        !contract.result.operationHandle,
    );

  it('covers the effectful tools that report a status', () => {
    expect(tables.map(([name]) => name)).toEqual(
      expect.arrayContaining(['sms_send', 'phone_call']),
    );
  });

  it.each(tables)(
    'reads each status %s reports as its declared outcome',
    async (name, contract) => {
      for (const [status, declared] of Object.entries(contract!.result!.outcomes)) {
        const receipt = await buildToolEffectReceipt({
          toolCallId: `call-${status}`,
          toolName: name,
          argumentsText: '{}',
          resultText: JSON.stringify(atPath(contract!.result!.statusPath, status)),
          transportState: 'returned',
          resultIsError: false,
          executionRunId: 'run-1',
        });

        expect({ status, effectState: receipt.effectState }).toEqual({
          status,
          effectState: declared.effectState,
        });
      }
    },
  );
});
