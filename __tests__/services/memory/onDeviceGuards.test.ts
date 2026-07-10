import {
  __resetOnDeviceGuardsForTests,
  acquireMainInferenceLease,
  acquireIngestionSlot,
  canStartIngestionJob,
  isMainInferenceActive,
  registerIngestionPreemptionHandler,
  releaseIngestionSlot,
  setMemoryPressureAbort,
} from '../../../src/services/memory/onDeviceGuards';

beforeEach(() => {
  __resetOnDeviceGuardsForTests();
});

describe('onDeviceGuards', () => {
  it('defers ingestion while main inference is active', () => {
    acquireMainInferenceLease('foreground:conversation-1:request-1');
    expect(canStartIngestionJob()).toBe(false);
    expect(acquireIngestionSlot('job-1')).toBe(false);
  });

  it('keeps overlapping inference owners active until every lease is released', () => {
    const first = acquireMainInferenceLease('foreground:conversation-1:request-1');
    const second = acquireMainInferenceLease('foreground:conversation-2:request-2');

    expect(first.release()).toBe(true);
    expect(isMainInferenceActive()).toBe(true);
    expect(canStartIngestionJob()).toBe(false);
    expect(second.release()).toBe(true);
    expect(isMainInferenceActive()).toBe(false);
    expect(canStartIngestionJob()).toBe(true);
  });

  it('ignores stale and duplicate lease releases', () => {
    const stale = acquireMainInferenceLease('foreground:stale:request');
    __resetOnDeviceGuardsForTests();
    const current = acquireMainInferenceLease('foreground:current:request');

    expect(stale.release()).toBe(false);
    expect(stale.release()).toBe(false);
    expect(isMainInferenceActive()).toBe(true);
    expect(current.release()).toBe(true);
    expect(current.release()).toBe(false);
  });

  it('rejects anonymous inference ownership', () => {
    expect(() => acquireMainInferenceLease('   ')).toThrow('main_inference_owner_required');
  });

  it('preempts ingestion once when foreground inference starts or memory pressure rises', () => {
    const handler = jest.fn();
    const unregister = registerIngestionPreemptionHandler(handler);

    acquireMainInferenceLease('foreground:first:request');
    acquireMainInferenceLease('foreground:second:request');
    setMemoryPressureAbort(true);
    setMemoryPressureAbort(true);

    expect(handler.mock.calls).toEqual([['foreground_inference'], ['memory_pressure']]);
    unregister();
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
