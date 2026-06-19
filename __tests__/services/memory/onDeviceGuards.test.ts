import {
  __resetOnDeviceGuardsForTests,
  acquireIngestionSlot,
  canStartIngestionJob,
  releaseIngestionSlot,
  setMainInferenceActive,
  setMemoryPressureAbort,
} from '../../../src/services/memory/onDeviceGuards';

beforeEach(() => {
  __resetOnDeviceGuardsForTests();
});

describe('onDeviceGuards', () => {
  it('defers ingestion while main inference is active', () => {
    setMainInferenceActive(true);
    expect(canStartIngestionJob()).toBe(false);
    expect(acquireIngestionSlot('job-1')).toBe(false);
  });

  it('aborts ingestion under memory pressure without throwing', () => {
    setMemoryPressureAbort(true);
    expect(canStartIngestionJob()).toBe(false);
  });

  it('allows a single concurrent ingestion slot', () => {
    expect(acquireIngestionSlot('job-1')).toBe(true);
    expect(acquireIngestionSlot('job-2')).toBe(false);
    releaseIngestionSlot('job-1');
    expect(acquireIngestionSlot('job-2')).toBe(true);
  });
});