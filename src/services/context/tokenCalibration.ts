// ---------------------------------------------------------------------------
// Kavi — Token Calibration
// ---------------------------------------------------------------------------
// Online calibration of the script-aware token estimator in `tokenCounter.ts`
// against provider-reported ground truth. A provider's own reported input
// token count for a request is the only ground truth available on-device.
// `recordObservedTokenRatio` folds that signal into a per-provider-family
// correction factor (exponential moving average, clamped) that
// `estimateTokens` (in `tokenCounter.ts`) applies on top of its script-aware
// base estimate. It is wired in from
// `src/engine/graph/modelTurnExecutionSupport.ts`, which pairs each
// request's pre-flight estimate (`budgetResult.result.totalTokens` from
// `agentTurnRequestBudget.ts`) with that same request's provider-reported
// `inputTokens` once the model turn completes — see
// `recordModelTurnTokenCalibration` there for the exact guards applied
// before a sample is folded in.
//
// Persistence: this module itself is pure, in-memory state with no storage
// I/O — `calibrationByProviderFamily` still resets to empty on every module
// load. Durable persistence across app restarts is layered on top by
// `src/services/usage/tracker.ts`, via the `exportTokenCalibrationState` /
// `importTokenCalibrationState` functions at the bottom of this file:
// `tracker.ts` serializes the export after each observation (through the
// app's existing debounced `throttledAsyncStorage`, so no synchronous write
// happens per model turn) and hydrates via the import at app startup (see
// `hydrateTokenCalibrationFromStorage` in `tracker.ts`, called from
// `src/services/startup.ts`). Hydration is async and races the first model
// turn: any observation recorded before it resolves already reflects the
// in-memory default (factor 1, sample count 0) for that family, and
// `importTokenCalibrationState` is written to never regress it — it keeps
// whichever side (persisted or already-live) has the higher `sampleCount`
// per family, so a hydration that loses that race is a no-op rather than a
// rollback.

/**
 * Kavi keeps a 1.2x safety margin on top of the blended script-aware
 * estimate: undercounting risks a 400 from the provider, overcounting only
 * wastes a little budget headroom. Re-exported from `tokenCounter.ts`
 * (its home from a public-API standpoint) but defined here because
 * `recordObservedTokenRatio` needs it to recover an observation's
 * uncalibrated base estimate — see that function's doc comment below.
 */
export const SAFETY_MARGIN = 1.2;

/** Floor/ceiling on the learned correction factor so a bad sample (e.g. a
 * request that included non-text content billed as tokens) can't collapse or
 * blow up every future estimate for that provider family. */
const MIN_CALIBRATION_FACTOR = 0.4;
const MAX_CALIBRATION_FACTOR = 2.5;
const DEFAULT_CALIBRATION_FACTOR = 1;

/** Weight given to each new observation in the exponential moving average. */
const CALIBRATION_EMA_ALPHA = 0.2;

/**
 * Upper bound on distinct provider families tracked at once. In practice this
 * is bounded by the handful of hosted-model families Kavi talks to, but
 * `family` ultimately comes from caller-supplied strings, so the map is
 * capped defensively rather than left to grow without bound — both against
 * live observations and against a persisted snapshot with more entries than
 * this that gets hydrated back in (see `importTokenCalibrationState`). The
 * least-sampled entry is evicted to make room for a new one past the bound.
 */
export const MAX_TRACKED_CALIBRATION_FAMILIES = 32;

export interface TokenCalibrationState {
  factor: number;
  sampleCount: number;
}

const calibrationByProviderFamily = new Map<string, TokenCalibrationState>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeCalibrationFamilyKey(family: string | undefined | null): string {
  return typeof family === 'string' ? family.trim().toLowerCase() : '';
}

/**
 * Type guard for a persisted `{ factor, sampleCount }` entry: `factor` must be
 * a finite number within the clamp range and `sampleCount` a finite
 * non-negative integer. Shared by `recordObservedTokenRatio`'s internal
 * writes and by `importTokenCalibrationState`, so a malformed or
 * out-of-range persisted value is rejected the same way a malformed live
 * observation would be.
 */
