// ---------------------------------------------------------------------------
// Kavi — Phone-world scenarios (MobileWorld user-interaction style, offline)
// ---------------------------------------------------------------------------
// Everyday requests on a phone with a real address book and calendar: pick the right
// contact, ask only when the request leaves a choice open, carry what one app holds into
// another, in five languages. Prompts say what the person wants, never how to do it, and
// every task is graded on the phone's final state. Asking is graded by its effect: nothing
// was sent or changed before the answer, and the right thing was after it, so a lucky guess
// on the first turn fails. The phone's week is set relative to the run, so the tasks read
// as they would to the person. The slice runs on its own, so an unsaturated score does not
// gate the main suite.

import type { E2ECalendarEvent } from './e2eNativeCalendarFixtures';
import type { E2EFixtureContact } from './e2eNativeMessagingFixtures';
import { E2E_SCENARIO_TOKEN_BUDGETS } from './thresholds';
import type { E2ERubric, E2EScenario } from './types';

function contact(id: string, name: string, number: string): E2EFixtureContact {
  return { id, name, phoneNumbers: [{ label: 'mobile', number }] };
}

function event(
  id: string,
  title: string,
  startDate: string,
  endDate: string,
  location?: string,
): E2ECalendarEvent {
  return {
    id,
    calendarId: 'e2e-cal-1',
    title,
    startDate,
    endDate,
    ...(location ? { location } : {}),
    allDay: false,
  };
}

/** Two people share a first name twice over, in two scripts; the rest are unique. */
export const PHONE_WORLD_CONTACTS: ReadonlyArray<E2EFixtureContact> = [
  contact('pw-alex-morgan', 'Alex Morgan', '+15550102001'),
  contact('pw-alex-rivera', 'Alex Rivera', '+15550102002'),
  contact('pw-sofia-diaz', 'Sofía Díaz', '+351912345003'),
  contact('pw-hanako-yamada', '山田 花子', '+819012345004'),
  contact('pw-karim-haddad', 'كريم حداد', '+971501234005'),
  contact('pw-karim-nasser', 'كريم ناصر', '+971501234006'),
];

export const PHONE_WORLD_DENTIST_ADDRESS = 'Rua Augusta 274';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The slice's week starts on the first Monday at least four days after the run: an
 * undated "my dentist appointment" means an upcoming one, and every weekday the prompts
 * name is still ahead. Times are UTC; the slice runs with TZ=UTC.
 */
export function phoneWorldMonday(now: Date): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let daysAhead = (8 - new Date(today).getUTCDay()) % 7 || 7;
  if (daysAhead < 4) daysAhead += 7;
  return new Date(today + daysAhead * DAY_MS);
}

const MONDAY = phoneWorldMonday(new Date());
const at = (daysAfterMonday: number, hour: number): string =>
  new Date(MONDAY.getTime() + daysAfterMonday * DAY_MS + hour * 60 * 60 * 1000).toISOString();
const TUESDAY = 1;
const WEDNESDAY = 2;
const THURSDAY = 3;

/** A day as the person would say it in `locale`: "Thursday 22 October 2026". */
function spokenDay(locale: string, daysAfterMonday: number): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(MONDAY.getTime() + daysAfterMonday * DAY_MS));
}

export const PHONE_WORLD_CALENDAR: ReadonlyArray<E2ECalendarEvent> = [
  event(
    'pw-dentist',
    'Dentist',
    at(TUESDAY, 10),
    at(TUESDAY, 11),
    `${PHONE_WORLD_DENTIST_ADDRESS}, Lisboa`,
  ),
  event('pw-lunch-ana', 'Lunch with Ana', at(WEDNESDAY, 13), at(WEDNESDAY, 14)),
  event('pw-workshop', 'Workshop', at(WEDNESDAY, 15), at(WEDNESDAY, 18)),
  event('pw-design-review', 'Design review', at(THURSDAY, 13), at(THURSDAY, 16)),
  event('pw-one-on-one', '1:1 with Sam', at(THURSDAY, 17), at(THURSDAY, 18)),
];

const smsTo = (number: string): E2ERubric => ({
  kind: 'native_fixture_state',
  path: 'sms.recipients',
  expectedValue: number,
});

const smsMentions = (text: string): E2ERubric => ({
  kind: 'native_fixture_contains',
  path: 'sms.message',
  contains: text,
});

const firstTurnCalls = (toolName: string, expectedCount: number): E2ERubric => ({
  kind: 'turn_native_invocation_count',
  turnIndex: 0,
  toolName,
  expectedCount,
});

