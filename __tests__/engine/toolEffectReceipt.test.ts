import { buildToolEffectReceipt } from '../../src/engine/toolExecution/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../src/engine/tools/native/definitions';
import type { ToolEffectReceipt } from '../../src/types/toolEffectReceipt';
import {
  appendToolEffectReceipt,
  decodeToolEffectReceipt,
} from '../../src/utils/toolEffectReceipt';

const RECEIPT_PARENT = { toolCallId: 'tc-receipt-1', toolName: 'calendar_create_event' };

function makeAppliedReceipt(overrides: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
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
  it('covers every first-party native tool while excluding dynamic namespaces', () => {
    const missing = ALL_NATIVE_TOOL_DEFINITIONS.map((tool) => tool.name).filter(
      (toolName) => !getCodeOwnedToolEffectContract(toolName),
    );

    expect(missing).toEqual([]);
    expect(getCodeOwnedToolEffectContract('mcp__calendar__create_event')).toBeUndefined();
    expect(getCodeOwnedToolEffectContract('skill__calendar__create_event')).toBeUndefined();
  });

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

  it.each([
    [
      'email send acknowledgement',
      'email_compose',
      { status: 'sent' },
      {
        effectKind: 'communication.send',
        effectState: 'applied',
        verificationState: 'acknowledged',
      },
    ],
    [
      'email draft fallback',
      'email_compose',
      { status: 'fallback_opened' },
      {
        effectKind: 'communication.draft_handoff',
        effectState: 'handed_off',
        verificationState: 'unverified',
      },
    ],
    [
      'unknown SMS outcome',
      'sms_compose',
      { status: 'unknown' },
      {
        effectKind: 'communication.send',
        effectState: 'unknown',
        verificationState: 'unverified',
      },
    ],
    [
      'dialer handoff',
      'phone_call',
      { status: 'opened' },
      {
        effectKind: 'communication.call_handoff',
        effectState: 'handed_off',
        verificationState: 'unverified',
      },
    ],
    [
      'share handoff',
      'share_text',
      { status: 'handed_off' },
      {
        effectKind: 'share.handoff',
        effectState: 'handed_off',
        verificationState: 'unverified',
      },
    ],
    [
      'calendar creation',
      'calendar_create_event',
      { status: 'created', eventId: 'event-42' },
      {
        effectKind: 'calendar.create',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: { kind: 'calendar_event', id: 'event-42' },
      },
    ],
    [
      'scheduled notification',
      'notification_schedule',
      { status: 'notification_scheduled', id: 'notification-7' },
      {
        effectKind: 'notification.schedule',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: { kind: 'notification', id: 'notification-7' },
        operationHandle: { kind: 'notification_schedule', id: 'notification-7' },
      },
    ],
    [
      'camera cancellation',
      'camera_clip',
      { status: 'cancelled' },
      {
        effectKind: 'media.capture',
        effectState: 'cancelled',
        verificationState: 'unverified',
      },
    ],
  ])('maps reviewed first-party %s semantics', async (_label, toolName, result, expected) => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: `tc-${toolName}`,
      toolName,
      argumentsText: '{}',
      resultText: JSON.stringify(result),
      transportState: 'returned',
      recordedAt: 225,
    });

    expect(receipt).toEqual(expect.objectContaining(expected));
  });

  it('distinguishes successful read, accepted immediate notification, and clipboard write states', async () => {
    const read = await buildToolEffectReceipt({
      toolCallId: 'tc-read',
      toolName: 'calendar_list',
      argumentsText: '{}',
      resultText: '[]',
      transportState: 'returned',
      recordedAt: 226,
    });
    const accepted = await buildToolEffectReceipt({
      toolCallId: 'tc-notification-send',
      toolName: 'notification_send',
      argumentsText: '{}',
      resultText: JSON.stringify({ status: 'notification_accepted', id: 'notification-8' }),
      transportState: 'returned',
      recordedAt: 227,
    });
    const written = await buildToolEffectReceipt({
      toolCallId: 'tc-clipboard-write',
      toolName: 'clipboard_write',
      argumentsText: '{"text":"hello"}',
      resultText: JSON.stringify({ status: 'written', characterCount: 5 }),
      transportState: 'returned',
      recordedAt: 228,
    });

    expect(read).toEqual(
      expect.objectContaining({
        effectKind: 'observation.read',
        effectState: 'none',
        verificationState: 'not_applicable',
      }),
    );
    expect(accepted).toEqual(
      expect.objectContaining({
        effectKind: 'notification.send',
        effectState: 'accepted',
        verificationState: 'acknowledged',
      }),
    );
    expect(written).toEqual(
      expect.objectContaining({
        effectKind: 'clipboard.write',
        effectState: 'applied',
        verificationState: 'acknowledged',
      }),
    );
  });

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
