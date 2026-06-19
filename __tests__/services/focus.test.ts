import {
  bucketFocusGap,
  composeActiveFocusContent,
  renderFocusBlock,
  type FocusBlockInput,
} from '../../src/services/memory/focus';

const T0 = Date.parse('2026-04-29T15:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function gap(deltaMs: number, extras: Partial<Parameters<typeof bucketFocusGap>[0]> = {}) {
  return bucketFocusGap({ now: T0 + deltaMs, focusAnchor: T0, ...extras });
}

describe('bucketFocusGap', () => {
  it('returns "live" with empty phrase for sub-2-minute gaps', () => {
    expect(gap(0).bucket).toBe('live');
    expect(gap(0).phrase).toBe('');
    expect(gap(MIN).bucket).toBe('live');
  });

  it('uses the same phrase across the entire short_break bucket', () => {
    const a = gap(3 * MIN);
    const b = gap(10 * MIN);
    expect(a.bucket).toBe('short_break');
    expect(b.bucket).toBe('short_break');
    expect(a.phrase).toBe(b.phrase);
  });

  it('renders an approximate minute count in longer_break', () => {
    const result = gap(45 * MIN);
    expect(result.bucket).toBe('longer_break');
    expect(result.phrase).toMatch(/~45m/);
  });

  it('renders an approximate hour count and clock stamp in later_today', () => {
    const result = gap(5 * HOUR, { anchorHour: 10, anchorMinute: 30 });
    expect(result.bucket).toBe('later_today');
    expect(result.phrase).toMatch(/~5h ago/);
    expect(result.phrase).toMatch(/10:30am/);
  });

  it('flags yesterday and includes anchor clock when available', () => {
    const result = gap(28 * HOUR, { anchorHour: 21, anchorMinute: 5 });
    expect(result.bucket).toBe('yesterday');
    expect(result.phrase).toMatch(/yesterday 9:05pm/);
  });

  it('reports a day count for this_week', () => {
    const result = gap(3 * DAY);
    expect(result.bucket).toBe('this_week');
    expect(result.phrase).toMatch(/3 days/);
  });

  it('emits an extended_break phrase with weekday + date when provided', () => {
    const result = gap(20 * DAY, { anchorWeekday: 'Monday', anchorDateLabel: 'Mar 9' });
    expect(result.bucket).toBe('extended_break');
    expect(result.phrase).toMatch(/Monday/);
    expect(result.phrase).toMatch(/Mar 9/);
  });
});

describe('composeActiveFocusContent', () => {
  it('preserves thread title metadata ahead of rolling focus content', () => {
    expect(
      composeActiveFocusContent({
        threadTitle: 'longmem-delayed-thread',
        activeFocus: 'Running: memory_recall',
      }),
    ).toBe('longmem-delayed-thread\nRunning: memory_recall');
  });

  it('does not duplicate an existing thread title anchor', () => {
    expect(
      composeActiveFocusContent({
        threadTitle: 'longmem-delayed-thread',
        activeFocus: 'longmem-delayed-thread\nRunning: memory_recall',
      }),
    ).toBe('longmem-delayed-thread\nRunning: memory_recall');
  });
});

function buildInput(overrides: Partial<FocusBlockInput> = {}): FocusBlockInput {
  return {
    now: T0,
    lastAssistantAt: T0 - 30 * MIN,
    lastUserAt: T0 - 25 * MIN,
    threadCreatedAt: T0 - DAY,
    ...overrides,
  };
}

describe('renderFocusBlock', () => {
  it('returns empty text when nothing meaningful to render', () => {
    const result = renderFocusBlock(buildInput({ lastAssistantAt: T0 - 30_000 }));
    expect(result.text).toBe('');
    expect(result.gap.bucket).toBe('live');
  });

  it('wraps content in <focus> tags by default', () => {
    const result = renderFocusBlock(
      buildInput({ activeFocus: 'Wiring up new memory primitives.' }),
    );
    expect(result.text.startsWith('<focus>\n')).toBe(true);
    expect(result.text.endsWith('\n</focus>')).toBe(true);
    expect(result.text).toContain('Recently we were: Wiring up new memory primitives.');
  });

  it('omits the wrapper when bare=true', () => {
    const result = renderFocusBlock(
      buildInput({ bare: true, activeFocus: 'short note' }),
    );
    expect(result.text.startsWith('<focus>')).toBe(false);
    expect(result.text).toContain('short note');
  });

  it('renders open threads with the most recent first and caps at five', () => {
    const result = renderFocusBlock(
      buildInput({
        openThreads: ['t1', 't2', 't3', 't4', 't5', 't6', 't7'],
      }),
    );
    expect(result.text).toContain('Open threads (most recent first):');
    expect(result.text).toContain('- t1');
    expect(result.text).toContain('- t5');
    expect(result.text).not.toContain('- t6');
  });

  it('falls back to lastUserAt then threadCreatedAt when assistant timestamp missing', () => {
    const fromUser = renderFocusBlock(buildInput({ lastAssistantAt: null }));
    const fromThread = renderFocusBlock(
      buildInput({ lastAssistantAt: null, lastUserAt: null }),
    );
    expect(fromUser.gap.gapMs).toBe(25 * MIN);
    expect(fromThread.gap.gapMs).toBe(DAY);
  });

  it('produces byte-identical output for two turns inside the same bucket', () => {
    const a = renderFocusBlock(buildInput({ now: T0, lastAssistantAt: T0 - 5 * MIN }));
    const b = renderFocusBlock(buildInput({ now: T0 + 60_000, lastAssistantAt: T0 - 5 * MIN + 60_000 }));
    // Same gap, same phrase => same rendered text.
    expect(a.text).toBe(b.text);
  });

  it('includes a notable subsection only when entries exist', () => {
    const without = renderFocusBlock(buildInput({ activeFocus: 'x' }));
    const withNotable = renderFocusBlock(
      buildInput({
        activeFocus: 'x',
        notableSinceLastTurn: ['User mentioned new project "Atlas"'],
      }),
    );
    expect(without.text).not.toContain('Notable since last turn');
    expect(withNotable.text).toContain('Notable since last turn');
    expect(withNotable.text).toContain('- User mentioned new project "Atlas"');
  });

  it('truncates an over-long active_focus block', () => {
    const long = 'x'.repeat(2000);
    const result = renderFocusBlock(buildInput({ activeFocus: long }));
    expect(result.text.length).toBeLessThan(900);
    expect(result.text).toMatch(/\u2026/);
  });
});
