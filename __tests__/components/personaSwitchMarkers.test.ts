import { computePersonaSwitchMarkers } from '../../src/components/chat/personaSwitchMarkers';
import type { Message } from '../../src/types/message';
import type { PersonaSwitchEvent } from '../../src/types/conversation';

const ts = (iso: string) => new Date(iso).getTime();

const msg = (id: string, timestamp: number): Pick<Message, 'id' | 'timestamp'> => ({
  id,
  timestamp,
});

const event = (id: string, iso: string, to: string, from?: string): PersonaSwitchEvent => ({
  id,
  at: ts(iso),
  to,
  from,
});

describe('computePersonaSwitchMarkers', () => {
  it('returns no markers when there are no events', () => {
    expect(computePersonaSwitchMarkers([msg('m1', ts('2026-05-01T09:00:00'))], [])).toEqual([]);
    expect(computePersonaSwitchMarkers([msg('m1', ts('2026-05-01T09:00:00'))], undefined)).toEqual(
      [],
    );
  });

  it('returns no markers when there are no messages', () => {
    expect(computePersonaSwitchMarkers([], [event('e1', '2026-05-01T09:00:00', 'work')])).toEqual(
      [],
    );
  });

  it('anchors an event before the first message at or after its timestamp', () => {
    const markers = computePersonaSwitchMarkers(
      [
        msg('m1', ts('2026-05-01T09:00:00')),
        msg('m2', ts('2026-05-01T10:00:00')),
        msg('m3', ts('2026-05-01T11:00:00')),
      ],
      [event('e1', '2026-05-01T09:30:00', 'personal', 'work')],
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: 'e1',
      beforeMessageId: 'm2',
      fromName: 'work',
      toName: 'personal',
      meta: { fromId: 'work', toId: 'personal' },
    });
  });

  it('skips events that happen after the latest message', () => {
    const markers = computePersonaSwitchMarkers(
      [msg('m1', ts('2026-05-01T09:00:00'))],
      [event('e1', '2026-05-02T09:00:00', 'personal', 'work')],
    );
    expect(markers).toEqual([]);
  });

  it('handles multiple events in chronological order', () => {
    const markers = computePersonaSwitchMarkers(
      [
        msg('m1', ts('2026-05-01T09:00:00')),
        msg('m2', ts('2026-05-01T10:00:00')),
        msg('m3', ts('2026-05-01T11:00:00')),
      ],
      [
        event('e2', '2026-05-01T10:30:00', 'work', 'personal'),
        event('e1', '2026-05-01T09:30:00', 'personal', 'work'),
      ],
    );
    expect(markers.map((m) => m.id)).toEqual(['e1', 'e2']);
    expect(markers[0].beforeMessageId).toBe('m2');
    expect(markers[1].beforeMessageId).toBe('m3');
  });

  it('omits fromName when the event has no `from` (initial assignment)', () => {
    const markers = computePersonaSwitchMarkers(
      [msg('m1', ts('2026-05-01T09:00:00'))],
      [event('e1', '2026-05-01T08:00:00', 'work')],
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].fromName).toBeUndefined();
    expect(markers[0].toName).toBe('work');
  });

  it('uses the resolveDisplayName helper when provided', () => {
    const markers = computePersonaSwitchMarkers(
      [msg('m1', ts('2026-05-01T09:00:00'))],
      [event('e1', '2026-05-01T09:00:00', 'work', 'personal')],
      {
        resolveDisplayName: (id) =>
          id === 'work' ? 'Work Mode' : id === 'personal' ? 'Personal' : undefined,
      },
    );
    expect(markers[0].fromName).toBe('Personal');
    expect(markers[0].toName).toBe('Work Mode');
  });

  it('falls back to raw id when resolver returns undefined', () => {
    const markers = computePersonaSwitchMarkers(
      [msg('m1', ts('2026-05-01T09:00:00'))],
      [event('e1', '2026-05-01T09:00:00', 'work', 'personal')],
      { resolveDisplayName: () => undefined },
    );
    expect(markers[0].fromName).toBe('personal');
    expect(markers[0].toName).toBe('work');
  });

  it('skips events when message timestamps are missing', () => {
    const markers = computePersonaSwitchMarkers(
      [{ id: 'm1' } as Pick<Message, 'id' | 'timestamp'>],
      [event('e1', '2026-05-01T09:00:00', 'work', 'personal')],
    );
    expect(markers).toEqual([]);
  });
});
