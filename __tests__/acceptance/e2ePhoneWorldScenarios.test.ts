// The phone-world answer keys, recomputed from the seeded phone: a key that disagrees with
// the seed would grade a correct model as wrong.

import { lookupE2EScenarioBenchmarkMeta } from '../../src/acceptance/e2eAgent/e2eBenchmarkRegistry';
import { E2E_AGENT_SCENARIOS } from '../../src/acceptance/e2eAgent/scenarios';
import {
  PHONE_WORLD_CALENDAR,
  PHONE_WORLD_CONTACTS,
  PHONE_WORLD_DENTIST_ADDRESS,
  PHONE_WORLD_E2E_SCENARIOS,
  PHONE_WORLD_MAILBOX,
  phoneWorldMonday,
} from '../../src/acceptance/e2eAgent/scenariosPhoneWorld';
import {
  E2E_PHONE_WORLD_PROGRAM_MAX_TOTAL_TOKENS,
  E2E_SCENARIO_TOKEN_BUDGETS,
} from '../../src/acceptance/e2eAgent/thresholds';
import type { E2ERubric } from '../../src/acceptance/e2eAgent/types';
import { normalizePhoneNumberList } from '../../src/services/nativeActions/builders/phone';

const HOUR_MS = 60 * 60 * 1000;

function rubricsOf(id: string): ReadonlyArray<E2ERubric> {
  const scenario = PHONE_WORLD_E2E_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`no scenario ${id}`);
  return scenario.rubrics;
}

function expectedValue(id: string, path: string): string {
  const rubric = rubricsOf(id).find(
    (candidate) => candidate.kind === 'native_fixture_state' && candidate.path === path,
  );
  if (!rubric || rubric.kind !== 'native_fixture_state') throw new Error(`${id} has no ${path}`);
  return rubric.expectedValue;
}

function contactNumber(name: string): string {
  const match = PHONE_WORLD_CONTACTS.find((contact) => contact.name === name);
  if (!match) throw new Error(`no contact ${name}`);
  return match.phoneNumbers[0].number;
}

/** Every free hour on the hour between `fromIso` and `toIso`. */
function freeHours(fromIso: string, toIso: string): string[] {
  const free: string[] = [];
  for (let start = Date.parse(fromIso); start + HOUR_MS <= Date.parse(toIso); start += HOUR_MS) {
    const busy = PHONE_WORLD_CALENDAR.some(
      (event) => Date.parse(event.startDate) < start + HOUR_MS && Date.parse(event.endDate) > start,
    );
    if (!busy) free.push(new Date(start).toISOString());
  }
  return free;
}

