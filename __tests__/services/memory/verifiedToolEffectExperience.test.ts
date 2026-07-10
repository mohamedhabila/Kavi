jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { buildToolEffectReceipt } from '../../../src/engine/toolExecution/toolEffectReceipt';
import {
  recordVerifiedToolEffectExperience,
  type VerifiedToolEffectExperienceInput,
} from '../../../src/services/memory/verifiedToolEffectExperience';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import * as sqliteStore from '../../../src/services/memory/sqlite-store';
import { closeMemoryDb, getMemoryDb } from '../../../src/services/memory/sqlite-store';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { ToolEffectReceipt } from '../../../src/types/toolEffectReceipt';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mutablePlatform = Platform as unknown as { OS: string };
const NOW = 2_000_000;
const SECRET_ARGUMENT = 'Morgan private destination';
const SECRET_RESULT = 'private-provider-result';

async function receipt(params: {
  toolName?: string;
  toolCallId?: string;
  runId?: string;
  argumentsText?: string;
  resultText?: string;
  transportState?: 'returned' | 'rejected' | 'threw';
  resultIsError?: boolean;
  terminalEffectState?: 'cancelled' | 'failed';
  recordedAt?: number;
} = {}): Promise<ToolEffectReceipt> {
  return buildToolEffectReceipt({
    toolName: params.toolName ?? 'calendar_create_event',
    toolCallId: params.toolCallId ?? 'tool-call-1',
    runId: params.runId ?? 'agent-run-1',
    argumentsText:
      params.argumentsText ?? JSON.stringify({ title: SECRET_ARGUMENT, eventId: 'event-1' }),
    resultText:
      params.resultText ??
      JSON.stringify({ status: 'created_verified', eventId: 'event-1', detail: SECRET_RESULT }),
    transportState: params.transportState ?? 'returned',
    resultIsError: params.resultIsError,
    terminalEffectState: params.terminalEffectState,
    recordedAt: params.recordedAt ?? NOW - 1,
  });
}

function input(
  effectReceipt: ToolEffectReceipt,
  overrides: Partial<VerifiedToolEffectExperienceInput> = {},
): VerifiedToolEffectExperienceInput {
  return {
    memoryConversationId: 'memory-conversation-1',
    sourceThreadId: 'source-thread-1',
    sourceRunId: effectReceipt.runId,
    toolCallId: effectReceipt.toolCallId,
    toolName: effectReceipt.toolName,
    receipt: effectReceipt,
    ...overrides,
  };
}

function observationRows(): Record<string, unknown>[] {
  return getMemoryDb().getAllSync<Record<string, unknown>>(
    'SELECT * FROM memory_product_experience_observations ORDER BY id',
  );
}

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  mutablePlatform.OS = 'ios';
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
  closeMemoryDb();
  jest.restoreAllMocks();
});

