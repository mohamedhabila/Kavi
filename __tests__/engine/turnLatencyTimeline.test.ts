import { createTurnLatencyTimeline } from '../../src/engine/turnLatencyTimeline';

function createClock(start: number) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('createTurnLatencyTimeline', () => {
  it('records each stage as elapsed milliseconds since the timeline started', () => {
    const clock = createClock(1_000);
    const timeline = createTurnLatencyTimeline(clock.now);

    clock.advance(40);
    expect(timeline.mark('user_message_added')).toEqual({ user_message_added: 40 });
    clock.advance(260);
    expect(timeline.mark('model_request_dispatched')).toEqual({
      user_message_added: 40,
      model_request_dispatched: 300,
    });
  });

  it('keeps the first mark of a stage and reports a repeat as already recorded', () => {
    const clock = createClock(0);
    const timeline = createTurnLatencyTimeline(clock.now);

    clock.advance(10);
    timeline.mark('first_model_output');
    clock.advance(500);

    expect(timeline.mark('first_model_output')).toBeUndefined();
    expect(timeline.mark('journal_active')).toEqual({
      first_model_output: 10,
      journal_active: 510,
    });
  });

  it('never records a negative offset when the clock moves backwards', () => {
    let current = 5_000;
    const timeline = createTurnLatencyTimeline(() => current);

    current = 4_000;

    expect(timeline.mark('recovery_ready')).toEqual({ recovery_ready: 0 });
  });

  it('returns a copy, so a caller cannot rewrite recorded stages', () => {
    const clock = createClock(0);
    const timeline = createTurnLatencyTimeline(clock.now);
    const first = timeline.mark('provider_ready')!;

    first.provider_ready = 99_999;
    clock.advance(5);

    expect(timeline.mark('journal_active')).toEqual({ provider_ready: 0, journal_active: 5 });
  });
});
