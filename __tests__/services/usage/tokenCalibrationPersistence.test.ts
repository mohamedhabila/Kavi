// ---------------------------------------------------------------------------
// Tests — Token Calibration Persistence (usage tracker <-> tokenCalibration)
// ---------------------------------------------------------------------------
// Exercises the durable-persistence half of the online token-calibration
// factor: `src/services/usage/tracker.ts` writes through the app's existing
// debounced `throttledAsyncStorage` after each observation and hydrates the
// in-memory calibration map (`src/services/context/tokenCalibration.ts`)
// from it at startup.

import { STORAGE_KEYS } from '../../../src/constants/storage';
import {
  exportTokenCalibrationState,
  getObservedTokenCalibrationFactor,
  getTokenCalibrationSampleCount,
  importTokenCalibrationState,
  resetTokenCalibrationForTests,
} from '../../../src/services/context/tokenCalibration';
import {
  hydrateTokenCalibrationFromStorage,
  recordAndPersistTokenCalibrationObservation,
} from '../../../src/services/usage/tracker';
import {
  _resetThrottledStorageStateForTests,
  flushPendingStorageWrites,
  throttledAsyncStorage,
} from '../../../src/store/throttledStorage';

const expoFileSystemMock = jest.requireMock('expo-file-system') as {
  __resetStore: () => void;
};

// `recordObservedTokenRatio`'s `appliedFactor` recovers the uncalibrated base as
// `estimatedTokens / (appliedFactor * SAFETY_MARGIN)`. Using `getObservedTokenCalibrationFactor`
// at call time (as production code does) keeps every test below correct regardless of how many
// prior observations already moved the factor.
async function persistObservation(
  family: string,
  estimatedTokens: number,
  actualTokens: number,
): Promise<void> {
  recordAndPersistTokenCalibrationObservation(
    family,
    estimatedTokens,
    actualTokens,
    getObservedTokenCalibrationFactor(family),
  );
  await flushPendingStorageWrites(STORAGE_KEYS.TOKEN_CALIBRATION);
}

beforeEach(() => {
  resetTokenCalibrationForTests();
  _resetThrottledStorageStateForTests();
  expoFileSystemMock.__resetStore();
});

afterEach(async () => {
  await flushPendingStorageWrites(STORAGE_KEYS.TOKEN_CALIBRATION).catch(() => undefined);
  resetTokenCalibrationForTests();
  _resetThrottledStorageStateForTests();
});

describe('recordAndPersistTokenCalibrationObservation', () => {
  it('writes the calibration snapshot through the tracker persistence mechanism', async () => {
    await persistObservation('anthropic', 100, 150);

    const raw = await throttledAsyncStorage.getItem(STORAGE_KEYS.TOKEN_CALIBRATION);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as {
      version: number;
      families: Record<string, { factor: number; sampleCount: number }>;
    };
    expect(parsed.version).toBe(1);
    expect(parsed.families.anthropic.sampleCount).toBe(1);
    expect(parsed.families.anthropic.factor).toBe(getObservedTokenCalibrationFactor('anthropic'));
  });

  it('still records the observation in memory even if the underlying storage write fails', async () => {
    const setItemSpy = jest
      .spyOn(throttledAsyncStorage, 'setItem')
      .mockRejectedValueOnce(new Error('disk full'));

    recordAndPersistTokenCalibrationObservation(
      'openai',
      100,
      150,
      getObservedTokenCalibrationFactor('openai'),
    );

    expect(getTokenCalibrationSampleCount('openai')).toBe(1);

    // Let the fire-and-forget persist promise's internal `.catch` settle before the
    // spy is restored, so the mocked rejection doesn't surface as an unhandled
    // rejection or bleed a stray log line into a later test.
    await new Promise((resolve) => setTimeout(resolve, 0));
    setItemSpy.mockRestore();
  });
});