const createdOneEventAt = (startDate: string): E2ERubric[] => [
  { kind: 'native_fixture_state', path: 'calendar.createdEventCount', expectedValue: '1' },
  { kind: 'native_fixture_state', path: 'calendar.lastCreatedStartDate', expectedValue: startDate },
  {
    kind: 'native_fixture_state',
    path: 'calendar.lastCreatedDurationMinutes',
    expectedValue: '60',
  },
];

function phoneWorldScenario(spec: {
  id: string;
  turns: readonly [string, ...string[]];
  rubrics: ReadonlyArray<E2ERubric>;
}): E2EScenario {
  return {
    id: spec.id,
    conversationId: `e2e-${spec.id}`,
    contentClass: 'synthetic_public',
    prompt: spec.turns[0],
    ...(spec.turns.length > 1 ? { userTurns: spec.turns.map((content) => ({ content })) } : {}),
    initialNativeFixture: { contacts: PHONE_WORLD_CONTACTS, calendarEvents: PHONE_WORLD_CALENDAR },
    rubrics: [
      ...spec.rubrics,
      { kind: 'graph_terminal_success' },
      { kind: 'token_budget', maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS[spec.id] },
    ],
  };
}

export const PHONE_WORLD_E2E_SCENARIOS: ReadonlyArray<E2EScenario> = [
  phoneWorldScenario({
    id: 'pw-ask-which-alex',
    turns: ["Text Alex that I'm running 10 minutes late.", 'Alex Rivera.'],
    rubrics: [firstTurnCalls('sms_compose', 0), smsTo('+15550102002')],
  }),
  phoneWorldScenario({
    id: 'pw-no-ask-full-name',
    turns: ["Text Alex Rivera that I'm running 10 minutes late."],
    rubrics: [firstTurnCalls('sms_compose', 1), smsTo('+15550102002')],
  }),
  phoneWorldScenario({
    id: 'pw-calendar-address-to-sms',
    turns: ['Send Sofía the address of my dentist appointment.'],
    rubrics: [smsTo('+351912345003'), smsMentions(PHONE_WORLD_DENTIST_ADDRESS)],
  }),
  phoneWorldScenario({
    id: 'pw-book-free-hour',
    turns: [
      `Find a free hour on ${spokenDay('en-GB', THURSDAY)}, between 13:00 and 18:00 for a budget sync and put it in my calendar.`,
    ],
    rubrics: createdOneEventAt(at(THURSDAY, 16)),
  }),
  phoneWorldScenario({
    id: 'pw-ask-when-to-move',
    turns: ['Move my dentist appointment.', `To ${spokenDay('en-GB', THURSDAY)}, same time.`],
    rubrics: [
      firstTurnCalls('calendar_update_event', 0),
      { kind: 'native_fixture_state', path: 'calendar.updatedEventCount', expectedValue: '1' },
      {
        kind: 'native_fixture_state',
        path: 'calendar.lastUpdatedEventId',
        expectedValue: 'pw-dentist',
      },
      {
        kind: 'native_fixture_state',
        path: 'calendar.lastUpdatedStartDate',
        expectedValue: at(THURSDAY, 10),
      },
      { kind: 'native_fixture_state', path: 'calendar.createdEventCount', expectedValue: '0' },
    ],
  }),
  phoneWorldScenario({
    id: 'pw-ask-for-unknown-number',
    turns: ['Text my brother Omar happy birthday.', 'His number is +44 7700 900123.'],
    rubrics: [firstTurnCalls('sms_compose', 0), smsTo('+447700900123')],
  }),
  phoneWorldScenario({
    id: 'pw-ar-ask-which-karim',
    turns: ['أرسل لكريم رسالة أنني سأتأخر عشر دقائق.', 'كريم حداد.'],
    rubrics: [firstTurnCalls('sms_compose', 0), smsTo('+971501234005')],
  }),
  phoneWorldScenario({
    id: 'pw-ja-calendar-address-to-sms',
    turns: ['歯医者の予約の住所を花子さんに送って。'],
    rubrics: [smsTo('+819012345004'), smsMentions(PHONE_WORLD_DENTIST_ADDRESS)],
  }),
  phoneWorldScenario({
    id: 'pw-de-book-free-hour',
    turns: [
      `Finde am ${spokenDay('de-DE', WEDNESDAY)}, zwischen 13 und 18 Uhr eine freie Stunde für ein Budget-Sync und trag sie in meinen Kalender ein.`,
    ],
    rubrics: createdOneEventAt(at(WEDNESDAY, 14)),
  }),
  phoneWorldScenario({
    id: 'pw-es-no-ask-full-name',
    turns: ['Mándale a Alex Morgan un mensaje diciendo que llego en cinco minutos.'],
    rubrics: [firstTurnCalls('sms_compose', 1), smsTo('+15550102001')],
  }),
];