export function isValidTokenCalibrationState(value: unknown): value is TokenCalibrationState {
  if (!value || typeof value !== 'object') return false;
  const { factor, sampleCount } = value as { factor?: unknown; sampleCount?: unknown };
  return (
    typeof factor === 'number' &&
    Number.isFinite(factor) &&
    factor >= MIN_CALIBRATION_FACTOR &&
    factor <= MAX_CALIBRATION_FACTOR &&
    typeof sampleCount === 'number' &&
    Number.isFinite(sampleCount) &&
    Number.isInteger(sampleCount) &&
    sampleCount >= 0
  );
}

/**
 * Insert-or-replace a family's calibration state, evicting the least-sampled
 * tracked family first if the map is at `MAX_TRACKED_CALIBRATION_FAMILIES`
 * and `key` isn't already present.
 */
function setCalibrationEntry(key: string, state: TokenCalibrationState): void {
  if (
    !calibrationByProviderFamily.has(key) &&
    calibrationByProviderFamily.size >= MAX_TRACKED_CALIBRATION_FAMILIES
  ) {
    let leastSampledKey: string | null = null;
    let leastSampleCount = Infinity;
    for (const [candidateKey, candidateState] of calibrationByProviderFamily) {
      if (candidateState.sampleCount < leastSampleCount) {
        leastSampleCount = candidateState.sampleCount;
        leastSampledKey = candidateKey;
      }
    }
    if (leastSampledKey !== null) {
      calibrationByProviderFamily.delete(leastSampledKey);
    }
  }

  calibrationByProviderFamily.set(key, state);
}

/**
 * Record one ground-truth observation: `estimatedTokens` is what
 * `estimateTokens` predicted for a request before it was sent — i.e.
 * `rawTokens × appliedFactor × SAFETY_MARGIN`, already carrying both the
 * calibration factor that was in effect at prediction time and the fixed
 * safety margin — and `actualTokens` is the provider's own reported input
 * token count for that same request (e.g. `NormalizedUsage.inputTokens` from
 * `src/services/usage/usageNormalization.ts`).
 *
 * `appliedFactor` must be the calibration factor the caller read via
 * {@link getObservedTokenCalibrationFactor} at the moment it computed
 * `estimatedTokens` — not whatever the factor happens to be now, which may
 * have moved if other observations landed in between. It is used to recover
 * the uncalibrated, un-margined base estimate (`rawTokens`) that
 * `estimatedTokens` was built from: `base = estimatedTokens / (appliedFactor
 * × SAFETY_MARGIN)`. The observed ratio is then computed against that base,
 * `observed = actualTokens / base`, not against `estimatedTokens` directly.
 *
 * This indirection matters: `estimatedTokens` already has both the margin and
 * the (old) factor baked in, so comparing `actualTokens` straight against it
 * would (a) treat the safety margin itself as calibration error, driving the
 * learned factor toward a fixed point with zero headroom instead of
 * `SAFETY_MARGIN` above actual, and (b) once the factor is folded into the
 * pre-flight estimate too, converge the factor to `sqrt(trueRatio)` instead of
 * `trueRatio` (the factor would be squaring itself against its own prior
 * output every round). Recovering `base` first and comparing against that
 * fixes both: the EMA converges to the true raw-to-actual ratio, and
 * `estimateTokens` keeps exactly `SAFETY_MARGIN` headroom over actual once
 * converged.
 *
 * Folds the observed ratio into that provider family's correction factor via
 * an EMA, clamped to [{@link MIN_CALIBRATION_FACTOR}, {@link
 * MAX_CALIBRATION_FACTOR}].
 *
 * Called from `recordModelTurnTokenCalibration` in
 * `src/engine/graph/modelTurnExecutionSupport.ts`, once per completed model
 * request, pairing that request's own pre-flight estimate
 * (`budgetResult.result.totalTokens` from `agentTurnRequestBudget.ts`) and the
 * calibration factor applied to it with its own provider-reported
 * `inputTokens` — never an estimate from one request paired with the usage of
 * another (a retry, a streaming re-attempt, a sub-agent turn).
 */
