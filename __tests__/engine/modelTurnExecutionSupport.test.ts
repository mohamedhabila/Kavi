// ---------------------------------------------------------------------------
// Tests — Model turn token calibration guards (createModelTurnUsageTracker)
// ---------------------------------------------------------------------------
// These exercise the calibration recording logic directly against the usage
// tracker, independent of the full orchestrator stack, so each guard can be
// isolated precisely. The end-to-end wiring (pre-flight estimate -> real
// provider usage -> recorded observation -> next estimate reflects it) is
// covered separately in modelTurnExecutionAttempt.tokenCalibration.test.ts.

import { createModelTurnUsageTracker } from '../../src/engine/graph/modelTurnExecutionSupport';
import {
  estimateTokens,
  getObservedTokenCalibrationFactor,
  resetTokenCalibrationForTests,
} from '../../src/services/context/tokenCounter';

const FAMILY = 'anthropic';

function makeTracker(overrides: Partial<Parameters<typeof createModelTurnUsageTracker>[0]> = {}) {
  const reportUsage = jest.fn();
  const tracker = createModelTurnUsageTracker({
    getContentSnapshot: () => ({ fullContent: 'Answer', reasoning: '' }),
    reportUsage,
    requestModel: 'claude-sonnet-5',
    calibrationFamily: FAMILY,
    preflightEstimatedInputTokens: 100,
    // The factor in effect (per `getObservedTokenCalibrationFactor`) at the moment
    // `preflightEstimatedInputTokens` was computed — required for `recordObservedTokenRatio`
    // to recover its uncalibrated base. `FAMILY` starts unobserved (factor 1) in every test here.
    appliedCalibrationFactor: 1,
    ...overrides,
  });
  return { tracker, reportUsage };
}

describe('createModelTurnUsageTracker token calibration', () => {
  beforeEach(() => {
    resetTokenCalibrationForTests();
  });

  it('folds a real provider usage observation into the family calibration factor', () => {
    const { tracker, reportUsage } = makeTracker();
    tracker.mergeSnapshot({
      inputTokens: 100_000, // far beyond the 100-token estimate so the observed ratio clamps
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 100_020,
    });

    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBeGreaterThan(1);
    expect(reportUsage).toHaveBeenCalledTimes(1);
    expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 100_000 }));

    // The learned factor now feeds forward into estimateTokens for this family.
    const text = 'Sample text used to compare the calibrated estimate against the baseline.';
    expect(estimateTokens(text, FAMILY)).toBeGreaterThan(estimateTokens(text));
  });

  it('does not record when no provider family is known', () => {
    const { tracker } = makeTracker({ calibrationFamily: undefined });
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });

    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
  });

  it('does not record when the pre-flight estimate is zero', () => {
    const { tracker } = makeTracker({ preflightEstimatedInputTokens: 0 });
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });

    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
  });

  it('does not record when the pre-flight estimate is undefined', () => {
    const { tracker } = makeTracker({ preflightEstimatedInputTokens: undefined });
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });

    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
  });

  it('does not record when the applied calibration factor is missing or invalid', () => {
    for (const appliedCalibrationFactor of [undefined, NaN, 0, -1] as const) {
      resetTokenCalibrationForTests();
      const { tracker } = makeTracker({ appliedCalibrationFactor });
      tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });

      tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

      expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
    }
  });

  it('does not record when the provider reports no input token count', () => {
    const { tracker } = makeTracker();
    tracker.mergeSnapshot({ inputTokens: 0, outputTokens: 20 });

    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
  });

  it('does not record when the request carried an image attachment', () => {
    const { tracker } = makeTracker({ requestHasImageAttachment: true });
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });

    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
  });

  it('does not record when usage was only ever synthesized by the fallback estimator', () => {
    const { tracker, reportUsage } = makeTracker();
    // No mergeSnapshot call: the provider never reported usage for this request, so flush()
    // falls back to estimating it from the tracked content and messages instead.
    tracker.flush({
      allowFallback: true,
      budgetTools: [],
      requestMessages: [{ role: 'user', content: 'Hi' }],
    });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(1);
    expect(reportUsage).toHaveBeenCalledTimes(1);
  });

  it('records at most once per tracker even if flush is called again', () => {
    const { tracker } = makeTracker();
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });
    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });
    const factorAfterFirstFlush = getObservedTokenCalibrationFactor(FAMILY);

    tracker.mergeSnapshot({ inputTokens: 5, outputTokens: 1 });
    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBe(factorAfterFirstFlush);
  });

  it('resumes recording after reset() for a fresh request on the same tracker', () => {
    const { tracker } = makeTracker();
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });
    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });
    const factorAfterFirstFlush = getObservedTokenCalibrationFactor(FAMILY);

    tracker.reset();
    tracker.mergeSnapshot({ inputTokens: 100_000, outputTokens: 20 });
    tracker.flush({ allowFallback: true, budgetTools: [], requestMessages: [] });

    expect(getObservedTokenCalibrationFactor(FAMILY)).toBeGreaterThan(factorAfterFirstFlush);
  });
});