describe('verified tool effect experience producer', () => {
  it('records a verified success with versioned code-owned identities and no private payload', async () => {
    const effectReceipt = await receipt();

    await expect(recordVerifiedToolEffectExperience(input(effectReceipt))).resolves.toEqual({
      status: 'recorded',
      observationId: expect.stringMatching(/^product_experience_[a-f0-9]{64}$/u),
      prunedCount: 0,
    });

    const rows = observationRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        domain_id: 'mobile-assistant.effect.calendar.create',
        environment_id:
          'kavi.react-native.ios.registered-tool.calendar_create_event.v1',
        procedure_id: expect.stringMatching(
          /^registered-tool\.calendar_create_event\.effect-contract\.v1\.[a-f0-9]{24}$/u,
        ),
        precondition_ids_json: '[]',
        outcome: 'success',
        authority: 'verified',
        evidence_kind: 'effect_receipt',
        observed_at: NOW - 1,
        created_at: NOW,
      }),
    );
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain(SECRET_ARGUMENT);
    expect(serialized).not.toContain(SECRET_RESULT);
    expect(serialized).not.toContain(effectReceipt.receiptId);
    expect(serialized).not.toContain(effectReceipt.toolCallId);
    expect(serialized).not.toContain(effectReceipt.runId);
    expect(serialized).not.toContain('event-1');
  });

  it('records only a directly returned contract-declared terminal failure', async () => {
    const effectReceipt = await receipt({
      toolName: 'screen_record',
      resultText: JSON.stringify({ status: 'screenshot_not_available' }),
    });

    await expect(recordVerifiedToolEffectExperience(input(effectReceipt))).resolves.toMatchObject({
      status: 'recorded',
    });
    expect(observationRows()[0]).toEqual(
      expect.objectContaining({
        domain_id: 'mobile-assistant.effect.media.capture',
        environment_id: 'kavi.react-native.ios.registered-tool.screen_record.v1',
        outcome: 'failure',
        authority: 'tool_observed',
        evidence_kind: 'effect_receipt',
      }),
    );
  });

  it('is idempotent for an exact receipt and rejects different evidence in the same run scope', async () => {
    const firstReceipt = await receipt();
    const first = await recordVerifiedToolEffectExperience(input(firstReceipt));

    await expect(recordVerifiedToolEffectExperience(input(firstReceipt))).resolves.toEqual({
      status: 'unchanged',
      observationId:
        first.status === 'recorded' || first.status === 'unchanged' ? first.observationId : '',
      prunedCount: 0,
    });

    const conflictingReceipt = await receipt({
      toolCallId: 'tool-call-2',
      resultText: JSON.stringify({ status: 'created_verified', eventId: 'event-2' }),
    });
    await expect(
      recordVerifiedToolEffectExperience(input(conflictingReceipt)),
    ).resolves.toEqual({ status: 'rejected', code: 'conflicting_run_evidence' });
    expect(observationRows()).toHaveLength(1);
  });

  it.each([
    {
      label: 'acknowledged application',
      build: () =>
        receipt({
          resultText: JSON.stringify({ status: 'created_unverified', eventId: 'event-1' }),
        }),
    },
    {
      label: 'accepted request',
      build: () =>
        receipt({
          toolName: 'notification_send',
          resultText: JSON.stringify({ status: 'notification_accepted', id: 'notification-1' }),
        }),
    },
    {
      label: 'handoff',
      build: () =>
        receipt({
          toolName: 'open_url',
          resultText: JSON.stringify({ status: 'opened' }),
        }),
    },
    {
      label: 'cancellation',
      build: () =>
        receipt({
          toolName: 'screen_record',
          resultText: JSON.stringify({ status: 'cancelled' }),
        }),
    },
    {
      label: 'unknown effect',
      build: () =>
        receipt({
          toolName: 'python',
          argumentsText: '{"code":"42"}',
          resultText: JSON.stringify({ status: 'completed' }),
        }),
    },
    {
      label: 'effect-free read',
      build: () =>
        receipt({
          toolName: 'contacts_search',
          resultText: JSON.stringify({ status: 'ok' }),
        }),
    },
    {
      label: 'transport throw',
      build: () =>
        receipt({
          toolName: 'screen_record',
          resultText: 'bridge failed',
          transportState: 'threw',
          resultIsError: true,
        }),
    },
  ])('excludes $label from product experience', async ({ build }) => {
    const effectReceipt = await build();

    await expect(recordVerifiedToolEffectExperience(input(effectReceipt))).resolves.toEqual({
      status: 'skipped',
      reason: 'non_terminal_outcome',
    });
    expect(observationRows()).toHaveLength(0);
  });

  it('rejects a receipt state that its registered contract never declares', async () => {
    const acknowledged = await receipt({
      toolName: 'sms_compose',
      resultText: JSON.stringify({ status: 'sent' }),
    });
    const forged = {
      ...acknowledged,
      verificationState: 'verified' as const,
    };

    await expect(recordVerifiedToolEffectExperience(input(forged))).resolves.toEqual({
      status: 'skipped',
      reason: 'non_terminal_outcome',
    });
    expect(observationRows()).toHaveLength(0);
  });

  it.each([
    ['missing source run', (value: ToolEffectReceipt) => input(value, { sourceRunId: undefined })],
    ['different source run', (value: ToolEffectReceipt) => input(value, { sourceRunId: 'run-2' })],
    ['different tool call', (value: ToolEffectReceipt) => input(value, { toolCallId: 'other-call' })],
    ['different tool name', (value: ToolEffectReceipt) => input(value, { toolName: 'memory_remember' })],
  ])('fails closed for %s ownership', async (_label, buildInput) => {
    const effectReceipt = await receipt();
    await expect(recordVerifiedToolEffectExperience(buildInput(effectReceipt))).resolves.toEqual({
      status: 'skipped',
      reason: 'invalid_identity',
    });
    expect(observationRows()).toHaveLength(0);
  });

  it('rejects invalid scope and future evidence without repairing identities or timestamps', async () => {
    const validReceipt = await receipt();
    const futureReceipt = await receipt({ recordedAt: NOW + 1 });

    await expect(
      recordVerifiedToolEffectExperience(
        input(validReceipt, { memoryConversationId: 'invalid scope' }),
      ),
    ).resolves.toEqual({ status: 'rejected', code: 'invalid_input' });
    await expect(recordVerifiedToolEffectExperience(input(futureReceipt))).resolves.toEqual({
      status: 'skipped',
      reason: 'invalid_receipt',
    });
    expect(observationRows()).toHaveLength(0);
  });

  it('excludes non-mobile runtimes and tools outside the closed receipt registry', async () => {
    const validReceipt = await receipt();
    mutablePlatform.OS = 'web';
    await expect(recordVerifiedToolEffectExperience(input(validReceipt))).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported_platform',
    });

    mutablePlatform.OS = 'android';
    const unregistered = await receipt({
      toolName: 'third_party_mutation',
      resultText: JSON.stringify({ status: 'completed' }),
    });
    await expect(recordVerifiedToolEffectExperience(input(unregistered))).resolves.toEqual({
      status: 'skipped',
      reason: 'unsupported_contract',
    });
    expect(observationRows()).toHaveLength(0);
  });

  it('does not hash, initialize schema, or store anything after memory opt-out', async () => {
    const effectReceipt = await receipt();
    closeMemoryDb();
    expoSqlite.__resetExpoSqliteForTests();
    resetFactSchemaCacheForTests();
    useSettingsStore.setState({ disableLongTermMemory: true } as never);
    const hashMock = jest.mocked(Crypto.digestStringAsync);
    hashMock.mockClear();
    const databaseSpy = jest.spyOn(sqliteStore, 'getMemoryDb');

    await expect(recordVerifiedToolEffectExperience(input(effectReceipt))).resolves.toEqual({
      status: 'skipped',
      reason: 'memory_disabled',
    });
    expect(hashMock).not.toHaveBeenCalled();
    expect(databaseSpy).not.toHaveBeenCalled();

    databaseSpy.mockRestore();
    useSettingsStore.setState({ disableLongTermMemory: false } as never);
    expect(
      getMemoryDb().getFirstSync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_product_experience_observations'",
      ),
    ).toBeNull();
  });

  it('returns a storage failure without throwing', async () => {
    const effectReceipt = await receipt();
    jest.spyOn(getMemoryDb(), 'runSync').mockImplementation(() => {
      throw new Error('disk unavailable');
    });

    await expect(recordVerifiedToolEffectExperience(input(effectReceipt))).resolves.toEqual({
      status: 'failed',
      code: 'storage_error',
    });
  });
});
