/**
 * Context windows a provider advertises for its own models.
 *
 * `getContextWindow` resolved a window from a hardcoded table of known model names with
 * prefix and family fallbacks. Any model nobody had enumerated fell through to a 128,000
 * default — and the fallback is invisible, because a wrong window produces no error, just
 * history discarded earlier than it needed to be.
 *
 * Traced on-device against `deepseek/deepseek-v4-flash-latest`, whose real window is
 * 1,050,000: the table has no deepseek entry, so the model resolved to 128,000 and a
 * working window of 96,000 — about nine percent of what the model can actually hold. A
 * long run would have compacted roughly eleven times sooner than necessary, which is
 * exactly the premature lossy summarization the working-window work set out to avoid.
 *
 * Model discovery already fetches the provider's catalogue, and OpenRouter publishes
 * `context_length` per model there, so the true value was on hand and unread. Recording
 * it makes the window right for every model the provider lists rather than for the ones
 * someone remembered to add here, and the static table stays as the fallback for
 * providers that advertise nothing.
 */

/** Below this a value is a mis-parse; above it, not a context window. */
const MIN_CREDIBLE_CONTEXT_WINDOW = 1_000;
const MAX_CREDIBLE_CONTEXT_WINDOW = 20_000_000;

const providerContextWindows = new Map<string, number>();

function normalizeModelKey(model: string): string {
  return model.trim().toLowerCase();
}

/** Reads a context window from a provider catalogue entry, in the shapes providers use. */
export function readAdvertisedContextWindow(entry: unknown): number | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }
  const record = entry as Record<string, unknown>;
  const topProvider = record.top_provider;
  const candidates: unknown[] = [
    record.context_length,
    record.context_window,
    record.max_context_tokens,
    record.max_input_tokens,
    topProvider && typeof topProvider === 'object'
      ? (topProvider as Record<string, unknown>).context_length
      : undefined,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? Number(candidate) : candidate;
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= MIN_CREDIBLE_CONTEXT_WINDOW &&
      value <= MAX_CREDIBLE_CONTEXT_WINDOW
    ) {
      return Math.floor(value);
    }
  }
  return undefined;
}

export function recordProviderContextWindow(model: string, contextWindow: number): void {
  const key = normalizeModelKey(model);
  if (
    !key ||
    !Number.isFinite(contextWindow) ||
    contextWindow < MIN_CREDIBLE_CONTEXT_WINDOW ||
    contextWindow > MAX_CREDIBLE_CONTEXT_WINDOW
  ) {
    return;
  }
  providerContextWindows.set(key, Math.floor(contextWindow));
}

/** The advertised window for `model`, when its provider published one. */
export function getProviderContextWindow(model: string): number | undefined {
  return providerContextWindows.get(normalizeModelKey(model));
}

export function clearProviderContextWindowsForTests(): void {
  providerContextWindows.clear();
}

/** Replays windows persisted with a provider config into the in-memory registry. */
export function hydrateProviderContextWindows(
  windowsByModel: Readonly<Record<string, number>> | undefined,
): void {
  if (!windowsByModel) {
    return;
  }
  for (const [model, contextWindow] of Object.entries(windowsByModel)) {
    recordProviderContextWindow(model, contextWindow);
  }
}