describe('phone-world scenarios', () => {
  it('seed valid, distinct phone numbers', () => {
    const numbers = PHONE_WORLD_CONTACTS.map((contact) => contact.phoneNumbers[0].number);
    expect(normalizePhoneNumberList([...numbers, '+44 7700 900123'], 'recipients')).toEqual([
      ...numbers,
      '+447700900123',
    ]);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('send texts to the contact the turn names', () => {
    expect(expectedValue('pw-ask-which-alex', 'sms.recipients')).toBe(contactNumber('Alex Rivera'));
    expect(expectedValue('pw-no-ask-full-name', 'sms.recipients')).toBe(
      contactNumber('Alex Rivera'),
    );
    expect(expectedValue('pw-es-no-ask-full-name', 'sms.recipients')).toBe(
      contactNumber('Alex Morgan'),
    );
    expect(expectedValue('pw-ar-ask-which-karim', 'sms.recipients')).toBe(
      contactNumber('كريم حداد'),
    );
    expect(expectedValue('pw-calendar-address-to-sms', 'sms.recipients')).toBe(
      contactNumber('Sofía Díaz'),
    );
    expect(expectedValue('pw-ja-calendar-address-to-sms', 'sms.recipients')).toBe(
      contactNumber('山田 花子'),
    );
  });

  it('make the ambiguous requests truly ambiguous and the unknown person truly unknown', () => {
    const named = (fragment: string) =>
      PHONE_WORLD_CONTACTS.filter((contact) => contact.name.includes(fragment));
    expect(named('Alex')).toHaveLength(2);
    expect(named('كريم')).toHaveLength(2);
    expect(named('Omar')).toHaveLength(0);
    expect(named('花子')).toHaveLength(1);
  });

  it('book the only free hour in each window, on the day the prompt names', () => {
    const dayOf = (title: string) =>
      PHONE_WORLD_CALENDAR.find((event) => event.title === title)!.startDate.slice(0, 10);
    const thursday = dayOf('Design review');
    const wednesday = dayOf('Workshop');
    expect(freeHours(`${thursday}T13:00:00.000Z`, `${thursday}T18:00:00.000Z`)).toEqual([
      expectedValue('pw-book-free-hour', 'calendar.lastCreatedStartDate'),
    ]);
    expect(freeHours(`${wednesday}T13:00:00.000Z`, `${wednesday}T18:00:00.000Z`)).toEqual([
      expectedValue('pw-de-book-free-hour', 'calendar.lastCreatedStartDate'),
    ]);
    const prompt = (id: string) =>
      PHONE_WORLD_E2E_SCENARIOS.find((scenario) => scenario.id === id)!.prompt;
    const day = (iso: string) => String(new Date(iso).getUTCDate());
    expect(prompt('pw-book-free-hour')).toContain(`Thursday, ${day(thursday)} `);
    expect(prompt('pw-de-book-free-hour')).toContain(`Mittwoch, ${day(wednesday)}.`);
  });

  it('set the week on the first Monday at least four days ahead', () => {
    const cases: Array<[string, string]> = [
      ['2026-10-15T09:00:00Z', '2026-10-19'], // Thursday: four days
      ['2026-10-16T23:59:00Z', '2026-10-26'], // Friday: three days is too soon
      ['2026-10-18T00:00:00Z', '2026-10-26'], // Sunday
      ['2026-10-19T08:00:00Z', '2026-10-26'], // Monday: a week
      ['2026-12-29T12:00:00Z', '2027-01-04'], // across the year
    ];
    for (const [now, monday] of cases) {
      expect(phoneWorldMonday(new Date(now)).toISOString().slice(0, 10)).toBe(monday);
    }
  });

  it('move the dentist to the same time on the day the answer names', () => {
    const dentist = PHONE_WORLD_CALENDAR.find((event) => event.title === 'Dentist');
    expect(dentist?.location).toContain(PHONE_WORLD_DENTIST_ADDRESS);
    expect(expectedValue('pw-ask-when-to-move', 'calendar.lastUpdatedEventId')).toBe(dentist?.id);
    const moved = expectedValue('pw-ask-when-to-move', 'calendar.lastUpdatedStartDate');
    const answer = PHONE_WORLD_E2E_SCENARIOS.find((s) => s.id === 'pw-ask-when-to-move')!
      .userTurns![1].content;
    expect(answer).toContain(`Thursday, ${new Date(moved).getUTCDate()} `);
    expect(new Date(moved).getUTCDay()).toBe(4);
    expect(moved.slice(11)).toBe(dentist?.startDate.slice(11));
    expect(Date.parse(dentist!.startDate)).toBeGreaterThan(Date.now());
  });

  it('reply to the latest of the landlord emails, and take the check-in from the hotel email', () => {
    const fromLandlord = PHONE_WORLD_MAILBOX.filter((mail) => mail.from.name === 'Rui Costa');
    expect(fromLandlord).toHaveLength(2);
    const latest = [...fromLandlord].sort(
      (left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt),
    )[0];
    expect(expectedValue('pw-mail-reply-latest', 'mail.lastReplyTo')).toBe(latest.id);
    expect(expectedValue('pw-es-mail-reply-latest', 'mail.lastReplyTo')).toBe(latest.id);

    const checkIn = expectedValue('pw-mail-checkin-to-calendar', 'calendar.lastCreatedStartDate');
    const hotelMail = PHONE_WORLD_MAILBOX.filter((mail) => mail.body.includes('Check-in'));
    expect(hotelMail).toHaveLength(1);
    expect(hotelMail[0].body).toContain(`Check-in: ${checkIn.slice(0, 10)} from 15:00`);
    expect(checkIn.slice(11, 16)).toBe('15:00');

    const startOfToday = new Date().setUTCHours(0, 0, 0, 0);
    for (const mail of PHONE_WORLD_MAILBOX) {
      expect(Date.parse(mail.receivedAt)).toBeLessThan(startOfToday);
    }
  });

  it('never tell the model which tool to use', () => {
    for (const scenario of PHONE_WORLD_E2E_SCENARIOS) {
      const turns = scenario.userTurns?.map((turn) => turn.content) ?? [scenario.prompt];
      for (const turn of turns) expect(turn).not.toMatch(/[a-z]+_[a-z]+|\btool\b/u);
    }
  });

  it('run on a seeded phone, within budgets, apart from the main suite', () => {
    const mainIds = new Set(E2E_AGENT_SCENARIOS.map((scenario) => scenario.id));
    let budgetSum = 0;
    for (const scenario of PHONE_WORLD_E2E_SCENARIOS) {
      expect(mainIds.has(scenario.id)).toBe(false);
      expect(scenario.initialNativeFixture?.contacts).toBe(PHONE_WORLD_CONTACTS);
      expect(scenario.rubrics).toEqual(
        expect.arrayContaining([
          { kind: 'graph_terminal_success' },
          { kind: 'token_budget', maxTotalTokens: E2E_SCENARIO_TOKEN_BUDGETS[scenario.id] },
        ]),
      );
      expect(E2E_SCENARIO_TOKEN_BUDGETS[scenario.id]).toBeGreaterThan(0);
      budgetSum += E2E_SCENARIO_TOKEN_BUDGETS[scenario.id];
      expect(lookupE2EScenarioBenchmarkMeta(scenario.id).benchmarkFamilies).toEqual([
        'mobileworld-interaction-adapted',
      ]);
    }
    expect(new Set(PHONE_WORLD_E2E_SCENARIOS.map((scenario) => scenario.id)).size).toBe(
      PHONE_WORLD_E2E_SCENARIOS.length,
    );
    expect(budgetSum).toBe(E2E_PHONE_WORLD_PROGRAM_MAX_TOTAL_TOKENS);
  });
});
