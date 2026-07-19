import { buildToolEffectReceipt as buildReceiptWithExecutionIdentity } from '../../src/engine/toolExecution/toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from '../../src/engine/toolExecution/toolEffectReceiptContracts';
import { ALL_NATIVE_TOOL_DEFINITIONS } from '../../src/engine/tools/native/definitions';
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

function makeAppliedReceipt(overrides: Partial<ToolEffectReceipt> = {}): ToolEffectReceipt {
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

  it('covers the reviewed local artifact family while deferring unowned runtimes', () => {
    for (const toolName of [
      'write_file',
      'file_edit',
      'image_generate',
      'image_edit',
      'canvas_create',
      'canvas_update',
      'canvas_navigate',
      'canvas_delete',
    ]) {
      expect(getCodeOwnedToolEffectContract(toolName)).toBeDefined();
    }

    for (const operationalName of ['ssh_exec', 'expo_eas_build']) {
      expect(getCodeOwnedToolEffectContract(operationalName)?.completionMode).toBe('operational');
    }

    expect(getCodeOwnedToolEffectContract('skill__github__commit_files')?.completionMode).toBe(
      'operational',
    );
    for (const deferredName of ['shell', 'mcp__filesystem__write_file']) {
      expect(getCodeOwnedToolEffectContract(deferredName)).toBeUndefined();
    }
  });

  it('strictly decodes immutable identity and reference fields without raw payloads', () => {
    const receipt = makeAppliedReceipt({
      resource: {
        kind: 'calendar_event',
        id: 'event-42',
        digest: `sha256:${'d'.repeat(64)}`,
      },
    });

    expect(receipt).toEqual(
      expect.objectContaining({
        receiptId: expect.stringMatching(/^ter_[a-f0-9]{32}$/u),
        executionRunId: EXECUTION_RUN_ID,
        requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        contractIdentity: expect.objectContaining({
          kind: 'code_owned',
          version: 1,
          toolName: RECEIPT_PARENT.toolName,
          schemaDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          capabilityContractDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          workflowContractDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          effectContractDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
          executionPolicyDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        }),
        resource: {
          kind: 'calendar_event',
          id: 'event-42',
          digest: `sha256:${'d'.repeat(64)}`,
        },
        operationHandle: { kind: 'calendar_operation', id: 'operation-9' },
      }),
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.contractIdentity)).toBe(true);
    expect(Object.isFrozen(receipt.resource)).toBe(true);
    expect(Object.isFrozen(receipt.operationHandle)).toBe(true);
    expect(() => Object.defineProperty(receipt, 'toolCallId', { value: 'tampered' })).toThrow();
    expect(
      decodeToolEffectReceipt({ ...receipt, rawResult: 'must never be persisted' }),
    ).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...receipt,
        resource: { ...receipt.resource, digest: 'sha256:not-a-digest' },
      }),
    ).toBeUndefined();
    expect(decodeToolEffectReceipt({ ...receipt, version: 1 })).toBeUndefined();
    expect(decodeToolEffectReceipt({ ...receipt, executionRunId: undefined })).toBeUndefined();
    expect(decodeToolEffectReceipt({ ...receipt, runId: EXECUTION_RUN_ID })).toBeUndefined();
    expect(
      decodeToolEffectReceipt({
        ...receipt,
        contractIdentity: { ...receipt.contractIdentity, extra: true },
      }),
    ).toBeUndefined();
  });

  it('binds receipt identity to execution and optional durable dispatch runs', async () => {
    const shared = {
      toolCallId: 'tc-run-identity',
      toolName: 'calendar_list',
      argumentsText: '{}',
      resultText: '[]',
      transportState: 'returned' as const,
      recordedAt: 2,
    };
    const effectFree = await buildReceiptWithExecutionIdentity({
      ...shared,
      executionRunId: EXECUTION_RUN_ID,
    });
    const dispatched = await buildReceiptWithExecutionIdentity({
      ...shared,
      executionRunId: EXECUTION_RUN_ID,
      dispatchRunId: 'effect-run-1',
    });
    const otherExecution = await buildReceiptWithExecutionIdentity({
      ...shared,
      executionRunId: 'execution-run-2',
    });

    expect(effectFree).toEqual(expect.objectContaining({ executionRunId: EXECUTION_RUN_ID }));
    expect(effectFree.dispatchRunId).toBeUndefined();
    expect(dispatched.dispatchRunId).toBe('effect-run-1');
    expect(
      new Set([effectFree.receiptId, dispatched.receiptId, otherExecution.receiptId]).size,
    ).toBe(3);
  });

  it('requires an execution-run identity at construction', async () => {
    await expect(
      buildReceiptWithExecutionIdentity({
        toolCallId: 'tc-missing-execution-run',
        toolName: 'calendar_list',
        argumentsText: '{}',
        resultText: '[]',
        transportState: 'returned',
        recordedAt: 3,
      } as Parameters<typeof buildReceiptWithExecutionIdentity>[0]),
    ).rejects.toThrow(/durable receipt contract/u);
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
        effectKind: 'communication.draft_handoff',
        effectState: 'applied',
        verificationState: 'verified',
      },
    ],
    [
      'opened SMS composer',
      'sms_compose',
      { status: 'sms_composer_opened' },
      {
        effectKind: 'communication.draft_handoff',
        effectState: 'applied',
        verificationState: 'verified',
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
        effectState: 'applied',
        verificationState: 'verified',
      },
    ],
    [
      'generic share handoff',
      'share',
      { status: 'handed_off' },
      {
        effectKind: 'share.handoff',
        effectState: 'applied',
        verificationState: 'verified',
      },
    ],
    [
      'generic clipboard write',
      'clipboard',
      { status: 'written_verified', characterCount: 5, verified: true },
      {
        effectKind: 'clipboard.write',
        effectState: 'applied',
        verificationState: 'verified',
      },
    ],
    [
      'calendar creation',
      'calendar_create_event',
      { status: 'created_verified', eventId: 'event-42' },
      {
        effectKind: 'calendar.create',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'calendar_event', id: 'event-42' },
      },
    ],
    [
      'definitive memory rejection',
      'memory_remember',
      { status: 'rejected', ok: false, code: 'grounding_required' },
      {
        effectKind: 'memory.write',
        effectState: 'failed',
        verificationState: 'unverified',
      },
    ],
    [
      'verified preserved memory source',
      'memory_preserve_source',
      { status: 'created', ok: true, fact: { id: 'fact-source-1' } },
      {
        effectKind: 'memory.write',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'memory_fact', id: 'fact-source-1' },
      },
    ],
    [
      'definitive memory withdrawal precondition rejection',
      'memory_forget',
      { status: 'rejected', ok: false, code: 'not_found' },
      {
        effectKind: 'memory.delete',
        effectState: 'failed',
        verificationState: 'unverified',
      },
    ],
    [
      'unknown memory withdrawal failure',
      'memory_forget',
      { status: 'failed_unknown', ok: false, code: 'internal' },
      {
        effectKind: 'memory.delete',
        effectState: 'unknown',
        verificationState: 'unverified',
      },
    ],
    [
      'scheduled notification',
      'notification_schedule',
      { status: 'notification_scheduled', id: 'notification-7' },
      {
        effectKind: 'notification.schedule',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'notification', id: 'notification-7' },
        operationHandle: { kind: 'notification_schedule', id: 'notification-7' },
      },
    ],
    [
      'durably created scheduled task',
      'cron',
      { status: 'task_created', id: 'job-7' },
      {
        effectKind: 'workflow.mutate',
        effectState: 'applied',
        verificationState: 'verified',
      },
    ],
    [
      'definitive scheduled task precondition rejection',
      'cron',
      { status: 'rejected', ok: false, code: 'scheduled_job_target_required' },
      {
        effectKind: 'workflow.mutate',
        effectState: 'failed',
        verificationState: 'unverified',
      },
    ],
    [
      'effect-free scheduled task listing',
      'cron',
      { status: 'listed', jobs: [] },
      {
        effectKind: 'observation.read',
        effectState: 'none',
        verificationState: 'not_applicable',
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
      resultIsError: 'ok' in result && result.ok === false,
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
      resultText: JSON.stringify({
        status: 'written_verified',
        characterCount: 5,
        verified: true,
      }),
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
        verificationState: 'verified',
      }),
    );
  });

  it.each([
    [
      'verified workspace write readback',
      'write_file',
      {
        status: 'written',
        path: 'reports/final.md',
        size: 12,
        sha256: 'a'.repeat(64),
      },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'verified',
        resource: {
          kind: 'workspace_file',
          id: 'reports/final.md',
          digest: `sha256:${'a'.repeat(64)}`,
        },
      },
    ],
    [
      'verified focused file edit readback',
      'file_edit',
      {
        status: 'edited',
        path: 'src/app.ts',
        size: 20,
        sha256: 'b'.repeat(64),
        editCount: 2,
      },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'verified',
        resource: {
          kind: 'workspace_file',
          id: 'src/app.ts',
          digest: `sha256:${'b'.repeat(64)}`,
        },
      },
    ],
    [
      'verified generated image persistence',
      'image_generate',
      { status: 'generated', workspacePath: 'generated-image.png' },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'workspace_file', id: 'generated-image.png' },
      },
    ],
    [
      'verified edited image persistence',
      'image_edit',
      { status: 'edited', workspacePath: 'edited-image.png' },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'verified',
        resource: { kind: 'workspace_file', id: 'edited-image.png' },
      },
    ],
    [
      'canvas creation acknowledgement',
      'canvas_create',
      { status: 'created', surfaceId: 'surface-6' },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: { kind: 'canvas_surface', id: 'surface-6' },
      },
    ],
    [
      'canvas update acknowledgement',
      'canvas_update',
      { status: 'updated', surfaceId: 'surface-7' },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: { kind: 'canvas_surface', id: 'surface-7' },
      },
    ],
    [
      'canvas deletion acknowledgement',
      'canvas_delete',
      { status: 'deleted', surfaceId: 'surface-8' },
      {
        effectKind: 'artifact.delete',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: { kind: 'canvas_surface', id: 'surface-8' },
      },
    ],
    [
      'canvas navigation acknowledgement',
      'canvas_navigate',
      { status: 'navigated', surfaceId: 'surface-9' },
      {
        effectKind: 'artifact.write',
        effectState: 'applied',
        verificationState: 'acknowledged',
        resource: { kind: 'canvas_surface', id: 'surface-9' },
      },
    ],
  ])('maps reviewed %s semantics', async (_label, toolName, result, expected) => {
    const receipt = await buildToolEffectReceipt({
      toolCallId: `tc-${toolName}`,
      toolName,
      argumentsText: '{}',
      resultText: JSON.stringify(result),
      transportState: 'returned',
      recordedAt: 228,
    });

    expect(receipt).toEqual(expect.objectContaining(expected));
  });

  it('fails malformed workspace resource identity and digest results closed', async () => {
    const missingDigest = await buildToolEffectReceipt({
      toolCallId: 'tc-write-missing-digest',
      toolName: 'write_file',
      argumentsText: '{}',
      resultText: JSON.stringify({ status: 'written', path: 'report.md' }),
      transportState: 'returned',
      recordedAt: 229,
    });
    const malformedDigest = await buildToolEffectReceipt({
      toolCallId: 'tc-edit-bad-digest',
      toolName: 'file_edit',
      argumentsText: '{}',
      resultText: JSON.stringify({
        status: 'edited',
        path: 'report.md',
        sha256: 'provider-claimed-success',
      }),
      transportState: 'returned',
      recordedAt: 230,
    });
    const missingImagePath = await buildToolEffectReceipt({
      toolCallId: 'tc-image-missing-path',
      toolName: 'image_generate',
      argumentsText: '{}',
      resultText: JSON.stringify({ status: 'generated', fileUri: 'file:///tmp/image.png' }),
      transportState: 'returned',
      recordedAt: 231,
    });

    for (const receipt of [missingDigest, malformedDigest, missingImagePath]) {
      expect(receipt.effectState).toBe('unknown');
      expect(receipt.verificationState).toBe('unverified');
      expect(receipt.resource).toBeUndefined();
    }
  });

  it('keeps returned and thrown workspace mutation errors unknown', async () => {
    const returnedError = await buildToolEffectReceipt({
      toolCallId: 'tc-write-returned-error',
      toolName: 'write_file',
      argumentsText: '{}',
      resultText: 'Error: storage unavailable after request dispatch',
      transportState: 'returned',
      resultIsError: true,
      recordedAt: 232,
    });
    const threw = await buildToolEffectReceipt({
      toolCallId: 'tc-image-threw',
      toolName: 'image_generate',
      argumentsText: '{}',
      resultText: 'Error: image persistence interrupted',
      transportState: 'threw',
      recordedAt: 233,
    });

    expect(returnedError).toEqual(
      expect.objectContaining({ effectKind: 'artifact.write', effectState: 'unknown' }),
    );
    expect(threw).toEqual(
      expect.objectContaining({ effectKind: 'artifact.write', effectState: 'unknown' }),
    );
  });

  it('deduplicates an exact artifact receipt replay and rejects resource-digest conflict', async () => {
    const build = (recordedAt: number) =>
      buildToolEffectReceipt({
        toolCallId: 'tc-write-replay',
        toolName: 'write_file',
        argumentsText: '{"path":"report.md","content":"done"}',
        resultText: JSON.stringify({
          status: 'written',
          path: 'report.md',
          size: 4,
          sha256: 'c'.repeat(64),
        }),
        transportState: 'returned',
        recordedAt,
      });
    const parent = { toolCallId: 'tc-write-replay', toolName: 'write_file' };
    const first = await build(240);
    const replay = await build(240);
    const receipts = appendToolEffectReceipt(undefined, first, parent);

    expect(replay.receiptId).toBe(first.receiptId);
    expect(appendToolEffectReceipt(receipts, replay, parent)).toBe(receipts);
    expect(() =>
      appendToolEffectReceipt(
        receipts,
        {
          ...first,
          resource: { ...first.resource!, digest: `sha256:${'d'.repeat(64)}` },
        },
        parent,
      ),
    ).toThrow(/Conflicting tool effect receipt identity/u);
    expect(() =>
      appendToolEffectReceipt(
        receipts,
        { ...first, executionRunId: 'execution-run-other' },
        parent,
      ),
    ).toThrow(/Conflicting tool effect receipt identity/u);
    expect(() =>
      appendToolEffectReceipt(receipts, { ...first, dispatchRunId: 'effect-run-other' }, parent),
    ).toThrow(/Conflicting tool effect receipt identity/u);
  });
});
