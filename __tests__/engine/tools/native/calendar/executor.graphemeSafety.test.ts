import { executeCalendarEvents } from '../../../../../src/engine/tools/native/calendar/executor';
import {
  buildBoundaryStraddlingText,
  expectGraphemeSafe,
  GRAPHEME_CLUSTER_FIXTURES,
} from '../../../../helpers/graphemeTestFixtures';

function makeRuntime(events: Array<{ id: string; notes?: string }>) {
  return {
    EntityTypes: { EVENT: 'event' },
    requestCalendarPermissionsAsync: async () => ({ status: 'granted' }),
    getCalendarsAsync: async () => [{ id: 'cal-1' }],
    getEventsAsync: async () => events,
    createEventAsync: async () => 'evt',
    updateEventAsync: async () => 'evt',
    getEventAsync: async () => null,
  } as any;
}

describe('executeCalendarEvents — notes preview grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the 200-char notes preview budget`, async () => {
      const notes = buildBoundaryStraddlingText(200, cluster, 100);
      const outcome = await executeCalendarEvents(
        { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-02T00:00:00.000Z' },
        makeRuntime([{ id: 'evt-1', notes }]),
      );

      const parsed = JSON.parse((outcome as any).content);
      expectGraphemeSafe(String(parsed[0].notes ?? ''));
    });
  }
});
