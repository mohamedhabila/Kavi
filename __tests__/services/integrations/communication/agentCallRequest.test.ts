import {
  blandLanguageFor,
  callDisclosure,
  clampCallMinutes,
  planAgentCall,
} from '../../../../src/services/integrations/communication/agentCallRequest';

const BOOKING = {
  phoneNumber: '+33 1 42 68 53 00',
  callerName: 'Sam',
  language: 'fr-FR',
  opening: 'Je voudrais réserver une table pour deux ce soir à 20 h.',
  goal: 'Book a table for two tonight at 8 pm; 7:30 to 9 pm is fine.',
  mayShare: 'Booking name Sam Lee; callback +33 6 12 34 56 78',
};

describe('planAgentCall', () => {
  it('builds the Bland call: E.164 number, disclosure then opening, recorded, bounded', () => {
    const plan = planAgentCall(BOOKING);

    expect(plan).toMatchObject({
      e164: '+33142685300',
      displayNumber: '+33 1 42 68 53 00',
      minutes: 5,
      blandLanguage: 'fr',
    });
    expect(plan.body).toMatchObject({
      phone_number: '+33142685300',
      first_sentence:
        "Bonjour, ici Kavi, un assistant d'intelligence artificielle qui appelle de la part de Sam. Cet appel est enregistré. Je voudrais réserver une table pour deux ce soir à 20 h.",
      language: 'fr',
      wait_for_greeting: true,
      record: true,
      max_duration: 5,
      voicemail: { action: 'hangup' },
      metadata: { source: 'kavi' },
    });
    expect(plan.body.timezone).toEqual(expect.any(String));
    expect(plan.body.summary_prompt).toEqual(expect.stringContaining('Sam'));
  });

  it("frames the model's brief with the rules the agent must keep", () => {
    const task = String(planAgentCall(BOOKING).body.task);

    expect(task).toContain('calling for Sam (the client)');
    expect(task).toContain('already said you are an AI assistant calling for the client');
    expect(task).toContain('confirm you are an AI');
    expect(task).toContain('Never pay, buy, sign up');
    expect(task).toContain('not to call again');
    expect(task).toContain(`Goal: ${BOOKING.goal}`);
    expect(task).toContain(`You may share: ${BOOKING.mayShare}`);
    expect(task.length).toBeLessThan(2_000);
  });

  it('keeps the whole task under Bland’s 2,000 characters at the longest inputs', () => {
    const task = String(
      planAgentCall({
        ...BOOKING,
        callerName: 'N'.repeat(40),
        language: 'it',
        opening: 'o'.repeat(250),
        goal: 'g'.repeat(550),
        mayShare: 's'.repeat(250),
      }).body.task,
    );

    expect(task.length).toBeLessThanOrEqual(2_000);
  });

  it('shares only the first name when nothing else was approved', () => {
    const { mayShare: _mayShare, ...withoutShares } = BOOKING;

    expect(String(planAgentCall(withoutShares).body.task)).toContain(
      "You may share: only the client's first name",
    );
  });

  it('asks the agent to introduce itself when Kavi has no written disclosure for the language', () => {
    const plan = planAgentCall({ ...BOOKING, language: 'it', opening: 'Vorrei prenotare.' });

    expect(plan.body).not.toHaveProperty('first_sentence');
    expect(plan.body.language).toBe('it');
    expect(String(plan.body.task)).toContain(
      'First say you are Kavi, an AI assistant calling for Sam, and that the call is recorded; then say: "Vorrei prenotare."',
    );
  });

  it('leaves a voicemail only when given one, and caps the length at 10 minutes', () => {
    const plan = planAgentCall({ ...BOOKING, maxMinutes: 45, voicemailMessage: 'Rappelez Sam.' });

    expect(plan.body).toMatchObject({
      max_duration: 10,
      voicemail: { action: 'leave_message', message: 'Rappelez Sam.' },
    });
    expect(clampCallMinutes(0)).toBe(1);
    expect(clampCallMinutes(2.6)).toBe(3);
    expect(clampCallMinutes('x')).toBe(5);
    expect(clampCallMinutes(undefined)).toBe(5);
  });

  it('reads a local number with the default country', () => {
    expect(
      planAgentCall({ ...BOOKING, phoneNumber: '01 42 68 53 00', defaultCountry: 'FR' }).e164,
    ).toBe('+33142685300');
  });

  it('never calls emergency or service numbers itself', () => {
    for (const phoneNumber of ['911', '112', '*#06#', '3-1-1']) {
      expect(() => planAgentCall({ ...BOOKING, phoneNumber })).toThrow(/use phone_call/u);
    }
  });

  it('refuses arguments it cannot call with, naming what to fix', () => {
    expect(() => planAgentCall({ ...BOOKING, phoneNumber: '12' + 'x' })).toThrow(
      /valid international/u,
    );
    expect(() => planAgentCall({ ...BOOKING, language: 'French' })).toThrow(/BCP-47/u);
    expect(() => planAgentCall({ ...BOOKING, callerName: '  ' })).toThrow(
      'callerName is required.',
    );
    expect(() => planAgentCall({ ...BOOKING, goal: 7 })).toThrow('goal must be text.');
    expect(() => planAgentCall({ ...BOOKING, opening: 'o'.repeat(251) })).toThrow(
      /longer than 250 characters/u,
    );
  });
});

describe('call language', () => {
  it("asks Bland for the call's language, its base language, or detection", () => {
    expect(blandLanguageFor('es-419')).toBe('es-419');
    expect(blandLanguageFor('en_gb')).toBe('en-GB');
    expect(blandLanguageFor('fr-CA')).toBe('fr-CA');
    expect(blandLanguageFor('de-AT')).toBe('de');
    expect(blandLanguageFor('zh-TW')).toBe('zh-TW');
    expect(blandLanguageFor('ar-EG')).toBe('auto');
    expect(blandLanguageFor('sw')).toBe('auto');
  });

  it('discloses in each of Kavi’s languages, script and region aware', () => {
    expect(callDisclosure('ja-JP', 'Sam')).toBe(
      'こんにちは。Samの代理でお電話しております、AIアシスタントのKaviです。この通話は録音されています。',
    );
    expect(callDisclosure('zh-HK', 'Sam')).toContain('人工智慧');
    expect(callDisclosure('zh-Hant-TW', 'Sam')).toContain('人工智慧');
    expect(callDisclosure('zh', 'Sam')).toContain('人工智能');
    expect(callDisclosure('pt-PT', 'Sam')).toContain('está a ser gravada');
    expect(callDisclosure('pt-BR', 'Sam')).toContain('está sendo gravada');
    for (const tag of ['en', 'es', 'fr', 'de', 'ar']) {
      expect(callDisclosure(tag, 'Sam')).toContain('Sam');
    }
    expect(callDisclosure('it', 'Sam')).toBeUndefined();
  });
});
