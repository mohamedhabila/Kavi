jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../../src/services/memory/database';
import { resetMemoryCoreSchemaCacheForTests } from '../../../../src/services/memory/core/memorySchema';
import { searchMemoryItems } from '../../../../src/services/memory/core/memoryItemsStore';
import {
  __resetMemoryExtractionWorkerForTests,
  cancelMemoryExtraction,
  EXTRACTION_IDLE_POLL_MS,
  EXTRACTION_RETRY_BASE_MS,
  scheduleMemoryExtraction,
  waitForMemoryExtractionIdle,
} from '../../../../src/services/memory/core/memoryExtractionWorker';
import {
  __resetOnDeviceGuardsForTests,
  acquireMainInferenceLease,
} from '../../../../src/services/memory/onDeviceGuards';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

const messages = [
  { id: 'u1', role: 'user' as const, content: 'My sister Sara moved to Porto.', timestamp: 1 },
  { id: 'a1', role: 'assistant' as const, content: 'Lovely city.', timestamp: 2 },
];
const otherMessages = [
  { id: 'u9', role: 'user' as const, content: 'My brother Omar lives in Cairo.', timestamp: 1 },
  { id: 'a9', role: 'assistant' as const, content: 'Noted.', timestamp: 2 },
];
const ADD_OMAR = JSON.stringify({
  operations: [{ op: 'add', id: null, text: 'Omar (the user’s brother) lives in Cairo' }],
});
const ADD_SARA = JSON.stringify({
  operations: [{ op: 'add', id: null, text: 'Sara (the user’s sister) lives in Porto' }],
});

function stored(): string[] {
  return searchMemoryItems({
    query: 'Sara Porto',
    visibility: { conversationId: 'conv-1' },
    limit: 5,
    includeSensitive: true,
  }).map((item) => item.text);
}

async function settle(): Promise<void> {
  for (let tick = 0; tick < 10; tick += 1) await Promise.resolve();
}

let clock = 1_000;

function setup(call: jest.Mock, resolveModel: () => Promise<unknown> = async () => call) {
  clock = 1_000;
  __resetMemoryExtractionWorkerForTests({
    resolveModel: resolveModel as never,
    readThread: (threadId) =>
      threadId === 'conv-1' ? messages : threadId === 'conv-2' ? otherMessages : null,
    now: () => clock,
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetMemoryCoreSchemaCacheForTests();
  __resetOnDeviceGuardsForTests();
});

afterEach(() => {
  __resetMemoryExtractionWorkerForTests();
  jest.useRealTimers();
});

afterAll(() => {
  closeMemoryDb();
});

describe('memory extraction worker', () => {
  it('extracts a conversation once its turn closes', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();

    expect(call).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });

  it('waits while a foreground turn holds the model', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call);
    const lease = acquireMainInferenceLease('turn-1');

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();
    expect(call).not.toHaveBeenCalled();

    lease.release();
    jest.advanceTimersByTime(EXTRACTION_IDLE_POLL_MS);
    await settle();
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });

  it('gives way to a foreground turn and finishes afterwards at no cost', async () => {
    let lease: { release(): boolean } | null = null;
    const call = jest
      .fn()
      .mockImplementationOnce(
        (_prompt: string, signal: AbortSignal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')));
            lease = acquireMainInferenceLease('turn-2');
          }),
      )
      .mockImplementation(async () => ADD_SARA);
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();
    expect(stored()).toEqual([]);

    lease!.release();
    jest.advanceTimersByTime(EXTRACTION_IDLE_POLL_MS);
    await settle();
    expect(call).toHaveBeenCalledTimes(2);
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });

  it('does nothing without a model to extract with', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call, async () => null);

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();

    expect(call).not.toHaveBeenCalled();
    expect(stored()).toEqual([]);
  });

  it('retries a failed run later', async () => {
    const call = jest
      .fn()
      .mockRejectedValueOnce(new Error('503'))
      .mockImplementation(async () => ADD_SARA);
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();
    expect(stored()).toEqual([]);

    clock += EXTRACTION_RETRY_BASE_MS;
    jest.advanceTimersByTime(EXTRACTION_RETRY_BASE_MS);
    await settle();
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });

  it('does not hold other conversations behind one that is waiting to retry', async () => {
    const prompts: string[] = [];
    const call = jest.fn(async (prompt: string) => {
      prompts.push(prompt);
      if (prompts.length === 1) throw new Error('503');
      return prompt.includes('Omar') ? ADD_OMAR : ADD_SARA;
    });
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();
    scheduleMemoryExtraction('conv-2', 'a9');
    await settle();

    // conv-1 waits out its backoff; conv-2 runs meanwhile instead of re-trying conv-1 early.
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Omar');
    expect(stored()).toEqual([]);

    clock += EXTRACTION_RETRY_BASE_MS;
    jest.advanceTimersByTime(EXTRACTION_RETRY_BASE_MS);
    await settle();
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });

  it('reports idle once queued extraction has run', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    const idle = waitForMemoryExtractionIdle(60_000);
    await settle();

    await expect(idle).resolves.toBe(true);
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });

  it('reports not idle when the wait ends while a foreground turn holds the model', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call);
    const lease = acquireMainInferenceLease('turn-1');

    scheduleMemoryExtraction('conv-1', 'a1');
    const idle = waitForMemoryExtractionIdle(1_000);
    jest.advanceTimersByTime(1_000);

    await expect(idle).resolves.toBe(false);
    lease.release();
  });

  it('drops a thread that keeps no memory and settles waiters', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call);

    scheduleMemoryExtraction('side-thread', 'a1');
    const idle = waitForMemoryExtractionIdle(60_000);
    await settle();

    await expect(idle).resolves.toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('cancelling stops the running call and settles waiters', async () => {
    const call = jest.fn(
      (_prompt: string, signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();
    expect(call).toHaveBeenCalledTimes(1);
    const idle = waitForMemoryExtractionIdle(60_000);

    cancelMemoryExtraction();
    await settle();

    await expect(idle).resolves.toBe(true);
    expect(stored()).toEqual([]);
    jest.advanceTimersByTime(EXTRACTION_IDLE_POLL_MS);
    await settle();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('extracts a window once when several drains start while the model resolves', async () => {
    const call = jest.fn(async () => ADD_SARA);
    setup(call);

    scheduleMemoryExtraction('conv-1', 'a1');
    const idle = waitForMemoryExtractionIdle(60_000);
    scheduleMemoryExtraction('conv-1', 'a1');
    await settle();

    await expect(idle).resolves.toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
    expect(stored()).toEqual(['Sara (the user’s sister) lives in Porto']);
  });
});
