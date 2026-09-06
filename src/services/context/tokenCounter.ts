import { getProviderContextWindow } from './providerContextWindows';
import { resolveModelHostedFamily } from '../llm/catalog/providerFamilies';
// ---------------------------------------------------------------------------
// Kavi — Token Counter (approximate, script-aware)
// ---------------------------------------------------------------------------
// Fast token approximation. A single chars/4 ratio undercounts every
// non-Latin-script user by 2-4x: real BPE tokenizers spend roughly one token
// per 1-2 characters on CJK, Thai, Arabic and Devanagari text because those
// scripts pack far more information per code point than Latin text does. This
// module segments text into Unicode-script runs (structural detection via
// `\p{Script=…}` property escapes — no keyword lists, no language detection)
// and applies a documented chars-per-token ratio per script family, then
// nudges that estimate toward each provider family's own reported token
// counts via an online-calibrated correction factor.
//
// ── Chars-per-token ratios by script family ────────────────────────────────
// | Family                              | chars/token | Source                                              |
// |--------------------------------------|-------------|-----------------------------------------------------|
// | Latin, digits, punctuation, spaces    | 4.0         | OpenAI tiktoken README: "~4 bytes per token" (English)
// |                                        |             | github.com/openai/tiktoken (accessed 2026-09-05)     |
// | Cyrillic, Greek                       | 2.75        | Engineering estimate (mid-point of the 2.5-3 range   |
// |                                        |             | commonly reported for BPE tokenizers on these scripts)|
// | Arabic, Hebrew                        | 2.2         | Engineering estimate; directionally supported by      |
// |                                        |             | Ahia et al. 2023, "Do All Languages Cost the Same?"   |
// |                                        |             | (EMNLP, arXiv:2305.13707) — non-Latin scripts carry a |
// |                                        |             | substantial token-cost premium over English.          |
// | Devanagari + other Indic (Bengali,     | 1.8         | Engineering estimate; Ahia et al. 2023 report close   |
// | Gujarati, Gurmukhi, Kannada,           |             | to a 5x token-cost premium for mid-resourced Indic     |
// | Malayalam, Oriya, Tamil, Telugu,       |             | languages vs. English, consistent with a low ratio.    |
// | Sinhala)                               |             |                                                        |
// | Thai, Lao, Khmer, Myanmar              | 1.8         | Engineering estimate (no per-script published figure  |
// |                                        |             | found; scripts lack spaces, so BPE tokenizers segment  |
// |                                        |             | densely, similar to Indic).                            |
// | Han, Hiragana, Katakana (CJK ideographic/kana) | 1.3 | Engineering estimate within the widely reported ~1-1.5|
// |                                        |             | chars/token range for CJK text on GPT-family tokenizers|
// | Hangul (Korean)                       | 1.6         | Engineering estimate: syllable-block encoding is       |
// |                                        |             | denser than Latin but less so than Han ideographs.     |
//
// Kavi keeps a 1.2x safety margin on top of the blended estimate: undercounting
// risks a 400 from the provider, overcounting only wastes a little budget
// headroom.
export const CHARS_PER_TOKEN = 4;
export const SAFETY_MARGIN = 1.2;
export const LARGE_MODEL_WORKING_CONTEXT_SHARE = 0.75;
export const MIN_LARGE_MODEL_WORKING_CONTEXT = 48_000;
export const MAX_LARGE_MODEL_WORKING_CONTEXT = 400_000;
export const LARGE_MODEL_WORKING_CONTEXT_THRESHOLD = 64_000;
export const MAX_ROUTINE_COMPACTION_WORKING_CONTEXT = 256_000;

/**
 * On-device runtimes are bounded by phone RAM, not by the model's nominal window.
 * A hosted-scale working window would stall or terminate local inference, so local
 * models keep a small, explicitly capped window regardless of their advertised size.
 */
export const ON_DEVICE_MAX_WORKING_CONTEXT = 8_000;

// ── Tiered compaction thresholds ─────────────────────────────────────────
// Based on Anthropic's context engineering guidance: graduated response is
// far more effective than a single cliff-edge compaction.
//
// Tier 1 (TOOL_CLEARING):   Clear old tool results — "safest lightest-touch"
// Tier 2 (SELECTIVE):       Summarize older messages, keep recent context
// Tier 3 (AGGRESSIVE):      Full summarization with minimal recent tail

