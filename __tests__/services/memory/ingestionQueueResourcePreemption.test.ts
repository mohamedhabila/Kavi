jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

jest.mock('../../../src/services/memory/consolidation/paths', () => ({
  resolveConsolidationPath: jest.fn(),
}));

jest.mock('../../../src/services/memory/turnProcessor', () => ({
  processIngestionTurn: jest.fn(),
}));

import { resolveConsolidationPath } from '../../../src/services/memory/consolidation/paths';
import {
  __resetIngestionQueueForTests,
  cancelScheduledIngestionDrain,
  enqueueIngestionJob as enqueueStrictIngestionJob,
  getIngestionJob,
  scheduleIngestionDrain,
} from '../../../src/services/memory/ingestionQueue';
import {
  __resetOnDeviceGuardsForTests,
  acquireMainInferenceLease,
  setMemoryPressureAbort,
} from '../../../src/services/memory/onDeviceGuards';
import { initializeMemoryPolicyObservation } from '../../../src/services/memory/policy';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { closeMemoryDb } from '../../../src/services/memory/database';
import { processIngestionTurn } from '../../../src/services/memory/turnProcessor';
import { useSettingsStore } from '../../../src/store/useSettingsStore';
import type { LlmProviderConfig } from '../../../src/types/provider';
import { createTestIngestionJobEnqueuer } from '../../helpers/ingestionSourceSnapshotFixture';
import { commitMockedStructuralReceipt } from '../../helpers/ingestionQueueProcessFixture';

const enqueueIngestionJob = createTestIngestionJobEnqueuer(enqueueStrictIngestionJob);

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };
const mockedResolveConsolidationPath = jest.mocked(resolveConsolidationPath);
const mockedProcessIngestionTurn = jest.mocked(processIngestionTurn);

const REMOTE_PROVIDER: LlmProviderConfig = {
  id: 'provider-remote',
  name: 'Remote provider',
  baseUrl: 'https://example.test/v1',
  apiKey: '',
  model: 'remote-model',
  enabled: true,
};

const ON_DEVICE_PROVIDER: LlmProviderConfig = {
  ...REMOTE_PROVIDER,
  id: 'provider-on-device',
  kind: 'on-device',
  name: 'On-device provider',
  baseUrl: '',
  model: 'local-model',
};

function processResult(
  providerOutcome: Awaited<ReturnType<typeof processIngestionTurn>>['providerOutcome'],
): Awaited<ReturnType<typeof processIngestionTurn>> {
  return {
    processed: true,
    episodeId: 'episode-1',
    deterministicFactIds: [],
    providerFactIds: providerOutcome.status === 'valid' ? ['fact-provider'] : [],
    invalidatedFactIds: [],
    activeFocusUpdated: false,
    openThreadsUpdated: false,
    enriched: providerOutcome.status === 'valid',
    providerOutcome,
    bridgedEvidenceFactIds: [],
    agentRunMemoryFactIds: [],
  };
}

function enqueueJob(suffix: string) {
  return enqueueIngestionJob({
    personaId: 'default',
    threadId: `conv-${suffix}`,
    threadTitle: null,
    memoryConversationId: `conv-${suffix}`,
    taskId: null,
    sourceStartMessageId: `user-${suffix}`,
    sourceEndMessageId: `assistant-${suffix}`,
    sourceRunId: null,
    sourceAt: 100,
    chatProviderId: null,
    chatModel: null,
    reason: 'turn_completed',
    providerEnrichment: true,
    now: 100,
  })!;
}

async function flushScheduledIngestion(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await jest.advanceTimersByTimeAsync(0);
    await Promise.resolve();
  }
}

function setResolvedProvider(provider: LlmProviderConfig): void {
  mockedResolveConsolidationPath.mockResolvedValueOnce({
    tier: provider.kind === 'on-device' ? 'on_device' : 'chat',
    provider,
    model: provider.model,
    extractor: jest.fn(),
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: 100 });
  jest.clearAllMocks();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  __resetOnDeviceGuardsForTests();
  __resetIngestionQueueForTests();
  initializeMemoryPolicyObservation();
  useSettingsStore.setState({ disableLongTermMemory: false } as never);
});

afterEach(async () => {
  setMemoryPressureAbort(false);
  await cancelScheduledIngestionDrain();
  closeMemoryDb();
  jest.useRealTimers();
});

