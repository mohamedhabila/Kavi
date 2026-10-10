import {
  _resetUpstreamToolCallHealthForTests,
  getExcludedUpstreams,
  noteToolCallsServedBy,
  settleToolCallOutcome,
} from '../../../src/services/llm/support/upstreamToolCallHealth';

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
