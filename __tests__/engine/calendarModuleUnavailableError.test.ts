import {
  executeCalendarCreate,
  executeCalendarEvents,
  executeCalendarList,
  executeCalendarUpdate,
} from '../../src/engine/tools/native/calendar/executor';
import { parseFailedToolOutcome } from '../helpers/toolRuntimeOutcome';

/**
 * Regression coverage for a real device failure: `calendar_create_event` returned
 * `{"status":"unavailable","error":"Calendar module not available"}` with no
 * indication of why, because `loadCalendarModule()` swallowed the underlying
 * `import('expo-calendar')` failure in a bare `catch { return null }`. That made
 * a genuine device-side problem (permissions never requested, no OS prompt shown)
 * indistinguishable from a transient bundler hiccup, and left nothing in the
 * logs to diagnose it with.
 *
 * None of these tests provide an explicit `runtime`, so every call is forced
 * through the real `import('expo-calendar')` path. The test Node/Jest
 * environment cannot execute a genuine dynamic `import()` (no
 * `--experimental-vm-modules`), so it reliably rejects — giving us a real,
 * non-mocked failure to assert the executor now surfaces instead of swallows.
 */
describe('calendar module load failure', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('includes the underlying import error in the calendar_list_events failure', async () => {
    const outcome = parseFailedToolOutcome(await executeCalendarList());

    expect(outcome.status).toBe('unavailable');
    expect(outcome.error).toMatch(/^Calendar module not available: .+/);
    expect(outcome.error).not.toBe('Calendar module not available');
  });

  it('includes the underlying import error in the calendar_events failure', async () => {
    const outcome = parseFailedToolOutcome(
      await executeCalendarEvents({ startDate: '2026-01-01', endDate: '2026-01-31' }),
    );

    expect(outcome.status).toBe('unavailable');
    expect(outcome.error).toMatch(/^Calendar module not available: .+/);
  });

  it('includes the underlying import error in the calendar_create_event failure', async () => {
    const outcome = parseFailedToolOutcome(
      await executeCalendarCreate({
        title: 'Lunch with Sara',
        startDate: '2026-01-02T13:00:00.000Z',
        endDate: '2026-01-02T14:00:00.000Z',
      }),
    );

    expect(outcome.status).toBe('unavailable');
    expect(outcome.error).toMatch(/^Calendar module not available: .+/);
  });

  it('includes the underlying import error in the calendar_update_event failure', async () => {
    const outcome = parseFailedToolOutcome(
      await executeCalendarUpdate({ id: 'event-1', title: 'Updated' }),
    );

    expect(outcome.status).toBe('unavailable');
    expect(outcome.error).toMatch(/^Calendar module not available: .+/);
  });

  it('logs the underlying import failure instead of swallowing it', async () => {
    await executeCalendarList();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CalendarExecutor] Failed to load the expo-calendar native module'),
      expect.anything(),
    );
  });
});