/** Tier 1: clear old tool results when context exceeds this share */
export const TOOL_CLEARING_THRESHOLD_SHARE = 0.6;

/** Tier 2: selective compaction — summarize old, keep recent messages */
export const SELECTIVE_COMPACTION_THRESHOLD_SHARE = 0.75;

/** Tier 3: aggressive compaction — full summary, minimal recent tail */
export const AGGRESSIVE_COMPACTION_THRESHOLD_SHARE = 0.85;

// ── Script-aware base estimator ──────────────────────────────────────────

type ScriptBucketKey =
  | 'cjkIdeographic'
  | 'hangul'
  | 'thaiLaoKhmerMyanmar'
  | 'arabicHebrew'
  | 'devanagariIndic'
  | 'cyrillicGreek';

interface ScriptBucketDefinition {
  readonly key: ScriptBucketKey;
  readonly pattern: RegExp;
  readonly charsPerToken: number;
}

const CJK_IDEOGRAPHIC_CHARS_PER_TOKEN = 1.3;
const HANGUL_CHARS_PER_TOKEN = 1.6;
const THAI_LAO_KHMER_MYANMAR_CHARS_PER_TOKEN = 1.8;
const ARABIC_HEBREW_CHARS_PER_TOKEN = 2.2;
const DEVANAGARI_INDIC_CHARS_PER_TOKEN = 1.8;
const CYRILLIC_GREEK_CHARS_PER_TOKEN = 2.75;

// Ordered by no particular priority — the classes are mutually exclusive by
// Unicode script, so run order doesn't affect the result. Each pattern greedily
// matches maximal runs of its script family so large texts classify in a
// handful of linear scans rather than per-character regex tests.
const SCRIPT_BUCKET_DEFINITIONS: readonly ScriptBucketDefinition[] = [
  {
    key: 'cjkIdeographic',
    pattern: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu,
    charsPerToken: CJK_IDEOGRAPHIC_CHARS_PER_TOKEN,
  },
  {
    key: 'hangul',
    pattern: /\p{Script=Hangul}+/gu,
    charsPerToken: HANGUL_CHARS_PER_TOKEN,
  },
  {
    key: 'thaiLaoKhmerMyanmar',
    pattern: /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]+/gu,
    charsPerToken: THAI_LAO_KHMER_MYANMAR_CHARS_PER_TOKEN,
  },
  {
    key: 'arabicHebrew',
    pattern: /[\p{Script=Arabic}\p{Script=Hebrew}]+/gu,
    charsPerToken: ARABIC_HEBREW_CHARS_PER_TOKEN,
  },
  {
    key: 'devanagariIndic',
    pattern:
      /[\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Sinhala}]+/gu,
    charsPerToken: DEVANAGARI_INDIC_CHARS_PER_TOKEN,
  },
  {
    key: 'cyrillicGreek',
    pattern: /[\p{Script=Cyrillic}\p{Script=Greek}]+/gu,
    charsPerToken: CYRILLIC_GREEK_CHARS_PER_TOKEN,
  },
];

/**
 * Blended token estimate before calibration and the safety margin. Segments
 * `text` into script-family runs and prices each run at its documented
 * chars-per-token ratio; anything left over (Latin letters, digits,
 * punctuation, whitespace, symbols, emoji) is priced at the Latin baseline.
 */
function estimateScriptAwareRawTokens(text: string): number {
  let tokens = 0;
  let classifiedChars = 0;

  for (const bucket of SCRIPT_BUCKET_DEFINITIONS) {
    bucket.pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = bucket.pattern.exec(text)) !== null) {
      const runLength = match[0].length;
      classifiedChars += runLength;
      tokens += runLength / bucket.charsPerToken;
    }
  }

  const otherChars = Math.max(0, text.length - classifiedChars);
  tokens += otherChars / CHARS_PER_TOKEN;
  return tokens;
}