export function recordObservedTokenRatio(
  family: string | undefined | null,
  estimatedTokens: number,
  actualTokens: number,
  appliedFactor: number,
): void {
  const key = normalizeCalibrationFamilyKey(family);
  if (!key) return;
  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) return;
  if (!Number.isFinite(actualTokens) || actualTokens < 0) return;
  if (!Number.isFinite(appliedFactor) || appliedFactor <= 0) return;

  // Recover the uncalibrated, un-margined base the pre-flight estimate was
  // built from, so the observed ratio measures calibration drift alone —
  // see the doc comment above for why comparing against `estimatedTokens`
  // directly would be wrong.
  const base = estimatedTokens / (appliedFactor * SAFETY_MARGIN);
  if (!Number.isFinite(base) || base <= 0) return;

  const observedFactor = clamp(actualTokens / base, MIN_CALIBRATION_FACTOR, MAX_CALIBRATION_FACTOR);
  const prior = calibrationByProviderFamily.get(key);
  // Blend from the default (no-correction) factor even on the very first
  // observation, rather than snapping straight to it — a single noisy sample
  // (e.g. a request that mixed in non-text content) should only nudge the
  // factor, not set it outright.
  const priorFactor = prior?.factor ?? DEFAULT_CALIBRATION_FACTOR;
  const blendedFactor = priorFactor + CALIBRATION_EMA_ALPHA * (observedFactor - priorFactor);

  setCalibrationEntry(key, {
    factor: clamp(blendedFactor, MIN_CALIBRATION_FACTOR, MAX_CALIBRATION_FACTOR),
    sampleCount: (prior?.sampleCount ?? 0) + 1,
  });
}

/** The current correction factor for a provider family, or 1 (no correction) if unobserved. */
export function getObservedTokenCalibrationFactor(family: string | undefined | null): number {
  const key = normalizeCalibrationFamilyKey(family);
  if (!key) return DEFAULT_CALIBRATION_FACTOR;
  return calibrationByProviderFamily.get(key)?.factor ?? DEFAULT_CALIBRATION_FACTOR;
}

/** Number of observations folded into a provider family's calibration factor so far. */
export function getTokenCalibrationSampleCount(family: string | undefined | null): number {
  const key = normalizeCalibrationFamilyKey(family);
  if (!key) return 0;
  return calibrationByProviderFamily.get(key)?.sampleCount ?? 0;
}

export function resetTokenCalibrationForTests(): void {
  calibrationByProviderFamily.clear();
}

/**
 * Snapshot of every tracked family's calibration state, keyed by the
 * normalized family key `recordObservedTokenRatio` stores under. Read by
 * `src/services/usage/tracker.ts` after each observation to persist it
 * durably; carries no storage concerns itself.
 */
export function exportTokenCalibrationState(): Readonly<Record<string, TokenCalibrationState>> {
  return Object.fromEntries(calibrationByProviderFamily);
}

/**
 * Merge a previously-exported (and, by the time it reaches here, already
 * validated) snapshot back into the live calibration map — used by
 * `src/services/usage/tracker.ts` to hydrate persisted state at startup.
 *
 * Per family key, the persisted entry wins only if its `sampleCount` is
 * strictly greater than whatever this process has already recorded live for
 * that family. This makes hydration safe to race against the first model
 * turns after launch: if an observation lands before the persisted snapshot
 * finishes loading, that live observation's higher sample count is kept and
 * the stale persisted value for that family is dropped rather than
 * clobbering it. Entries failing {@link isValidTokenCalibrationState} are
 * skipped rather than applied — this is the last line of defense against a
 * corrupted or tampered payload even though `tracker.ts` also validates
 * before calling in.
 */
export function importTokenCalibrationState(
  entries: Readonly<Record<string, unknown>>,
): void {
  for (const [rawKey, candidate] of Object.entries(entries)) {
    if (!isValidTokenCalibrationState(candidate)) continue;
    const key = normalizeCalibrationFamilyKey(rawKey);
    if (!key) continue;

    const current = calibrationByProviderFamily.get(key);
    if (current && current.sampleCount >= candidate.sampleCount) continue;

    setCalibrationEntry(key, {
      factor: clamp(candidate.factor, MIN_CALIBRATION_FACTOR, MAX_CALIBRATION_FACTOR),
      sampleCount: candidate.sampleCount,
    });
  }
}
