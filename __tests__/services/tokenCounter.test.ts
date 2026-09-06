// ---------------------------------------------------------------------------
// Tests — Token Counter
// ---------------------------------------------------------------------------

import {
  estimateTokens,
  estimateMessageTokens,
  getContextWindow,
  getCompactionWorkingContextWindow,
  getWorkingContextWindow,
  getCompactionThreshold,
  getCompactionThresholds,
  MODEL_CONTEXT_WINDOWS,
  MAX_ROUTINE_COMPACTION_WORKING_CONTEXT,
  SELECTIVE_COMPACTION_THRESHOLD_SHARE,
  TOOL_CLEARING_THRESHOLD_SHARE,
  AGGRESSIVE_COMPACTION_THRESHOLD_SHARE,
} from '../../src/services/context/tokenCounter';
import {
  exportTokenCalibrationState,
  getObservedTokenCalibrationFactor,
  getTokenCalibrationSampleCount,
  importTokenCalibrationState,
  isValidTokenCalibrationState,
  recordObservedTokenRatio,
  resetTokenCalibrationForTests,
  MAX_TRACKED_CALIBRATION_FAMILIES,
  SAFETY_MARGIN,
} from '../../src/services/context/tokenCalibration';

// `recordObservedTokenRatio`'s `appliedFactor` recovers the uncalibrated base as
// `estimatedTokens / (appliedFactor * SAFETY_MARGIN)`. Passing `1 / SAFETY_MARGIN` makes that
// denominator exactly 1, so `base === estimatedTokens` — i.e. the tests below that only care
// about the EMA/clamping mechanics (not the base-recovery math itself) can keep comparing
// `actualTokens` directly against `estimatedTokens`, exactly as they did before `appliedFactor`
// existed.
const NEUTRAL_APPLIED_FACTOR = 1 / SAFETY_MARGIN;