// ── Online calibration against provider-reported ground truth ──────────────
// A provider's own reported input token count for a request is the only
// ground truth available on-device. `recordObservedTokenRatio` folds that
// signal into a per-provider-family correction factor (exponential moving
// average, clamped) that `estimateTokens` applies on top of the script-aware
// estimate above. It is wired in from `src/engine/graph/modelTurnExecutionSupport.ts`,
// which pairs each request's pre-flight estimate (`budgetResult.result.totalTokens`
// from `agentTurnRequestBudget.ts`) with that same request's provider-reported
// `inputTokens` once the model turn completes — see `recordModelTurnTokenCalibration`
// there for the exact guards applied before a sample is folded in.
//
// The calibration state below is process-lifetime, in-memory only: it resets on
// every app restart and starts every provider family back at the default
// (uncorrected) factor. Persisting it across restarts is out of scope for that
// wiring; `src/services/usage/tracker.ts` is the natural home for it, since it
// already owns durable usage accounting. Doing so would mean serializing
// `TokenCalibrationState` (factor + sampleCount) per provider family alongside the
// tracker's existing persisted state, and hydrating `calibrationByProviderFamily`
// from it at startup instead of the empty `Map` below — there is no other
// blocker to doing that beyond wiring the load/save calls.

/** Floor/ceiling on the learned correction factor so a bad sample (e.g. a
 * request that included non-text content billed as tokens) can't collapse or
 * blow up every future estimate for that provider family. */
const MIN_CALIBRATION_FACTOR = 0.4;
const MAX_CALIBRATION_FACTOR = 2.5;
const DEFAULT_CALIBRATION_FACTOR = 1;

/** Weight given to each new observation in the exponential moving average. */
const CALIBRATION_EMA_ALPHA = 0.2;

interface TokenCalibrationState {
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

