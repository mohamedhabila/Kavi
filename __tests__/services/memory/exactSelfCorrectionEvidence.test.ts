import { deriveExactSelfCorrectionEvidence } from '../../../src/services/memory/exactSelfClaimEvidence';

function correction(
  userMessageText: string,
  overrides: Partial<{ predicate: string; value: string; currentValue: string }> = {},
) {
  return deriveExactSelfCorrectionEvidence({
    userMessageText,
    predicate: overrides.predicate ?? 'usual_design_review_duration',
    value: overrides.value ?? '45 minutes',
    currentValue: overrides.currentValue ?? '30 minutes',
  });
}

describe('deriveExactSelfCorrectionEvidence', () => {
  it.each([
    'Actually, make that 45 minutes from now on, not 30 minutes.',
    'Actually, make my usual design-review length 45 minutes, not 30 minutes.',
    'Update my usual design-review duration to 45 minutes going forward, not 30.',
    'Correction: my usual design-review duration is 45 minutes, not 30 minutes.',
    'Please remember my usual design-review duration is 45 minutes going forward, not 30.',
    'From now on, change it to 45 minutes, not 30 minutes.',
    'Going forward, make that 45 minutes, not 30 minutes.',
    'Actually, please make that 45 minutes from now on, not 30 minutes.',
    'Please actually make that 45 minutes from now on, not 30 minutes.',
    'From now on, please change it to 45 minutes, not 30 minutes.',
    'Going forward, please make that 45 minutes, not 30 minutes.',
    'Please, from now on, change it to 45 minutes, not 30 minutes.',
    'Actually, make my usual design-review duration 45 minutes from now on, not 30 minutes anymore.',
  ])('accepts one durable, target-bound current correction: %s', (message) => {
    expect(correction(message)).toMatchObject({
      subject: 'user',
      predicate: 'usual_design_review_duration',
      value: '45 minutes',
      evidenceQuote: message.slice(0, -1),
    });
  });

  it.each([
    {
      message:
        'Voortaan, zet mijn gebruikelijke ontwerpreview duur op 45 minuten, niet 30 minuten.',
      predicate: 'gebruikelijke_ontwerpreview_duur',
      value: '45 minuten',
      currentValue: '30 minuten',
    },
    {
      message:
        'Désormais, mets ma durée habituelle de revue de conception à 45 minutes, pas 30 minutes.',
      predicate: 'durée_habituelle_revue_conception',
      value: '45 minutes',
      currentValue: '30 minutes',
    },
  ])('accepts a target-bound durable correction beyond English: $message', (fixture) => {
    expect(correction(fixture.message, fixture)).toMatchObject({
      subject: 'user',
      predicate: fixture.predicate,
      value: fixture.value,
    });
  });

  it.each([
    'Actually, make that 45 minutes, not my usual 30 minutes, just for today.',
    'Actually, make that 45 minutes from now on, not 30 minutes, if the client asks.',
    'Actually, make that 45 minutes from now on, not 30 minutes, unless the client asks.',
    'Actually, make that 45 minutes, not 30 minutes, for this meeting.',
    "Actually, make that 45 minutes from now on, not 30 minutes for tomorrow's review.",
    'Actually, make that 45 minutes from now on, not 30 minutes for the next meeting only.',
    'Actually, make that 45 minutes from now on, not 30 minutes this week.',
    'Actually, make that 45 minutes from now on, not 30 minutes when the client asks.',
    'Actually, make that 45 minutes from now on, not 30 minutes provided the client agrees.',
    'Actually, make that 45 minutes from now on, not 30 minutes in case the client asks.',
    'Actually, make that 45 minutes from now on, not 30 minutes. Just for today.',
    'Actually, make that 45 minutes from now on, not 30 minutes; only for this meeting.',
    'Set my duration for lunch to 45 minutes going forward, not 30 minutes.',
    'Set my default duration for workouts to 45 minutes, not 30 minutes.',
    'Set my default review duration to 45 minutes going forward, not 30 minutes.',
    'Set my design-review duration for lunch to 45 minutes going forward, not 30 minutes.',
    'Actually, make sure that my usual label is red from now on, not blue.',
    'Actually, make that 45 minutes from now on, not 30 attendees.',
    'Actually, make that about 45 minutes from now on, not 30 minutes.',
    'Actually, make that roughly 45 minutes from now on, not 30 minutes.',
    'Actually, make that approximately 45 minutes from now on, not 30 minutes.',
    'Actually, make that likely 45 minutes from now on, not 30 minutes.',
    'Actually, make that apparently 45 minutes from now on, not 30 minutes.',
    'Actually, make that somewhere between 40 and 45 minutes from now on, not 30 minutes.',
    'Actually, make that for lunch 45 minutes from now on, not 30 minutes.',
  ])('rejects an unsafe or unrelated destructive target: %s', (message) => {
    const overrides = message.includes('label')
      ? { predicate: 'favorite_color', value: 'red', currentValue: 'blue' }
      : undefined;
    expect(correction(message, overrides)).toBeNull();
  });

  it('accepts one distinguishing predicate unit without weakening generic target binding', () => {
    expect(
      correction('Update my timezone to Europe/Amsterdam going forward, not UTC.', {
        predicate: 'timezone',
        value: 'Europe/Amsterdam',
        currentValue: 'UTC',
      }),
    ).toMatchObject({ predicate: 'timezone', value: 'Europe/Amsterdam' });
  });

  it.each([
    ['GitHub username', 'github_username', 'mohab', 'oldhandle'],
    ['HTTP2 preference', 'http2_preference', 'enabled', 'disabled'],
    ['2FA method', '2fa_method', 'passkey', 'SMS'],
    ['GPT-5 preference', 'gpt_5_preference', 'high reasoning', 'balanced'],
  ])(
    'preserves code-owned property descriptors and technical identifiers: %s',
    (target, predicate, value, currentValue) => {
      expect(
        correction(`Update my ${target} to ${value} going forward, not ${currentValue}.`, {
          predicate,
          value,
          currentValue,
        }),
      ).toMatchObject({ predicate, value });
    },
  );

  it.each(['FUZZY', 'DraftReview', 'maybeCase', 'TRIAL'])(
    'does not treat an unsafe correction qualifier as semantic property authorization: %s',
    (descriptor) => {
      expect(
        correction(`Update my ${descriptor} color to red going forward, not blue.`, {
          predicate: `${descriptor.toLocaleLowerCase()}_color`,
          value: 'red',
          currentValue: 'blue',
        }),
      ).toBeNull();
    },
  );

  it.each([
    '45 minutes or 60 minutes',
    '45 minutes for Friday only',
    '45 minutes for Friday',
    'maybe 45 minutes',
    '45 minutes, okay',
    'about 45 minutes',
    '45 minutes, I guess',
    'between 30 and 45 minutes',
  ])('rejects a correction whose proposed value absorbs unsafe language: %s', (value) => {
    expect(
      correction(`Update my usual design-review duration to ${value}, not 30 minutes.`, {
        value,
      }),
    ).toBeNull();
  });

  it.each([
    'Update my favorite movie to About Time going forward, not Dune.',
    'Update my favorite movie to "About Time" going forward, not Dune.',
  ])('accepts a literal-title correction without weakening ordinary values: %s', (message) => {
    expect(
      correction(message, {
        predicate: 'favorite_movie',
        value: 'About Time',
        currentValue: 'Dune',
      }),
    ).toMatchObject({ predicate: 'favorite_movie', value: 'About Time' });
  });

  it.each([
    ['model_timeout', 'Update my timeout to Maybe 45 Minutes going forward, not 30 minutes.'],
    ['timeout_title', 'Update my timeout to Maybe 45 Minutes going forward, not 30 minutes.'],
    ['timeout_name', 'Update my timeout to Maybe 45 Minutes going forward, not 30 minutes.'],
    ['timeout_movie', 'Update my timeout to "maybe 45 minutes" going forward, not 30 minutes.'],
    ['project_status', 'Update my project to Maybe Complete going forward, not Incomplete.'],
  ])('does not grant literal authority from a provider predicate: %s', (predicate, message) => {
    const value = message.includes('project') ? 'Maybe Complete' : 'Maybe 45 Minutes';
    expect(
      correction(message, {
        predicate,
        value: message.includes('"') ? 'maybe 45 minutes' : value,
        currentValue: message.includes('project') ? 'Incomplete' : '30 minutes',
      }),
    ).toBeNull();
  });

  it.each([
    [
      'Update my duration whilst presenting to 45 minutes going forward, not 30 minutes.',
      'duration_whilst_presenting',
    ],
    [
      'Update my duration effective 3pm to 45 minutes going forward, not 30 minutes.',
      'duration_effective_3pm',
    ],
  ])(
    'does not let provider units authorize a qualified correction target: %s',
    (message, predicate) => {
      expect(correction(message, { predicate })).toBeNull();
    },
  );

  it.each([
    {
      message: 'Voortaan, zet mijn duur op 45 minuten, niet 30 minuten.',
      predicate: 'gebruikelijke_ontwerpreview_duur',
      value: '45 minuten',
      currentValue: '30 minuten',
    },
    {
      message: 'Désormais, mets ma durée à 45 minutes, pas 30 minutes.',
      predicate: 'durée_revue_conception',
      value: '45 minutes',
      currentValue: '30 minutes',
    },
  ])('rejects a lone generic multilingual relation: $message', (fixture) => {
    expect(correction(fixture.message, fixture)).toBeNull();
  });

  it.each([
    {
      message: 'Voortaan, zet mijn gebruikelijke duur op 45 minuten, niet 30 minuten.',
      predicate: 'gebruikelijke_ontwerpreview_duur',
      value: '45 minuten',
      currentValue: '30 minuten',
    },
    {
      message:
        'Voortaan, zet mijn gebruikelijke ontwerpreview duur op 45 minuten voor deze week, niet 30 minuten.',
      predicate: 'gebruikelijke_ontwerpreview_duur',
      value: '45 minuten',
      currentValue: '30 minuten',
    },
    {
      message:
        'Désormais, mets ma durée habituelle de revue de conception à 45 minutes pour cette semaine, pas 30 minutes.',
      predicate: 'durée_revue_conception',
      value: '45 minutes',
      currentValue: '30 minutes',
    },
  ])('rejects a generic or qualified multilingual target: $message', (fixture) => {
    expect(correction(fixture.message, fixture)).toBeNull();
  });

  it('rejects unitless numeric anchors that cross semantic units', () => {
    expect(
      correction('Actually, make that 45 dollars from now on, not 30.', {
        value: '45 dollars',
      }),
    ).toBeNull();
  });

  it('conservatively rejects old-first grammar until it can bind both values safely', () => {
    expect(
      correction(
        'Actually, not 30 minutes; make my usual design-review duration 45 minutes from now on.',
      ),
    ).toBeNull();
  });

  it.each([
    'Update for lunch my timeout to 45 minutes going forward, not 30 minutes.',
    'Update during the demo my timeout to 45 minutes going forward, not 30 minutes.',
    'Update apparently my timeout to 45 minutes going forward, not 30 minutes.',
    'Update provisionally my timeout to 45 minutes going forward, not 30 minutes.',
    'Update "for lunch" my timeout to 45 minutes going forward, not 30 minutes.',
    'Actually, during lunch update my timeout to 45 minutes going forward, not 30 minutes.',
    'Actually, allegedly update my timeout to 45 minutes going forward, not 30 minutes.',
    'Actually, "Alex said", update my timeout to 45 minutes going forward, not 30 minutes.',
  ])('rejects unaudited material anywhere before a direct correction target: %s', (message) => {
    expect(
      correction(message, {
        predicate: 'timeout',
        value: '45 minutes',
        currentValue: '30 minutes',
      }),
    ).toBeNull();
  });

  it.each([
    'Actually, make that to as exactly 45 minutes from now on, not 30 minutes.',
    'Actually, make that exactly to exactly 45 minutes from now on, not 30 minutes.',
    'Actually, make that at to as 45 minutes from now on, not 30 minutes.',
    'Actually, make that to to 45 minutes from now on, not 30 minutes.',
    'Actually, make that @ 45 minutes from now on, not 30 minutes.',
    'Actually, make that / 45 minutes from now on, not 30 minutes.',
    'Actually, make that — 45 minutes from now on, not 30 minutes.',
  ])('rejects a noncanonical anaphoric value bridge: %s', (message) => {
    expect(correction(message)).toBeNull();
  });

  it.each(['~', '≈', '∼', '<', '≤', '>', '≥', '≠', '±'])(
    'rejects a raw non-exact replacement operator omitted by the provider: %s',
    (operator) => {
      expect(
        correction(`Actually, make that ${operator}45 minutes from now on, not 30 minutes.`),
      ).toBeNull();
      expect(
        correction(`Update my timeout to ${operator}45 minutes going forward, not 30 minutes.`, {
          predicate: 'timeout',
        }),
      ).toBeNull();
    },
  );

  it.each(['45+', '45±5', '40-45', '40–60', '45 < 60'])(
    'rejects a non-exact replacement returned whole by the provider: %s',
    (value) => {
      expect(
        correction(`Update my timeout to ${value} minutes going forward, not 30 minutes.`, {
          predicate: 'timeout',
          value: `${value} minutes`,
        }),
      ).toBeNull();
    },
  );

  it.each([
    'Actually, make that 45 minutes-ish from now on, not 30 minutes.',
    'Actually, make that 45 minutes @ from now on, not 30 minutes.',
    'Actually, make that 45 minutes ~ from now on, not 30 minutes.',
    'Actually, make that 45 minutes from now on, not ~30 minutes.',
    'Actually, make that 45 minutes from now on, not >30 minutes.',
    'Actually, make that 45 minutes from now on, not ≈30 minutes.',
    'Actually, make that 45 minutes from now on, not 30 minutes @.',
    'Actually, make that 45 minutes from now on, not 30 minutes ~.',
  ])('rejects raw non-exact content elsewhere in the correction envelope: %s', (message) => {
    expect(correction(message)).toBeNull();
  });

  it.each([
    'Update my name to Maybe Baby going forward, not Mo.',
    'Update my title to Maybe Later going forward, not Engineer.',
  ])('accepts an unquoted explicit-literal correction: %s', (message) => {
    const isName = message.includes('name');
    expect(
      correction(message, {
        predicate: isName ? 'preferred_name' : 'preferred_title',
        value: isName ? 'Maybe Baby' : 'Maybe Later',
        currentValue: isName ? 'Mo' : 'Engineer',
      }),
    ).toMatchObject({ value: isName ? 'Maybe Baby' : 'Maybe Later' });
  });

  it.each([
    '45ish',
    '45-ish',
    'roughly45',
    'approx45',
    '40 to 45',
    'from 40 to 45',
    '40/45',
    '40…45',
    '40−45',
    '40‑45',
    'less than 45',
    'under 45',
    'over 45',
    'more than 45',
    'a little over 45',
    'just under 45',
    'maximum 45',
    'minimum 45',
  ])('rejects a structurally inexact destructive replacement: %s', (value) => {
    expect(
      correction(`Update my timeout to ${value} minutes going forward, not 30 minutes.`, {
        predicate: 'timeout',
        value: `${value} minutes`,
      }),
    ).toBeNull();
  });

  it.each(['roughish 45 minutes', 'foo 45 minutes', '45 cats', 'aboutish 45 minutes'])(
    'does not let an unrelated provider unit authorize structured correction text: %s',
    (value) => {
      expect(
        correction(`Update my timeout to ${value} going forward, not 30 minutes.`, {
          predicate: 'timeout_code',
          value,
        }),
      ).toBeNull();
    },
  );

  it.each(['45 Friday', '100 Monday', '32 July'])(
    'rejects a scalar-temporal replacement that is not a calendar date: %s',
    (value) => {
      expect(
        correction(`Update my timeout to ${value} going forward, not 30 minutes.`, {
          predicate: 'timeout',
          value,
        }),
      ).toBeNull();
    },
  );

  it.each([
    'más de 3',
    'hasta 3',
    'plus de 3',
    'jusqu’à 3',
    'über 3',
    'meer dan 3',
    'mais de 3',
    'até 3',
    'أكثر من 3',
    'حوالي 3',
    'بين 40 و45',
    '超过3',
    '大约3',
    '40到45',
    '3以上',
    '約3',
    '40から45',
    'più di 3',
  ])('rejects multilingual inexact replacements for a version head: %s', (value) => {
    expect(
      correction(`Update my version to ${value} going forward, not 2.`, {
        predicate: 'version',
        value,
        currentValue: '2',
      }),
    ).toBeNull();
  });

  it.each([
    'alrededor de 3 Calle Mayor',
    'Alrededor De 3 Calle Mayor',
    '3 Calle Mayor Alrededor De',
    'près du 3 rue Victor Hugo',
    'Près Du 3 Rue Victor Hugo',
    '3 Rue Victor Hugo Près Du',
    'por volta do 3 Rua Maior',
    'Por Volta Do 3 Rua Central',
    '3 Rua Central Por Volta Do',
    'حوالي 3 شارع مايو',
    '大约3号主街',
    '約3丁目',
  ])('rejects an uncertain destructive address replacement: %s', (value) => {
    expect(
      correction(`Update my address to ${value} going forward, not Main Street 1.`, {
        predicate: 'address',
        value,
        currentValue: 'Main Street 1',
      }),
    ).toBeNull();
  });

  it.each(['3 Calle Mayor', '3 Rue Victor Hugo', '3 Rua Central'])(
    'preserves an exact numeric-first address replacement: %s',
    (value) => {
      expect(
        correction(`Update my address to ${value} going forward, not 1 Main Street.`, {
          predicate: 'address',
          value,
          currentValue: '1 Main Street',
        }),
      ).toMatchObject({ predicate: 'address', value });
    },
  );
});
