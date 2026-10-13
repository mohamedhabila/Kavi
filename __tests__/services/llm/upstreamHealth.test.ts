import {
  _resetUpstreamToolCallHealthForTests,
  getExcludedUpstreams,
  noteToolCallsServedBy,
  noteUpstreamCacheResult,
  settleToolCallOutcome,
} from '../../../src/services/llm/support/upstreamHealth';

// On OpenRouter one upstream stripped GLM 5.3 Flash's tool arguments and looped every run
// it served. People bring their own keys, so the app itself routes around an upstream
// whose tool calls keep arriving malformed.

const MODEL = 'z-ai/glm-5.3-flash';
let sequence = 0;

function call(upstream: string, outcome: 'fault' | 'ok' | 'other_failure', now = 1_000) {
  sequence += 1;
  const id = `call-${sequence}`;
  noteToolCallsServedBy({ model: MODEL, upstream, toolCallIds: [id] });
  settleToolCallOutcome(
    outcome === 'ok'
      ? { id, status: 'completed' }
      : {
          id,
          status: 'failed',
          failureKind: outcome === 'fault' ? 'invalid_arguments' : 'network',
        },
    now,
  );
}

beforeEach(() => {
  _resetUpstreamToolCallHealthForTests();
});

describe('upstream tool-call health', () => {
  it('routes around an upstream after two malformed tool calls in a row', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    call('InferenceNet', 'fault');
    expect(getExcludedUpstreams(MODEL, 1_000)).toEqual([]);

    call('InferenceNet', 'fault');

    expect(getExcludedUpstreams(MODEL, 1_000)).toEqual(['InferenceNet']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('forgives a fault followed by a good call', () => {
    call('Parasail', 'fault');
    call('Parasail', 'ok');
    call('Parasail', 'fault');

    expect(getExcludedUpstreams(MODEL, 1_000)).toEqual([]);
  });

  it('is not moved by failures that say nothing about the upstream', () => {
    call('Together', 'other_failure');
    call('Together', 'other_failure');

    expect(getExcludedUpstreams(MODEL, 1_000)).toEqual([]);
  });

  it('tries an excluded upstream again after its time out', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    call('InferenceNet', 'fault', 1_000);
    call('InferenceNet', 'fault', 1_000);

    expect(getExcludedUpstreams(MODEL, 1_000 + 2 * 60 * 60 * 1000 + 1)).toEqual([]);
  });

  it('never leaves out more than three upstreams for a model', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (const upstream of ['A', 'B', 'C', 'D']) {
      call(upstream, 'fault');
      call(upstream, 'fault');
    }

    expect(getExcludedUpstreams(MODEL, 1_000)).toEqual(['A', 'B', 'C']);
  });

  it('keeps each model to itself', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    call('InferenceNet', 'fault');
    call('InferenceNet', 'fault');

    expect(getExcludedUpstreams('other/model', 1_000)).toEqual([]);
  });

  it('ignores calls from providers that report no upstream', () => {
    noteToolCallsServedBy({ model: MODEL, upstream: undefined, toolCallIds: ['direct-1'] });
    settleToolCallOutcome({ id: 'direct-1', status: 'failed', failureKind: 'invalid_arguments' });
    noteToolCallsServedBy({ model: MODEL, upstream: undefined, toolCallIds: ['direct-2'] });
    settleToolCallOutcome({ id: 'direct-2', status: 'failed', failureKind: 'invalid_arguments' });

    expect(getExcludedUpstreams(MODEL)).toEqual([]);
  });
});

// Every GLM 5.3 Flash upstream lists a cache-read price, but one read 3k of 191k input tokens
// from cache over 38 calls repeating the prefix before them while another read 91%; the
// aggregator keeps a conversation on its first upstream, so landing there costs full price.
describe('upstream prompt-cache health', () => {
  const PREFIX = 'prompt-prefix-fnv1a32:abc|tools:def';
  const MINUTE = 60_000;

  function cacheCall(upstream: string, at: number, cacheReadTokens: number, overrides = {}) {
    noteUpstreamCacheResult({
      model: MODEL,
      upstream,
      prefixDigest: PREFIX,
      inputTokens: 10_000,
      cacheReadTokens,
      now: at,
      ...overrides,
    });
  }

  it('routes around an upstream after three repeated prefixes that read nothing from cache', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    cacheCall('Venice', 0, 0);
    cacheCall('Venice', 1 * MINUTE, 0);
    cacheCall('Venice', 2 * MINUTE, 0);
    expect(getExcludedUpstreams(MODEL, 2 * MINUTE)).toEqual([]);

    cacheCall('Venice', 3 * MINUTE, 0);
    expect(getExcludedUpstreams(MODEL, 3 * MINUTE)).toEqual(['Venice']);
    expect(warn).toHaveBeenCalled();
    expect(getExcludedUpstreams(MODEL, 3 * MINUTE + 2 * 60 * MINUTE + 1)).toEqual([]);
  });

  it('keeps an upstream whose cache hits, even after some misses', () => {
    cacheCall('Together', 0, 0);
    cacheCall('Together', MINUTE, 0);
    cacheCall('Together', 2 * MINUTE, 0);
    cacheCall('Together', 3 * MINUTE, 3_776);
    cacheCall('Together', 4 * MINUTE, 0);
    cacheCall('Together', 5 * MINUTE, 0);

    expect(getExcludedUpstreams(MODEL, 5 * MINUTE)).toEqual([]);
  });

  it('expects no hit for a first prefix, a stale one, a short one or an unknown upstream', () => {
    // Each call starts its prefix anew: more than five minutes passed since the last.
    for (let index = 0; index < 6; index += 1) cacheCall('Crusoe', index * 6 * MINUTE, 0);
    // Too short to be cached by every provider, and calls an aggregator did not attribute.
    for (let index = 0; index < 6; index += 1) {
      cacheCall('Crusoe', 40 * MINUTE + index * MINUTE, 0, { inputTokens: 1_000 });
      cacheCall('', 40 * MINUTE + index * MINUTE, 0);
      cacheCall('Crusoe', 40 * MINUTE + index * MINUTE, 0, { prefixDigest: undefined });
    }

    expect(getExcludedUpstreams(MODEL, 50 * MINUTE)).toEqual([]);
  });
});