describe('ingestion queue resource-aware preemption', () => {
  it('preempts checkpointed remote enrichment for foreground inference', async () => {
    setResolvedProvider(REMOTE_PROVIDER);
    let markAttemptStarted: (() => void) | undefined;
    const attemptStarted = new Promise<void>((resolve) => {
      markAttemptStarted = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    mockedProcessIngestionTurn.mockImplementationOnce(async (input) => {
      commitMockedStructuralReceipt(input, processResult({ status: 'not_requested' }));
      providerSignal = input.providerSignal;
      markAttemptStarted?.();
      await new Promise<void>((resolve) => {
        input.providerSignal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        ...processResult({ status: 'not_requested' }),
        processed: false,
        skipped: 'provider_preempted',
      };
    });
    const job = enqueueJob('remote-preempted');

    scheduleIngestionDrain({});
    jest.runAllTicks();
    await attemptStarted;
    const inferenceLease = acquireMainInferenceLease('foreground:remote-preempted');
    await flushScheduledIngestion();

    expect(providerSignal?.aborted).toBe(true);
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'processing_incomplete',
        structuralCompletedAt: 100,
      }),
    );
    inferenceLease.release();
  });

  it('preempts checkpointed on-device enrichment for foreground inference', async () => {
    setResolvedProvider(ON_DEVICE_PROVIDER);
    let markAttemptStarted: (() => void) | undefined;
    const attemptStarted = new Promise<void>((resolve) => {
      markAttemptStarted = resolve;
    });
    mockedProcessIngestionTurn.mockImplementationOnce(async (input) => {
      commitMockedStructuralReceipt(input, processResult({ status: 'not_requested' }));
      markAttemptStarted?.();
      await new Promise<void>((resolve) => {
        input.providerSignal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        ...processResult({ status: 'not_requested' }),
        processed: false,
        skipped: 'provider_preempted',
      };
    });
    const job = enqueueJob('on-device-preempted');

    scheduleIngestionDrain({});
    jest.runAllTicks();
    await attemptStarted;
    const inferenceLease = acquireMainInferenceLease('foreground:on-device-preempted');
    await flushScheduledIngestion();

    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'processing_incomplete',
        structuralCompletedAt: 100,
      }),
    );
    inferenceLease.release();
  });

  it('preempts checkpointed remote enrichment under memory pressure', async () => {
    setResolvedProvider(REMOTE_PROVIDER);
    let markAttemptStarted: (() => void) | undefined;
    const attemptStarted = new Promise<void>((resolve) => {
      markAttemptStarted = resolve;
    });
    mockedProcessIngestionTurn.mockImplementationOnce(async (input) => {
      commitMockedStructuralReceipt(input, processResult({ status: 'not_requested' }));
      markAttemptStarted?.();
      await new Promise<void>((resolve) => {
        input.providerSignal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        ...processResult({ status: 'not_requested' }),
        processed: false,
        skipped: 'provider_preempted',
      };
    });
    const job = enqueueJob('remote-memory-pressure');

    scheduleIngestionDrain({});
    jest.runAllTicks();
    await attemptStarted;
    setMemoryPressureAbort(true);
    await flushScheduledIngestion();

    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'processing_incomplete',
        structuralCompletedAt: 100,
      }),
    );
  });

  it('still cancels a checkpointed remote attempt during queue shutdown', async () => {
    setResolvedProvider(REMOTE_PROVIDER);
    let markAttemptStarted: (() => void) | undefined;
    const attemptStarted = new Promise<void>((resolve) => {
      markAttemptStarted = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    mockedProcessIngestionTurn.mockImplementationOnce(async (input) => {
      commitMockedStructuralReceipt(input, processResult({ status: 'not_requested' }));
      providerSignal = input.providerSignal;
      markAttemptStarted?.();
      await new Promise<void>((resolve) => {
        input.providerSignal?.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        ...processResult({ status: 'not_requested' }),
        processed: false,
        skipped: 'provider_preempted',
      };
    });
    const job = enqueueJob('remote-shutdown');

    scheduleIngestionDrain({});
    jest.runAllTicks();
    await attemptStarted;
    await cancelScheduledIngestionDrain();

    expect(providerSignal?.aborted).toBe(true);
    expect(getIngestionJob(job.id)).toEqual(
      expect.objectContaining({
        status: 'retrying',
        outcomeCode: 'processing_incomplete',
        structuralCompletedAt: 100,
      }),
    );
  });
});
