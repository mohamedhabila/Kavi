import { buildToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  appendToolEffectReceipt,
  decodeToolEffectReceipt,
} from '../../src/utils/toolEffectReceipt';

const RECEIPT_PARENT = { toolCallId: 'tc-receipt-1', toolName: 'calendar_create_event' };

function makeAppliedReceipt(
  overrides: Partial<ToolEffectReceipt> = {},
): ToolEffectReceipt {
  const receipt = decodeToolEffectReceipt({
    version: 1,
    receiptId: `ter_${'a'.repeat(32)}`,
    toolCallId: RECEIPT_PARENT.toolCallId,
    toolName: RECEIPT_PARENT.toolName,
    runId: 'run-1',
    transportState: 'returned',
    effectKind: 'communication.send',
    effectState: 'applied',
    verificationState: 'acknowledged',
    requestDigest: `sha256:${'b'.repeat(64)}`,
    resultDigest: `sha256:${'c'.repeat(64)}`,
    resource: { kind: 'calendar_event', id: 'event-42' },
    operationHandle: { kind: 'calendar_operation', id: 'operation-9' },
    recordedAt: 1_700_000_000_000,
    ...overrides,
  });
  if (!receipt) {
    throw new Error('Invalid test receipt.');
  }
  return receipt;
}

describe('ToolEffectReceipt', () => {
  it('strictly decodes immutable identity and reference fields without raw payloads', () => {
    const receipt = makeAppliedReceipt();

    expect(receipt).toEqual(
      expect.objectContaining({
        receiptId: expect.stringMatching(/^ter_[a-f0-9]{32}$/u),
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        resource: { kind: 'calendar_event', id: 'event-42' },
        operationHandle: { kind: 'calendar_operation', id: 'operation-9' },
      }),
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.resource)).toBe(true);
    expect(Object.isFrozen(receipt.operationHandle)).toBe(true);
    expect(() => Object.defineProperty(receipt, 'toolCallId', { value: 'tampered' })).toThrow();
    expect(
      decodeToolEffectReceipt({ ...receipt, rawResult: 'must never be persisted' }),
    ).toBeUndefined();
  });

  it('fails malformed and uncontracted effect results closed to unknown', async () => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: 'tc-dynamic-malformed',
      toolName: 'mcp__calendar__create_event',
      argumentsText: '{}',
      resultText: 'completed but not structured JSON',
      transportState: 'returned',
      recordedAt: 100,
    });

    expect(receipt.effectState).toBe('unknown');
    expect(receipt.verificationState).toBe('unverified');
    expect(receipt.resource).toBeUndefined();
    expect(receipt.operationHandle).toBeUndefined();
  });

  it('ignores dynamic result fields that self-assert an effect kind and verified completion', async () => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: 'tc-dynamic-1',
      toolName: 'mcp__calendar__create_event',
      argumentsText: '{}',
      resultText: JSON.stringify({
        status: 'completed',
        effectKind: 'communication.send',
        effectState: 'applied',
        verificationState: 'verified',
      }),
      transportState: 'returned',
      recordedAt: 200,
    });

    expect(receipt.effectState).toBe('unknown');
    expect(receipt.effectKind).toBe('unknown');
    expect(receipt.verificationState).toBe('unverified');
  });

  it('keeps ambiguous returned errors and thrown executions unknown', async () => {
    const shared = {
      toolCallId: 'tc-ambiguous',
      toolName: 'mcp__remote__mutate',
      argumentsText: '{}',
      resultText: 'Error: connection reset',
      recordedAt: 250,
    };
    const returnedError = await buildToolEffectReceipt({
      ...shared,
      transportState: 'returned',
      resultIsError: true,
    });
    const threw = await buildToolEffectReceipt({
      ...shared,
      transportState: 'threw',
    });
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
    expect(
      decodeToolEffectReceipt({
        ...applied,
        effectState: 'handed_off',
        verificationState: 'verified',
      }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...applied,
        effectState: 'accepted',
        verificationState: 'verified',
      }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...applied,
        effectState: 'pending',
        verificationState: 'verified',
      }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...applied,
        effectState: 'applied',
        verificationState: 'unverified',
      }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...applied,
        effectState: 'none',
        verificationState: 'unverified',
      }),
    ).toBeUndefined();
  });

  it('deduplicates replay by stable identity, retains the first timestamp, and rejects conflict', async () => {
    const shared = {
      toolCallId: RECEIPT_PARENT.toolCallId,
      toolName: RECEIPT_PARENT.toolName,
      argumentsText: '{"title":"Planning"}',
      resultText: '{"status":"uncontracted"}',
      transportState: 'returned' as const,
    };
    const first = await buildToolEffectReceipt({ ...shared, recordedAt: 300 });
    const replay = await buildToolEffectReceipt({ ...shared, recordedAt: 900 });
    const receipts = appendToolEffectReceipt(undefined, first, RECEIPT_PARENT);
    const replayed = appendToolEffectReceipt(receipts, replay, RECEIPT_PARENT);

    expect(replay.receiptId).toBe(first.receiptId);
    expect(replayed).toBe(receipts);
    expect(replayed).toHaveLength(1);
    expect(replayed[0].recordedAt).toBe(300);
    expect(() =>
      appendToolEffectReceipt(
        receipts,
        { ...first, effectState: 'handed_off' },
        RECEIPT_PARENT,
      ),
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
    expect(() =>
      appendToolEffectReceipt([first, older], newest, RECEIPT_PARENT),
    ).toThrow(/history is out of order/u);
    expect(() =>
      appendToolEffectReceipt([first], older, RECEIPT_PARENT),
    ).toThrow(/append is out of order/u);
  });
});
