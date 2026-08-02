let mockActiveLeaseCount = 0;
const mockLeaseInputs: Array<{ leaseId: string; taskKind: string }> = [];
let mockLeaseAcquisitionGate: Promise<void> = Promise.resolve();

async function mockHoldAndroidLease<T>(
  input: { leaseId: string; taskKind: string },
  operation: () => Promise<T>,
): Promise<T> {
  mockLeaseInputs.push(input);
  await mockLeaseAcquisitionGate;
  mockActiveLeaseCount += 1;
  try {
    return await operation();
  } finally {
    mockActiveLeaseCount -= 1;
  }
}

jest.mock('../../src/services/androidLongHorizonExecution', () => ({
  ...jest.requireActual('../../src/services/androidLongHorizonExecution'),
  withAndroidLongHorizonExecutionLease: jest.fn(mockHoldAndroidLease),
}));

import {
  cancelSubAgent,
  installSubAgentTestHarness,
  mockProvider,
  startSubAgent,
} from '../helpers/subAgentHarness';

describe('sub-agent long-horizon continuity', () => {
  installSubAgentTestHarness();

  beforeEach(() => {
    mockActiveLeaseCount = 0;
    mockLeaseInputs.length = 0;
    mockLeaseAcquisitionGate = Promise.resolve();
  });

  it('starts the worker before a backgrounded native lease round-trip settles', async () => {
    let releaseLeaseAcquisition: (() => void) | undefined;
    mockLeaseAcquisitionGate = new Promise<void>((resolve) => {
      releaseLeaseAcquisition = resolve;
    });
    const { runOrchestrator } = require('../../src/engine/orchestrator');
    let finishRun: (() => void) | undefined;
    runOrchestrator.mockImplementationOnce(
      (_options: unknown, callbacks: any) =>
        new Promise((resolve) => {
          finishRun = () => {
            callbacks.onToken?.('completed background work');
            callbacks.onDone?.();
            resolve({ terminalDisposition: 'final_candidate' });
          };
        }),
    );

    const started = await startSubAgent(
      { parentConversationId: 'conversation-1', prompt: 'Continue after backgrounding.' },
      mockProvider,
    );
    await Promise.resolve();

    expect(finishRun).toEqual(expect.any(Function));
    expect(mockActiveLeaseCount).toBe(0);

    releaseLeaseAcquisition?.();
    await Promise.resolve();
    expect(mockActiveLeaseCount).toBe(1);

    finishRun?.();
    await expect(started.resultPromise).resolves.toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(mockActiveLeaseCount).toBe(0);
  });

  it('holds one worker lease until the deferred worker result settles', async () => {
    const { runOrchestrator } = require('../../src/engine/orchestrator');
    let finishRun: (() => void) | undefined;
    runOrchestrator.mockImplementationOnce(
      (_options: unknown, callbacks: any) =>
        new Promise((resolve) => {
          finishRun = () => {
            callbacks.onToken?.('completed work');
            callbacks.onDone?.();
            resolve({ terminalDisposition: 'final_candidate' });
          };
        }),
    );

    const started = await startSubAgent(
      { parentConversationId: 'conversation-1', prompt: 'Complete sustained work.' },
      mockProvider,
    );
    while (!finishRun) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(mockActiveLeaseCount).toBe(1);
    expect(mockLeaseInputs).toEqual([
      {
        leaseId: `sub-agent:${started.sessionId}`,
        taskKind: 'sub_agent',
      },
    ]);

    finishRun();
    await expect(started.resultPromise).resolves.toEqual(
      expect.objectContaining({ status: 'completed' }),
    );
    expect(mockActiveLeaseCount).toBe(0);
  });

  it('releases the worker lease when cancellation interrupts an unresolved orchestrator', async () => {
    const { runOrchestrator } = require('../../src/engine/orchestrator');
    runOrchestrator.mockImplementationOnce(() => new Promise(() => undefined));

    const started = await startSubAgent(
      { parentConversationId: 'conversation-1', prompt: 'Keep reading until cancelled.' },
      mockProvider,
    );
    for (let attempt = 0; attempt < 20 && mockActiveLeaseCount === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(mockActiveLeaseCount).toBe(1);
    expect(cancelSubAgent(started.sessionId, 'Cancelled by the test supervisor.')).toEqual(
      expect.objectContaining({ status: 'cancelled' }),
    );
    await expect(started.resultPromise).resolves.toEqual(
      expect.objectContaining({ status: 'cancelled', terminationCause: 'cancelled' }),
    );
    expect(mockActiveLeaseCount).toBe(0);
  });
});