  calibrationByProviderFamily.set(key, {
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
 * Estimate the token count of `text`. Pass `family` (e.g. the
 * `LlmProviderFamily` the request will go to — 'anthropic', 'openai',
 * 'gemini', …) to apply that family's learned calibration factor on top of
 * the script-aware base estimate; omit it for a pure structural estimate.
 */
export function estimateTokens(text: string, family?: string | null): number {
  if (!text) return 0;
  const rawTokens = estimateScriptAwareRawTokens(text);
  const calibration = getObservedTokenCalibrationFactor(family);
  return Math.ceil(rawTokens * calibration * SAFETY_MARGIN);
}

export function estimateMessageTokens(
  messages: Array<{ role: string; content: string }>,
  family?: string | null,
): number {
  let total = 0;
  for (const msg of messages) {
    total += 4; // message framing overhead
    total += estimateTokens(msg.role, family);
    total += estimateTokens(msg.content, family);
  }
  total += 2; // conversation priming
  return total;
}

// Model context window sizes (in tokens)
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-5.5': 1000000,
  'gpt-5.4': 1000000,
  'gpt-5.4-mini': 400000,
  'gpt-5-mini': 400000,
  o3: 200000,
  'o4-mini': 200000,
  'claude-opus-5': 1000000,
  'claude-fable-5-1': 1000000,
  'claude-fable-5': 1000000,
  'claude-sonnet-5': 1000000,
  'claude-opus-4-8': 1000000,
  'claude-opus-4-7': 1000000,
  'claude-opus-4-6': 1000000,
  'claude-sonnet-4-6': 1000000,
  'claude-haiku-4-5': 200000,
  'gemini-3.5-flash': 1000000,
  'gemini-3.1-pro-preview': 1000000,
  'gemini-3.1-flash-lite': 1000000,
  'gemini-3-flash-preview': 1000000,
  'gemini-2.5-pro': 1000000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-flash-lite': 1000000,
  llama4: 256000,
  qwen3: 128000,
  'mistral-large-3': 128000,
  gemma3: 128000,
  phi4: 16384,
};

const MODEL_CONTEXT_WINDOW_ENTRIES_BY_SPECIFICITY = Object.entries(MODEL_CONTEXT_WINDOWS).sort(
  (left, right) => right[0].length - left[0].length,
);

export interface GetContextWindowOptions {
  /**
   * A context window the caller already has in hand for this exact call — e.g. a
   * `max_input_tokens` value freshly returned by a discovery request that hasn't
   * been (or shouldn't be) written into the global provider-context-window
   * registry. Wins over every other source, including the registry.
   */
  maxInputTokens?: number;
}

export function getContextWindow(model: string, options?: GetContextWindowOptions): number {
  if (
    typeof options?.maxInputTokens === 'number' &&
    Number.isFinite(options.maxInputTokens) &&
    options.maxInputTokens > 0
  ) {
    return Math.floor(options.maxInputTokens);
  }

  // What the provider says about its own model beats anything guessed here.
  const advertised = getProviderContextWindow(model);
  if (advertised !== undefined) return advertised;

  // Check exact match
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model];

  // Check prefix match
  const lower = model.toLowerCase();
  for (const [key, window] of MODEL_CONTEXT_WINDOW_ENTRIES_BY_SPECIFICITY) {
    if (lower.includes(key.toLowerCase())) return window;
  }

  // Family-level fallback so newer minor revisions inherit safe defaults.
  const hostedFamily = resolveModelHostedFamily(model);
  if (lower.includes('gpt-5')) {
    return lower.includes('mini') ? 400000 : 1000000;
  }

  if (lower === 'o3' || lower.startsWith('o3-') || lower.includes('o4')) {
    return 200000;
  }

  // Haiku is the one current Anthropic family with a smaller window; check it first
  // so the broader generation fallback below doesn't shadow it.
  if (hostedFamily === 'anthropic' && /claude-haiku-[4-9](?:$|[^0-9])/.test(lower)) {
    return 200000;
  }

  if (
    hostedFamily === 'anthropic' &&
    /claude-(?:opus|sonnet|fable|mythos)-[4-9](?:$|[^0-9])/.test(lower)
  ) {
    return 1000000;
  }

  // Any other current-generation Anthropic model (an id encoding generation digit
  // 4-9 that isn't Haiku) inherits the 1M window the rest of the lineup ships
  // with, instead of silently falling through to the generic 128k default below.
  if (hostedFamily === 'anthropic' && /claude-[a-z]+-[4-9](?:$|[^0-9])/.test(lower)) {
    return 1000000;
  }

  if (
    hostedFamily === 'gemini' &&
    (lower.includes('pro') || lower.includes('flash') || lower.includes('lite'))
  ) {
    return 1000000;
  }

  // Default
  return 128000;
}

export interface WorkingContextWindowOptions {
  /** Set when the turn runs against an on-device runtime rather than a hosted provider. */
  onDeviceProvider?: boolean;
  /**
   * Provider family for the online token-calibration EMA (see
   * `recordObservedTokenRatio`/`estimateTokens` above). Carried on this shared
   * options bag so budget-computation call sites can pass it straight through
   * to every `estimateTokens`/`estimateMessageTokens`/`estimateAllToolTokens`
   * call they make; ignored by the window-sizing functions in this file,
   * which don't estimate token counts.
   */
  family?: string;
}

export function getWorkingContextWindow(
  model: string,
  options?: WorkingContextWindowOptions,
): number {
  const hardWindow = getContextWindow(model);

  if (options?.onDeviceProvider) {
    return Math.min(hardWindow, ON_DEVICE_MAX_WORKING_CONTEXT);
  }

  // Keep raw context available for as long as the model can actually hold it, and
  // reach for lossy summarization only when the window is genuinely under pressure.
  // The graduated tiers below still protect the high-salience parts.
  if (hardWindow <= LARGE_MODEL_WORKING_CONTEXT_THRESHOLD) {
    return hardWindow;
  }

  return Math.min(
    hardWindow,
    MAX_LARGE_MODEL_WORKING_CONTEXT,
    Math.max(
      MIN_LARGE_MODEL_WORKING_CONTEXT,
      Math.floor(hardWindow * LARGE_MODEL_WORKING_CONTEXT_SHARE),
    ),
  );
}

export function getCompactionWorkingContextWindow(
  model: string,
  options?: WorkingContextWindowOptions,
): number {
  return Math.min(getWorkingContextWindow(model, options), MAX_ROUTINE_COMPACTION_WORKING_CONTEXT);
}

export function getCompactionThreshold(
  model: string,
  options?: WorkingContextWindowOptions,
): number {
  return Math.floor(
    getCompactionWorkingContextWindow(model, options) * SELECTIVE_COMPACTION_THRESHOLD_SHARE,
  );
}

/**
 * Returns tiered compaction thresholds (in tokens) for graduated context management.
 * Based on Anthropic's context engineering guidance.
 */
export function getCompactionThresholds(
  model: string,
  options?: WorkingContextWindowOptions,
): {
  toolClearing: number;
  selective: number;
  aggressive: number;
} {
  const working = getCompactionWorkingContextWindow(model, options);
  return {
    toolClearing: Math.floor(working * TOOL_CLEARING_THRESHOLD_SHARE),
    selective: Math.floor(working * SELECTIVE_COMPACTION_THRESHOLD_SHARE),
    aggressive: Math.floor(working * AGGRESSIVE_COMPACTION_THRESHOLD_SHARE),
  };
}
