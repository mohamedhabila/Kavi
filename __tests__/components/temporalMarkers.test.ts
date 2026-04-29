import {
  computeTemporalMarkers,
  type TemporalMarker,
} from '../../src/components/chat/temporalMarkers';

const ts = (iso: string) => new Date(iso).getTime();

const msg = (id: string, role: 'user' | 'assistant', timestamp: number) => ({
  id,
  role,
  timestamp,
});

describe('computeTemporalMarkers', () => {
  it('returns no markers for an empty thread', () => {
    expect(computeTemporalMarkers([], { now: ts('2026-05-01T12:00:00') })).toEqual([]);
  });

  it('emits a thread-start marker before the very first message', () => {
    const markers = computeTemporalMarkers(
      [msg('m1', 'user', ts('2026-05-01T09:30:00'))],
      { now: ts('2026-05-01T09:30:01'), locale: 'en-US' },
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe('thread-start');
    expect(markers[0].beforeMessageId).toBe('m1');
    expect(markers[0].text).toMatch(/Conversation began/);
  });

  it('emits a day-separator when adjacent messages cross local midnight', () => {
    const markers = computeTemporalMarkers(
      [
        msg('m1', 'user', ts('2026-05-01T23:50:00')),
        msg('m2', 'assistant', ts('2026-05-02T00:10:00')),
      ],
      { now: ts('2026-05-02T00:10:01'), locale: 'en-US' },
    );
    const sep = markers.find((m) => m.beforeMessageId === 'm2');
    expect(sep?.kind).toBe('day-separator');
    expect(sep?.text).toBe('Today');
  });

  it('emits "later that day" for gaps ≥ 4 hours within the same day', () => {
    const markers = computeTemporalMarkers(
      [
        msg('m1', 'user', ts('2026-05-01T08:00:00')),
        msg('m2', 'assistant', ts('2026-05-01T14:30:00')),
      ],
      { now: ts('2026-05-01T14:30:01'), locale: 'en-US' },
    );
    const later = markers.find((m) => m.beforeMessageId === 'm2');
    expect(later?.kind).toBe('later-that-day');
    expect(later?.text).toMatch(/Later that day/);
  });

  it('emits a soft inline timestamp for medium gaps (≥30m, <4h, same day)', () => {
    const markers = computeTemporalMarkers(
      [
        msg('m1', 'user', ts('2026-05-01T10:00:00')),
        msg('m2', 'assistant', ts('2026-05-01T11:00:00')),
      ],
      { now: ts('2026-05-01T11:00:01'), locale: 'en-US' },
    );
    const soft = markers.find((m) => m.beforeMessageId === 'm2');
    expect(soft?.kind).toBe('soft-timestamp');
  });

  it('does NOT emit any inline marker for short gaps (< 30m, same day)', () => {
    const markers = computeTemporalMarkers(
      [
        msg('m1', 'user', ts('2026-05-01T10:00:00')),
        msg('m2', 'assistant', ts('2026-05-01T10:05:00')),
      ],
      { now: ts('2026-05-01T10:05:01') },
    );
    // Only the thread-start marker should exist.
    expect(markers).toHaveLength(1);
    expect(markers[0].kind).toBe('thread-start');
  });

  it('emits a cold-start cue when `now` is far from the last message', () => {
    const lastTs = ts('2026-05-01T10:00:00');
    const markers = computeTemporalMarkers(
      [
        msg('m1', 'user', lastTs - 60_000),
        msg('m2', 'assistant', lastTs),
      ],
      { now: lastTs + 6 * 3_600_000, coldStartGapMs: 30 * 60_000 },
    );
    const cue = markers.find((m) => m.kind === 'cold-start-cue');
    expect(cue).toBeDefined();
    expect(cue?.beforeMessageId).toBe('m2');
    expect(cue?.text).toMatch(/Continuing — last spoke ~6h ago/);
  });

  it('does not emit a cold-start cue when within the gap threshold', () => {
    const lastTs = ts('2026-05-01T10:00:00');
    const markers = computeTemporalMarkers(
      [msg('m1', 'user', lastTs)],
      { now: lastTs + 5 * 60_000, coldStartGapMs: 30 * 60_000 },
    );
    expect(markers.find((m) => m.kind === 'cold-start-cue')).toBeUndefined();
  });

  it('uses weekday names for gaps within the past week', () => {
    // Monday → Wednesday (3 days back from now)
    const monday = ts('2026-04-27T09:00:00');
    const wednesday = ts('2026-04-29T09:00:00');
    const markers = computeTemporalMarkers(
      [msg('m1', 'user', monday), msg('m2', 'assistant', wednesday)],
      { now: ts('2026-04-30T10:00:00'), locale: 'en-US' },
    );
    const sep = markers.find((m) => m.beforeMessageId === 'm2');
    expect(sep?.kind).toBe('day-separator');
    // Wednesday is 1 day before "now" (Thursday Apr 30) → "Yesterday".
    expect(sep?.text).toBe('Yesterday');
  });

  it('skips markers for malformed adjacent timestamps but still emits thread-start', () => {
    const markers: TemporalMarker[] = computeTemporalMarkers(
      [
        msg('m1', 'user', ts('2026-05-01T10:00:00')),
        msg('m2', 'assistant', ts('2026-05-01T09:00:00')), // out-of-order
      ],
      { now: ts('2026-05-01T10:00:01'), coldStartGapMs: 24 * 3_600_000 },
    );
    expect(markers.find((m) => m.beforeMessageId === 'm2')).toBeUndefined();
    expect(markers[0].kind).toBe('thread-start');
  });
});
