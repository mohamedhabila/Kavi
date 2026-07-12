import { buildToolEffectReceipt as buildReceiptWithExecutionIdentity } from '../../src/engine/toolExecution/toolEffectReceipt';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  appendToolEffectReceipt,
  decodeToolEffectReceipt,
} from '../../src/utils/toolEffectReceipt';

const RECEIPT_PARENT = { toolCallId: 'tc-receipt-1', toolName: 'calendar_create_event' };
const EXECUTION_RUN_ID = 'execution-run-1';

function buildToolEffectReceipt(
  params: Omit<Parameters<typeof buildReceiptWithExecutionIdentity>[0], 'executionRunId'>,
) {
  return buildReceiptWithExecutionIdentity({ executionRunId: EXECUTION_RUN_ID, ...params });
}

function makeAppliedReceipt(): ToolEffectReceipt {
  const receipt = decodeToolEffectReceipt({
    version: 2,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: RECEIPT_PARENT.toolCallId,
    toolName: RECEIPT_PARENT.toolName,
    contractIdentity: {
      kind: 'code_owned',
      version: 1,
      toolName: RECEIPT_PARENT.toolName,
      schemaDigest: `sha256:${'1'.repeat(64)}`,
      capabilityContractDigest: `sha256:${'2'.repeat(64)}`,
      workflowContractDigest: `sha256:${'3'.repeat(64)}`,
      effectContractDigest: `sha256:${'4'.repeat(64)}`,
      executionPolicyDigest: `sha256:${'5'.repeat(64)}`,
    },
    executionRunId: EXECUTION_RUN_ID,
    transportState: 'returned',
    effectKind: 'communication.send',
    effectState: 'applied',
    verificationState: 'acknowledged',
    requestDigest: `sha256:${'b'.repeat(64)}`,
    resultDigest: `sha256:${'c'.repeat(64)}`,
    recordedAt: 1_700_000_000_000,
  });
  if (!receipt) throw new Error('Invalid test receipt.');
  return receipt;
}

describe('ToolEffectReceipt validation and replay', () => {
  it('keeps first-party malformed, returned-error, and thrown outcomes unknown', async () => {
    const malformed = await buildToolEffectReceipt({
      toolCallId: 'tc-email-malformed',
      toolName: 'email_compose',
      argumentsText: '{}',
      resultText: 'sent maybe',
      transportState: 'returned',
      recordedAt: 229,
    });
    const returnedError = await buildToolEffectReceipt({
      toolCallId: 'tc-calendar-error',
      toolName: 'calendar_create_event',
      argumentsText: '{}',
      resultText: '{"error":"connection reset"}',
      transportState: 'returned',
      resultIsError: true,
      recordedAt: 230,
    });
    const threw = await buildToolEffectReceipt({
      toolCallId: 'tc-calendar-threw',
      toolName: 'calendar_create_event',
      argumentsText: '{}',
      resultText: 'Error: connection reset',
      transportState: 'threw',
      recordedAt: 231,
    });

    expect(malformed).toEqual(
      expect.objectContaining({ effectKind: 'communication.send', effectState: 'unknown' }),
    );
    expect(returnedError).toEqual(
      expect.objectContaining({ effectKind: 'calendar.create', effectState: 'unknown' }),
    );
    expect(threw).toEqual(
      expect.objectContaining({ effectKind: 'calendar.create', effectState: 'unknown' }),
    );
  });

  it('keeps ambiguous returned errors and thrown executions unknown', async () => {
    const shared = {
      toolCallId: 'tc-ambiguous',
      toolName: 'email_compose',
      argumentsText: '{}',
      resultText: 'Error: connection reset',
      recordedAt: 250,
    };
    const returnedError = await buildToolEffectReceipt({
      ...shared,
      transportState: 'returned',
      resultIsError: true,
    });
    const threw = await buildToolEffectReceipt({ ...shared, transportState: 'threw' });
    const rejected = await buildToolEffectReceipt({
      ...shared,
      transportState: 'rejected',
      terminalEffectState: 'cancelled',
    });

    expect(returnedError.effectState).toBe('unknown');
    expect(threw.effectState).toBe('unknown');
    expect(rejected.effectState).toBe('cancelled');
  });

  it('enforces the closed effect and verification matrix', () => {
    const applied = makeAppliedReceipt();

    expect(decodeToolEffectReceipt({ ...applied, effectKind: 'provider.chosen' })).toBeUndefined();
    for (const patch of [
      { effectState: 'handed_off', verificationState: 'verified' },
      { effectState: 'accepted', verificationState: 'verified' },
      { effectState: 'pending', verificationState: 'verified' },
      { effectState: 'applied', verificationState: 'unverified' },
      { effectState: 'none', verificationState: 'unverified' },
    ]) {
      expect(decodeToolEffectReceipt({ ...applied, ...patch })).toBeUndefined();
    }
  });

  it('deduplicates an exact replay and rejects a same-id conflict', async () => {
    const shared = {
      toolCallId: RECEIPT_PARENT.toolCallId,
      toolName: RECEIPT_PARENT.toolName,
      argumentsText: '{"title":"Planning"}',
      resultText: '{"status":"uncontracted"}',
      transportState: 'returned' as const,
    };
    const first = await buildToolEffectReceipt({ ...shared, recordedAt: 300 });
    const replay = await buildToolEffectReceipt({ ...shared, recordedAt: 300 });
    const receipts = appendToolEffectReceipt(undefined, first, RECEIPT_PARENT);
    const replayed = appendToolEffectReceipt(receipts, replay, RECEIPT_PARENT);

    expect(replay.receiptId).toBe(first.receiptId);
    expect(replayed).toBe(receipts);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].recordedAt).toBe(300);
    expect(() =>
      appendToolEffectReceipt(receipts, { ...first, effectState: 'handed_off' }, RECEIPT_PARENT),
    ).toThrow(/Conflicting tool effect receipt identity/u);
  });

  it('rejects mismatched existing parents and out-of-order runtime appends', async () => {
    const build = (resultText: string, recordedAt: number) =>
      buildToolEffectReceipt({
        toolCallId: RECEIPT_PARENT.toolCallId,
        toolName: RECEIPT_PARENT.toolName,
        argumentsText: '{}',
        resultText,
        transportState: 'returned',
        recordedAt,
      });
    const first = await build('{"sequence":1}', 500);
    const older = await build('{"sequence":2}', 400);
    const newest = await build('{"sequence":3}', 600);

    expect(() =>
      appendToolEffectReceipt(
        [{ ...first, toolCallId: 'different-tool-call' }],
        newest,
        RECEIPT_PARENT,
      ),
    ).toThrow(/Existing tool effect receipt is invalid/u);
    expect(() => appendToolEffectReceipt([first, older], newest, RECEIPT_PARENT)).toThrow(
      /history is out of order/u,
    );
    expect(() => appendToolEffectReceipt([first], older, RECEIPT_PARENT)).toThrow(
      /append is out of order/u,
    );
  });
});
