// ---------------------------------------------------------------------------
// Kavi — what the Claude API changed in a request before the model read it
// ---------------------------------------------------------------------------
// Under ANTHROPIC_THINKING_BINDING_BETA every response lists the replayed thinking blocks
// the API dropped (input_transformations): blocks whose earlier history changed, or that
// the model cannot read. A dropped block costs Claude its earlier reasoning and more output
// tokens to rebuild it, so each one is logged where a run's cost is investigated.
// ---------------------------------------------------------------------------

import { createLogger } from '../../../../utils/logger';
import { isPlainRecord } from '../../core/json';

const logger = createLogger('llm.anthropic');

/** Counts the dropped thinking blocks a response reports, by reason, and logs them. */
export function noteAnthropicInputTransformations(raw: unknown, model: string): number {
  if (!Array.isArray(raw)) return 0;
  const reasons: Record<string, number> = {};
  let dropped = 0;
  for (const entry of raw) {
    if (!isPlainRecord(entry) || entry.type !== 'thinking_dropped') continue;
    dropped += 1;
    const reason = typeof entry.reason === 'string' ? entry.reason : 'unknown';
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  if (dropped > 0) {
    logger.warn('Claude dropped replayed thinking blocks.', { model, dropped, reasons });
  }
  return dropped;
}