describe('estimateTokens', () => {
  afterEach(() => {
    resetTokenCalibrationForTests();
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for falsy input', () => {
    expect(estimateTokens(undefined as any)).toBe(0);
    expect(estimateTokens(null as any)).toBe(0);
  });

  it('estimates roughly 1 token per 3.5 chars for pure Latin text', () => {
    const text = 'Hello world'; // 11 chars, Latin baseline ratio (4 chars/token) * 1.2 margin
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil(11 / 3.5));
  });

  it('scales linearly with length', () => {
    const short = estimateTokens('hi');
    const long = estimateTokens('hi'.repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  describe('script-aware estimation', () => {
    // Same-length (30 code point) samples across script families. Non-Latin
    // scripts pack more meaning per character, so a correct estimator must
    // charge them *more* tokens per character than Latin — i.e. produce a
    // *higher* token estimate for the same character count.
    const SAMPLE_LENGTH = 30;
    const latinSample = 'abcdefghijklmnopqrstuvwxyzabcd'.slice(0, SAMPLE_LENGTH);
    const chineseSample = '这是一个用于测试分词器脚本感知能力的中文示例句子内容，继续补充'.slice(
      0,
      SAMPLE_LENGTH,
    );
    const arabicSample = 'هذا نص عربي تجريبي لاختبار تقدير الرموز حسب الكتابة نص'.slice(
      0,
      SAMPLE_LENGTH,
    );
    const thaiSample = 'นี่คือประโยคภาษาไทยตัวอย่างสำหรับทดสอบการประมาณค่าโทเค็นตามอักษร'.slice(
      0,
      SAMPLE_LENGTH,
    );
    const hindiSample = 'यह एक हिन्दी उदाहरण वाक्य है जो टोकन अनुमान का परीक्षण करता है'.slice(
      0,
      SAMPLE_LENGTH,
    );

    it('charges every non-Latin sample more tokens per character than the Latin sample', () => {
      const latinTokens = estimateTokens(latinSample);
      expect(estimateTokens(chineseSample)).toBeGreaterThan(latinTokens);
      expect(estimateTokens(arabicSample)).toBeGreaterThan(latinTokens);
      expect(estimateTokens(thaiSample)).toBeGreaterThan(latinTokens);
      expect(estimateTokens(hindiSample)).toBeGreaterThan(latinTokens);
    });

    it('orders CJK as the densest (fewest chars/token) of the sampled scripts', () => {
      // Same length in code points; CJK's ~1.3 chars/token ratio should yield
      // the highest token count of the five samples.
      const tokenCounts = {
        latin: estimateTokens(latinSample),
        chinese: estimateTokens(chineseSample),
        arabic: estimateTokens(arabicSample),
        thai: estimateTokens(thaiSample),
        hindi: estimateTokens(hindiSample),
      };
      expect(tokenCounts.chinese).toBeGreaterThanOrEqual(tokenCounts.arabic);
      expect(tokenCounts.chinese).toBeGreaterThanOrEqual(tokenCounts.thai);
      expect(tokenCounts.chinese).toBeGreaterThanOrEqual(tokenCounts.hindi);
      expect(tokenCounts.chinese).toBeGreaterThan(tokenCounts.latin);
    });

    it('blends per-script ratios for mixed-script text rather than defaulting to Latin', () => {
      const mixed = `hello ${chineseSample}`;
      const pureLatinOfSameLength = 'x'.repeat(mixed.length);
      expect(estimateTokens(mixed)).toBeGreaterThan(estimateTokens(pureLatinOfSameLength));
    });

    it('treats digits, punctuation and whitespace as the Latin baseline', () => {
      const digits = '0123456789'.repeat(3);
      const latinLetters = 'a'.repeat(30);
      expect(estimateTokens(digits)).toBe(estimateTokens(latinLetters));
    });
  });

  describe('calibration', () => {
    it('leaves estimates unchanged for an unobserved family', () => {
      expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1);
      expect(getTokenCalibrationSampleCount('anthropic')).toBe(0);
      expect(estimateTokens('hello world', 'anthropic')).toBe(estimateTokens('hello world'));
    });

    it('converges the calibration factor toward the observed ratio over repeated samples', () => {
      // Estimator's uncalibrated base is 100; the provider keeps reporting 150 (1.5x that base).
      for (let i = 0; i < 50; i += 1) {
        recordObservedTokenRatio('gemini', 100, 150, NEUTRAL_APPLIED_FACTOR);
      }
      expect(getObservedTokenCalibrationFactor('gemini')).toBeCloseTo(1.5, 1);
      expect(getTokenCalibrationSampleCount('gemini')).toBe(50);
    });

    it('moves the factor toward each new observation without jumping straight to it', () => {
      recordObservedTokenRatio('openai', 100, 200, NEUTRAL_APPLIED_FACTOR); // observed ratio 2.0
      const afterOne = getObservedTokenCalibrationFactor('openai');
      expect(afterOne).toBeGreaterThan(1);
      expect(afterOne).toBeLessThan(2);
    });

    it('clamps an extreme observed ratio instead of applying it verbatim', () => {
      recordObservedTokenRatio('custom', 10, 1000, NEUTRAL_APPLIED_FACTOR); // observed ratio 100x
      const factor = getObservedTokenCalibrationFactor('custom');
      expect(factor).toBeLessThan(3); // well below the raw 100x observation
      expect(factor).toBeGreaterThan(1);
    });

    it('ignores non-finite or non-positive samples', () => {
      recordObservedTokenRatio('mistral', 0, 100, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio('mistral', 100, -1, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio('mistral', NaN, 100, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio('mistral', 100, NaN, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio('mistral', 100, 100, NaN);
      recordObservedTokenRatio('mistral', 100, 100, 0);
      recordObservedTokenRatio('mistral', 100, 100, -1);
      expect(getTokenCalibrationSampleCount('mistral')).toBe(0);
      expect(getObservedTokenCalibrationFactor('mistral')).toBe(1);
    });

    it('ignores an unset or empty family', () => {
      recordObservedTokenRatio(undefined, 100, 200, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio('', 100, 200, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio(null, 100, 200, NEUTRAL_APPLIED_FACTOR);
      expect(getObservedTokenCalibrationFactor(undefined)).toBe(1);
    });

    it('keys calibration per provider family independently', () => {
      recordObservedTokenRatio('anthropic', 100, 130, NEUTRAL_APPLIED_FACTOR);
      recordObservedTokenRatio('gemini', 100, 170, NEUTRAL_APPLIED_FACTOR);
      expect(getObservedTokenCalibrationFactor('anthropic')).not.toBe(
        getObservedTokenCalibrationFactor('gemini'),
      );
    });

    it('scales estimateTokens output by the learned factor once calibrated', () => {
      const baseline = estimateTokens('a long enough string to have a stable base estimate');
      for (let i = 0; i < 20; i += 1) {
        recordObservedTokenRatio('deepseek', 100, 150, NEUTRAL_APPLIED_FACTOR);
      }
      const calibrated = estimateTokens(
        'a long enough string to have a stable base estimate',
        'deepseek',
      );
      expect(calibrated).toBeGreaterThan(baseline);
    });

    // ── Feedback-loop math: base recovery, convergence, and margin preservation ──────────
    //
    // `recordObservedTokenRatio` must compare the provider's actual token count against the
    // *uncalibrated, un-margined* base the pre-flight estimate was built from — not against
    // the already-margined, already-calibrated `estimatedTokens` value directly. Comparing
    // directly (the old, buggy behavior) would (a) treat SAFETY_MARGIN itself as calibration
    // error, driving the fixed point to zero headroom, and (b) once the factor also flows into
    // the pre-flight estimate, converge the learned factor to `sqrt(trueRatio)` instead of
    // `trueRatio`. These tests drive the real `estimateTokens`/`getObservedTokenCalibrationFactor`
    // production pair the way `modelTurnExecutionAttempt.ts` does — reading the factor in effect
    // immediately before computing the estimate, on every iteration — so drift in the factor
    // across iterations cannot silently make the test pass under either the old or new math by
    // accident.
    it('converges the factor to the true actual/base ratio and keeps the margin over actual', () => {
      const family = 'convergence-test-family';
      const text = 'a stable sample string long enough for calibration convergence testing';
      const trueRatio = 1.5; // the provider consistently reports 1.5x this text's true base

      for (let i = 0; i < 200; i += 1) {
        const appliedFactor = getObservedTokenCalibrationFactor(family);
        const estimatedTokens = estimateTokens(text, family);
        const base = estimatedTokens / (appliedFactor * SAFETY_MARGIN);
        const actualTokens = base * trueRatio;
        recordObservedTokenRatio(family, estimatedTokens, actualTokens, appliedFactor);
      }

      const convergedFactor = getObservedTokenCalibrationFactor(family);
      expect(convergedFactor).toBeCloseTo(trueRatio, 1);

      // Margin preserved: once converged, the calibrated estimate is ~trueRatio * base *
      // SAFETY_MARGIN — i.e. still SAFETY_MARGIN above what the provider actually reports for
      // this text, not equal to it.
      const finalEstimate = estimateTokens(text, family);
      const finalBase = finalEstimate / (convergedFactor * SAFETY_MARGIN);
      const finalActual = finalBase * trueRatio;
      expect(finalEstimate / finalActual).toBeCloseTo(SAFETY_MARGIN, 1);
    });

    it('regression: keeps SAFETY_MARGIN headroom over actual at the fixed point, never collapsing to it', () => {
      // A provider whose usage always matches the true (uncalibrated) base exactly — the
      // "perfectly calibrated estimator" case. The true actual/base ratio is 1, so the factor
      // should converge to 1, not to 1/SAFETY_MARGIN. Under the old math (observed = actual /
      // estimatedTokens, comparing straight against the margined+calibrated value), this same
      // setup would converge the factor toward 1/SAFETY_MARGIN and the calibrated estimate would
      // collapse to equal actual — losing the margin entirely. This test fails under that old
      // formula and passes under the fixed one.
      const family = 'margin-regression-family';
      const text = 'another stable sample string reserved for the margin regression test only';

      for (let i = 0; i < 200; i += 1) {
        const appliedFactor = getObservedTokenCalibrationFactor(family);
        const estimatedTokens = estimateTokens(text, family);
        const base = estimatedTokens / (appliedFactor * SAFETY_MARGIN);
        recordObservedTokenRatio(family, estimatedTokens, base, appliedFactor);
      }

      const convergedFactor = getObservedTokenCalibrationFactor(family);
      expect(convergedFactor).toBeCloseTo(1, 1);

      const finalEstimate = estimateTokens(text, family);
      const finalBase = finalEstimate / (convergedFactor * SAFETY_MARGIN);
      expect(finalEstimate).toBeGreaterThan(finalBase); // margin still present
      expect(finalEstimate / finalBase).toBeCloseTo(SAFETY_MARGIN, 1);
    });
  });
});

describe('estimateMessageTokens', () => {
  it('returns overhead for empty messages', () => {
    expect(estimateMessageTokens([])).toBe(2); // priming only
  });

  it('includes framing overhead per message', () => {
    const result = estimateMessageTokens([{ role: 'user', content: '' }]);
    // 2 (priming) + 4 (framing) + tokens('user') + tokens('')
    expect(result).toBeGreaterThan(2);
  });

  it('sums tokens across multiple messages', () => {
    const msgs = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there, how can I help?' },
    ];
    const result = estimateMessageTokens(msgs);
    expect(result).toBeGreaterThan(10);
  });
});

describe('MODEL_CONTEXT_WINDOWS', () => {
  it('has entries for key models', () => {
    expect(MODEL_CONTEXT_WINDOWS['gpt-5.4']).toBe(1000000);
    expect(MODEL_CONTEXT_WINDOWS['gpt-5-mini']).toBe(400000);
    expect(MODEL_CONTEXT_WINDOWS['claude-sonnet-4-6']).toBe(1000000);
  });
});

describe('getContextWindow', () => {
  it('returns exact match', () => {
    expect(getContextWindow('gpt-5.4')).toBe(1000000);
  });

  it('resolves newer family revisions through fallback heuristics', () => {
    expect(getContextWindow('gpt-5.5')).toBe(1000000);
    expect(getContextWindow('claude-sonnet-4-6-latest')).toBe(1000000);
    expect(getContextWindow('gemini-3.5-flash')).toBe(1000000);
  });

  it('supports hosted model namespaces in family fallbacks', () => {
    expect(getContextWindow('openai/gpt-5.4-mini')).toBe(400000);
    expect(getContextWindow('anthropic/claude-sonnet-4-6-latest')).toBe(1000000);
    expect(getContextWindow('google/gemini-2.5-pro')).toBe(1000000);
  });

  it('returns prefix match', () => {
    expect(getContextWindow('claude-sonnet-4-6-latest')).toBe(1000000);
  });

  it('returns default 128000 for unknown model', () => {
    expect(getContextWindow('totally-unknown-model')).toBe(128000);
  });

  it('resolves 1M windows for every current Claude 5.x / 4.x id via exact table entries', () => {
    expect(getContextWindow('claude-opus-5')).toBe(1000000);
    expect(getContextWindow('claude-fable-5-1')).toBe(1000000);
    expect(getContextWindow('claude-fable-5')).toBe(1000000);
    expect(getContextWindow('claude-sonnet-5')).toBe(1000000);
    expect(getContextWindow('claude-opus-4-8')).toBe(1000000);
    expect(getContextWindow('claude-opus-4-7')).toBe(1000000);
    expect(getContextWindow('claude-haiku-4-5')).toBe(200000);
  });

  it('falls back an unrecognized-but-current-generation Anthropic id to 1M rather than 128k', () => {
    // Not in the static table and not a Haiku id — should inherit the 1M window the
    // rest of the current Anthropic lineup ships with, not the generic 128k default.
    expect(getContextWindow('claude-zeta-7')).toBe(1000000);
  });

  it('still gives an unrecognized Haiku-generation id the smaller Haiku window', () => {
    expect(getContextWindow('claude-haiku-7')).toBe(200000);
  });

  it('prefers an explicit maxInputTokens override over every other source', () => {
    expect(getContextWindow('claude-haiku-4-5', { maxInputTokens: 42000 })).toBe(42000);
    expect(getContextWindow('totally-unknown-model', { maxInputTokens: 777000 })).toBe(777000);
  });

  it('ignores a non-positive or non-finite maxInputTokens override', () => {
    expect(getContextWindow('claude-haiku-4-5', { maxInputTokens: 0 })).toBe(200000);
    expect(getContextWindow('claude-haiku-4-5', { maxInputTokens: -5 })).toBe(200000);
    expect(getContextWindow('claude-haiku-4-5', { maxInputTokens: NaN })).toBe(200000);
  });
});

describe('getWorkingContextWindow', () => {
  it('keeps small context windows unchanged', () => {
    expect(getWorkingContextWindow('phi4')).toBe(16384);
  });

  it('keeps most of a large context window available as working context', () => {
    // Raw context first: the share is 0.75 and the absolute cap is 400K, so long runs
    // reach lossy summarization only when the window is genuinely under pressure.
    // gpt-5.4 (1M) → min(1M, 400000, max(48000, 750000)) = 400000
    expect(getWorkingContextWindow('gpt-5.4')).toBe(400000);
    // gpt-5-mini (400K) → min(400000, 400000, max(48000, 300000)) = 300000
    expect(getWorkingContextWindow('gpt-5-mini')).toBe(300000);
    // claude-haiku-4-5 (200K) → min(200000, 400000, max(48000, 150000)) = 150000
    expect(getWorkingContextWindow('claude-haiku-4-5')).toBe(150000);
    // llama4 (256K) → min(256000, 400000, max(48000, 192000)) = 192000
    expect(getWorkingContextWindow('llama4')).toBe(192000);
  });

  it('caps an on-device runtime to a phone-sized window regardless of nominal size', () => {
    // gemma3 advertises 128K, but a hosted-scale prompt would stall local inference.
    expect(getWorkingContextWindow('gemma3', { onDeviceProvider: true })).toBe(8000);
    // A model whose real window is already smaller than the cap keeps its own size.
    expect(getWorkingContextWindow('phi4', { onDeviceProvider: true })).toBe(8000);
  });
});

describe('getCompactionThreshold', () => {
  it('returns 75% (selective tier) of working context window', () => {
    expect(getCompactionThreshold('gpt-5.4')).toBe(
      Math.floor(MAX_ROUTINE_COMPACTION_WORKING_CONTEXT * SELECTIVE_COMPACTION_THRESHOLD_SHARE),
    );
  });

  it('scales with model size', () => {
    expect(getCompactionThreshold('gpt-5-mini')).toBe(
      Math.floor(MAX_ROUTINE_COMPACTION_WORKING_CONTEXT * SELECTIVE_COMPACTION_THRESHOLD_SHARE),
    );
  });
});

describe('getCompactionWorkingContextWindow', () => {
  it('caps very large working windows at the routine compaction target', () => {
    expect(getCompactionWorkingContextWindow('gpt-5.4')).toBe(
      MAX_ROUTINE_COMPACTION_WORKING_CONTEXT,
    );
    expect(getCompactionWorkingContextWindow('gpt-5-mini')).toBe(
      MAX_ROUTINE_COMPACTION_WORKING_CONTEXT,
    );
  });

  it('leaves smaller working windows unchanged', () => {
    // Below the routine-compaction cap, the working window passes through untouched.
    expect(getCompactionWorkingContextWindow('claude-haiku-4-5')).toBe(150000);
    expect(getCompactionWorkingContextWindow('phi4')).toBe(16384);
  });
});

describe('getCompactionThresholds', () => {
  it('returns three graduated thresholds', () => {
    const thresholds = getCompactionThresholds('gpt-5.4');
    const working = getCompactionWorkingContextWindow('gpt-5.4');
    expect(thresholds.toolClearing).toBe(Math.floor(working * TOOL_CLEARING_THRESHOLD_SHARE));
    expect(thresholds.selective).toBe(Math.floor(working * SELECTIVE_COMPACTION_THRESHOLD_SHARE));
    expect(thresholds.aggressive).toBe(Math.floor(working * AGGRESSIVE_COMPACTION_THRESHOLD_SHARE));
  });

  it('thresholds are ordered: toolClearing < selective < aggressive', () => {
    const thresholds = getCompactionThresholds('claude-sonnet-4-6');
    expect(thresholds.toolClearing).toBeLessThan(thresholds.selective);
    expect(thresholds.selective).toBeLessThan(thresholds.aggressive);
  });
});

describe('token calibration export/import (persistence wiring)', () => {
  afterEach(() => {
    resetTokenCalibrationForTests();
  });

  it('round-trips: record, export, reset, import restores factor and sample count', () => {
    recordObservedTokenRatio('anthropic', 100, 150, NEUTRAL_APPLIED_FACTOR);
    recordObservedTokenRatio('anthropic', 100, 150, getObservedTokenCalibrationFactor('anthropic'));
    const factorBeforeReset = getObservedTokenCalibrationFactor('anthropic');
    const sampleCountBeforeReset = getTokenCalibrationSampleCount('anthropic');
    expect(sampleCountBeforeReset).toBe(2);

    const exported = exportTokenCalibrationState();
    resetTokenCalibrationForTests();
    expect(getObservedTokenCalibrationFactor('anthropic')).toBe(1);
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(0);

    importTokenCalibrationState(exported);
    expect(getObservedTokenCalibrationFactor('anthropic')).toBeCloseTo(factorBeforeReset, 10);
    expect(getTokenCalibrationSampleCount('anthropic')).toBe(sampleCountBeforeReset);
  });

  it('export keys are already the normalized (trimmed, lower-cased) family key', () => {
    recordObservedTokenRatio('  OpenAI  ', 100, 150, NEUTRAL_APPLIED_FACTOR);
    const exported = exportTokenCalibrationState();
    expect(Object.keys(exported)).toEqual(['openai']);
  });

  it('merge precedence: import keeps the higher-sampleCount side per family', () => {
    // Simulate three live observations recorded before hydration finished.
    recordObservedTokenRatio('gemini', 100, 150, NEUTRAL_APPLIED_FACTOR);
    recordObservedTokenRatio('gemini', 100, 150, getObservedTokenCalibrationFactor('gemini'));
    recordObservedTokenRatio('gemini', 100, 150, getObservedTokenCalibrationFactor('gemini'));
    const liveFactor = getObservedTokenCalibrationFactor('gemini');
    expect(getTokenCalibrationSampleCount('gemini')).toBe(3);

    // A stale persisted snapshot from a previous run with fewer samples must not win.
    importTokenCalibrationState({ gemini: { factor: 2.5, sampleCount: 1 } });
    expect(getObservedTokenCalibrationFactor('gemini')).toBe(liveFactor);
    expect(getTokenCalibrationSampleCount('gemini')).toBe(3);

    // A persisted snapshot with a strictly higher sample count wins.
    importTokenCalibrationState({ gemini: { factor: 1.75, sampleCount: 10 } });
    expect(getObservedTokenCalibrationFactor('gemini')).toBe(1.75);
    expect(getTokenCalibrationSampleCount('gemini')).toBe(10);
  });

  it('import adopts a brand-new family with no live entry yet', () => {
    importTokenCalibrationState({ mistral: { factor: 1.6, sampleCount: 4 } });
    expect(getObservedTokenCalibrationFactor('mistral')).toBe(1.6);
    expect(getTokenCalibrationSampleCount('mistral')).toBe(4);
  });

  it('isValidTokenCalibrationState rejects out-of-range, non-finite, and malformed shapes', () => {
    expect(isValidTokenCalibrationState({ factor: 1, sampleCount: 1 })).toBe(true);
    expect(isValidTokenCalibrationState({ factor: 0.1, sampleCount: 1 })).toBe(false); // below MIN
    expect(isValidTokenCalibrationState({ factor: 10, sampleCount: 1 })).toBe(false); // above MAX
    expect(isValidTokenCalibrationState({ factor: NaN, sampleCount: 1 })).toBe(false);
    expect(isValidTokenCalibrationState({ factor: Infinity, sampleCount: 1 })).toBe(false);
    expect(isValidTokenCalibrationState({ factor: 1, sampleCount: -1 })).toBe(false); // negative
    expect(isValidTokenCalibrationState({ factor: 1, sampleCount: 1.5 })).toBe(false); // fractional
    expect(isValidTokenCalibrationState({ factor: 1, sampleCount: NaN })).toBe(false);
    expect(isValidTokenCalibrationState({ factor: '1', sampleCount: 1 })).toBe(false);
    expect(isValidTokenCalibrationState(null)).toBe(false);
    expect(isValidTokenCalibrationState(undefined)).toBe(false);
    expect(isValidTokenCalibrationState('not-an-object')).toBe(false);
    expect(isValidTokenCalibrationState([])).toBe(false);
  });

  it('import silently discards malformed or out-of-range entries instead of applying them', () => {
    importTokenCalibrationState({
      valid: { factor: 1.3, sampleCount: 2 },
      outOfRange: { factor: 99, sampleCount: 2 },
      negativeSamples: { factor: 1.1, sampleCount: -3 },
      fractionalSamples: { factor: 1.1, sampleCount: 2.5 },
      notFinite: { factor: NaN, sampleCount: 2 },
      wrongShape: 'not-an-object',
      missingFields: {},
    });

    expect(getObservedTokenCalibrationFactor('valid')).toBe(1.3);
    expect(getTokenCalibrationSampleCount('valid')).toBe(2);
    for (const key of [
      'outOfRange',
      'negativeSamples',
      'fractionalSamples',
      'notFinite',
      'wrongShape',
      'missingFields',
    ]) {
      expect(getObservedTokenCalibrationFactor(key)).toBe(1);
      expect(getTokenCalibrationSampleCount(key)).toBe(0);
    }
  });

  it('bounds the tracked-family map: importing past the limit evicts the least-sampled entry', () => {
    const entries: Record<string, { factor: number; sampleCount: number }> = {};
    for (let index = 0; index < MAX_TRACKED_CALIBRATION_FAMILIES; index += 1) {
      // Ascending sample counts so `family-0` is unambiguously the least-sampled entry.
      entries[`family-${index}`] = { factor: 1.1, sampleCount: index + 1 };
    }
    importTokenCalibrationState(entries);
    expect(Object.keys(exportTokenCalibrationState())).toHaveLength(
      MAX_TRACKED_CALIBRATION_FAMILIES,
    );
    expect(getTokenCalibrationSampleCount('family-0')).toBe(1);

    // One more family, sampled more than the current least-sampled tracked entry
    // (`family-0`, sampleCount 1), must evict `family-0` rather than grow past the bound.
    importTokenCalibrationState({ overflow: { factor: 1.2, sampleCount: 500 } });

    const exported = exportTokenCalibrationState();
    expect(Object.keys(exported)).toHaveLength(MAX_TRACKED_CALIBRATION_FAMILIES);
    expect(exported['family-0']).toBeUndefined();
    expect(exported.overflow).toEqual({ factor: 1.2, sampleCount: 500 });
  });
});