describe('hydrateTokenCalibrationFromStorage', () => {
  it('is a no-op when nothing has ever been persisted', async () => {
    await hydrateTokenCalibrationFromStorage();
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1);
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(0);
  });

  it('restores a previously persisted family into the live calibration map', async () => {
    await persistObservation('gemini', 100, 175);
    const factorBeforeRestart = getObservedTokenCalibrationFactor('gemini');
    const sampleCountBeforeRestart = getTokenCalibrationSampleCount('gemini');

    // Simulate an app restart: the in-memory calibration map resets, storage does not.
    resetTokenCalibrationForTests();
    expect(getObservedTokenCalibrationFactor('gemini')).toBe(1);

    await hydrateTokenCalibrationFromStorage();
    expect(getObservedTokenCalibrationFactor('gemini')).toBe(factorBeforeRestart);
    expect(getTokenCalibrationSampleCount('gemini')).toBe(sampleCountBeforeRestart);
  });

  it('discards a payload with a mismatched schema version', async () => {
    await throttledAsyncStorage.setItem(
      STORAGE_KEYS.TOKEN_CALIBRATION,
      JSON.stringify({ version: 999, families: { anthropic: { factor: 2, sampleCount: 5 } } }),
    );
    await flushPendingStorageWrites(STORAGE_KEYS.TOKEN_CALIBRATION);

    await hydrateTokenCalibrationFromStorage();
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1);
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(0);
  });

  it('discards unparsable JSON without throwing', async () => {
    // `throttledAsyncStorage.setItem` itself requires a valid-JSON payload (its underlying
    // checksummed generation format rejects anything else at write time), so a genuinely
    // unparsable string can only reach `hydrateTokenCalibrationFromStorage` via a corrupted
    // read — simulated here by stubbing `getItem` directly rather than fighting that guard.
    const getItemSpy = jest
      .spyOn(throttledAsyncStorage, 'getItem')
      .mockResolvedValueOnce('{not valid json');

    await expect(hydrateTokenCalibrationFromStorage()).resolves.toBeUndefined();
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1);

    getItemSpy.mockRestore();
  });

  it('discards a non-object payload', async () => {
    await throttledAsyncStorage.setItem(STORAGE_KEYS.TOKEN_CALIBRATION, JSON.stringify([1, 2, 3]));
    await flushPendingStorageWrites(STORAGE_KEYS.TOKEN_CALIBRATION);

    await hydrateTokenCalibrationFromStorage();
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1);
  });

  it('sanitizes malformed per-family entries at the trust boundary, keeping only valid ones', async () => {
    await throttledAsyncStorage.setItem(
      STORAGE_KEYS.TOKEN_CALIBRATION,
      JSON.stringify({
        version: 1,
        families: {
          anthropic: { factor: 1.4, sampleCount: 6 },
          outOfRange: { factor: 99, sampleCount: 6 },
          malformed: 'not-an-object',
          negativeSamples: { factor: 1.1, sampleCount: -1 },
        },
      }),
    );
    await flushPendingStorageWrites(STORAGE_KEYS.TOKEN_CALIBRATION);

    await hydrateTokenCalibrationFromStorage();
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1.4);
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(6);
    expect(getObservedTokenCalibrationFactor('outOfRange')).toBe(1);
    expect(getObservedTokenCalibrationFactor('malformed')).toBe(1);
    expect(getObservedTokenCalibrationFactor('negativeSamples')).toBe(1);
  });

  it('never regresses an observation recorded after hydration started but before it resolved', async () => {
    // A stale, low-sample-count snapshot from a previous run sits on disk.
    await throttledAsyncStorage.setItem(
      STORAGE_KEYS.TOKEN_CALIBRATION,
      JSON.stringify({ version: 1, families: { anthropic: { factor: 2.1, sampleCount: 1 } } }),
    );
    await flushPendingStorageWrites(STORAGE_KEYS.TOKEN_CALIBRATION);

    // A model turn completes and records a fresher observation for the same family
    // before the (async) hydration below has a chance to run.
    recordAndPersistTokenCalibrationObservation(
      'anthropic',
      100,
      130,
      getObservedTokenCalibrationFactor('anthropic'),
    );
    recordAndPersistTokenCalibrationObservation(
      'anthropic',
      100,
      130,
      getObservedTokenCalibrationFactor('anthropic'),
    );
    const liveFactor = getObservedTokenCalibrationFactor('anthropic');
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(2);

    await hydrateTokenCalibrationFromStorage();

    // The live, higher-sample-count observation must win over the stale persisted one.
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(liveFactor);
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(2);
  });
});

describe('end-to-end: record -> persist -> restart -> hydrate', () => {
  it('an observation recorded through the tracker survives a simulated restart', async () => {
    await persistObservation('mistral', 100, 160);
    await persistObservation('mistral', 100, 160);
    const exportedBeforeRestart = exportTokenCalibrationState();

    // Simulate an app restart: only the live map resets; storage persists.
    resetTokenCalibrationForTests();

    await hydrateTokenCalibrationFromStorage();
    expect(exportTokenCalibrationState()).toEqual(exportedBeforeRestart);
  });
});

// Guards against `importTokenCalibrationState` (re-exported for `tracker.ts` to call) ever being
// bypassed by a future refactor that reaches into calibration internals instead.
describe('importTokenCalibrationState is the only mutation seam tracker.ts uses', () => {
  it('is exported and usable independently of the tracker', () => {
    importTokenCalibrationState({ deepseek: { factor: 1.2, sampleCount: 3 } });
    expect(getObservedTokenCalibrationFactor('deepseek')).toBe(1.2);
  });
});
