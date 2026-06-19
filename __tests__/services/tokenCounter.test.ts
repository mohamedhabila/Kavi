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

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for falsy input', () => {
    expect(estimateTokens(undefined as any)).toBe(0);
    expect(estimateTokens(null as any)).toBe(0);
  });

  it('estimates roughly 1 token per 3.5 chars', () => {
    const text = 'Hello world'; // 11 chars → ~3.14 → ceil → 4
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBe(Math.ceil(11 / 3.5));
  });

  it('scales linearly with length', () => {
    const short = estimateTokens('hi');
    const long = estimateTokens('hi'.repeat(100));
    expect(long).toBeGreaterThan(short);
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
});

describe('getWorkingContextWindow', () => {
  it('keeps small context windows unchanged', () => {
    expect(getWorkingContextWindow('phi4')).toBe(16384);
  });

  it('caps large context windows to a smaller working target', () => {
    // MAX raised to 200K — gpt-5.4 (1M) → min(200000, max(48000, 250000)) = 200000
    expect(getWorkingContextWindow('gpt-5.4')).toBe(200000);
    // gpt-5-mini (400K) → min(200000, max(48000, 100000)) = 100000
    expect(getWorkingContextWindow('gpt-5-mini')).toBe(100000);
    // claude-haiku-4-5 (200K) → min(200000, max(48000, 50000)) = 50000
    expect(getWorkingContextWindow('claude-haiku-4-5')).toBe(50000);
    // llama4 (256K) → min(200000, max(48000, 64000)) = 64000
    expect(getWorkingContextWindow('llama4')).toBe(64000);
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
    expect(getCompactionWorkingContextWindow('claude-haiku-4-5')).toBe(50000);
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
