import {
  deriveExactNamedSubjectClaimEvidence,
  deriveExactSelfClaimEvidence,
} from '../../../src/services/memory/exactSelfClaimEvidence';

function claim(userMessageText: string) {
  return deriveExactSelfClaimEvidence({
    userMessageText,
    predicate: 'usual_design_review_duration',
    value: '45 minutes',
  });
}

it('admits a plain direct durable self claim', () => {
  expect(claim('My usual design-review duration is 45 minutes.')).toMatchObject({
    subject: 'user',
    predicate: 'usual_design_review_duration',
    value: '45 minutes',
  });
});

it.each([
  'In general, my usual design-review duration is 45 minutes.',
  'Set my usual design-review duration to 45 minutes.',
  'My usual design-review duration is 45 minutes going forward.',
])('admits a structurally complete durable self claim: %s', (message) => {
  expect(claim(message)).toMatchObject({
    subject: 'user',
    predicate: 'usual_design_review_duration',
    value: '45 minutes',
  });
});

it.each([
  'For design reviews, my usual meeting duration is 45 minutes.',
  'For design-review meetings, my usual duration is 45 minutes.',
])('admits a context-bound meeting-duration property: %s', (message) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: message,
      predicate: 'usual_design_review_meeting_duration',
      value: '45 minutes',
    }),
  ).toMatchObject({ predicate: 'usual_design_review_meeting_duration', value: '45 minutes' });
});

it.each([
  {
    message: 'Personally, I prefer concise answers.',
    predicate: 'response preference',
    value: 'concise answers',
  },
  { message: 'Please call me Mo.', predicate: 'preferred_name', value: 'Mo' },
  {
    message: 'Ma durée habituelle de revue est 45 minutes.',
    predicate: 'durée habituelle de revue',
    value: '45 minutes',
  },
  {
    message: 'Meine übliche Besprechungsdauer ist 45 Minuten.',
    predicate: 'übliche Besprechungsdauer',
    value: '45 Minuten',
  },
  { message: 'I moved to Utrecht.', predicate: 'lives_in', value: 'Utrecht' },
  { message: 'My favorite word is maybe.', predicate: 'favorite_word', value: 'maybe' },
  {
    message: 'My preferred hotel is One Hotel.',
    predicate: 'preferred_hotel',
    value: 'One Hotel',
  },
  {
    message: 'My favorite movie is About Time.',
    predicate: 'favorite_movie',
    value: 'About Time',
  },
  {
    message: 'My favorite movie is "about time".',
    predicate: 'favorite_movie',
    value: 'about time',
  },
  {
    message: 'My iPhone 15 model preference is Pro.',
    predicate: 'iphone_15_model_preference',
    value: 'Pro',
  },
  { message: 'My 2FA method is passkey.', predicate: '2fa_method', value: 'passkey' },
  {
    message: 'My GPT-5 preference is high reasoning.',
    predicate: 'gpt_5_preference',
    value: 'high reasoning',
  },
  {
    message: 'Mi película favorita es "Tal Vez".',
    predicate: 'película_favorita',
    value: 'Tal Vez',
  },
  {
    message: 'Meu filme favorito é "Talvez Amanhã".',
    predicate: 'filme_favorito',
    value: 'Talvez Amanhã',
  },
  {
    message: 'Bei wöchentlichen Besprechungen ist meine übliche Dauer 45 Minuten.',
    predicate: 'übliche_wöchentliche_besprechung_dauer',
    value: '45 Minuten',
  },
])('admits a complete common self-claim form: $message', ({ message, predicate, value }) => {
  expect(
    deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
  ).toMatchObject({ predicate, value });
});

it.each([
  ['The project name is Maybe.', 'project', 'project_name', 'Maybe'],
  ['The hotel name is One Hotel.', 'hotel', 'hotel_name', 'One Hotel'],
])(
  'keeps named-subject literal values independent of self-speech guards',
  (message, subject, predicate, value) => {
    expect(
      deriveExactNamedSubjectClaimEvidence({
        userMessageText: message,
        subject,
        predicate,
        value,
      }),
    ).toMatchObject({ subject, predicate, value });
  },
);

it('still rejects uncertainty inside a non-literal named-subject value', () => {
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText: 'The project deadline is maybe Friday.',
      subject: 'project',
      predicate: 'project_deadline',
      value: 'maybe Friday',
    }),
  ).toBeNull();
});

it('does not confuse a durable value named tomorrow with temporary scope', () => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: 'My favorite day is tomorrow.',
      predicate: 'favorite_day',
      value: 'tomorrow',
    }),
  ).toMatchObject({ predicate: 'favorite_day', value: 'tomorrow' });
});

it.each([
  'Is my usual design-review duration 45 minutes?',
  'If I set my usual design-review duration to 45 minutes, that would help.',
  'For tomorrow, set my usual design-review duration to 45 minutes.',
  'Tomorrow, set my usual design-review duration to 45 minutes.',
  'For lunch, set my usual design-review duration to 45 minutes.',
  'When the client asks, set my usual design-review duration to 45 minutes.',
  'This afternoon, set my usual design-review duration to 45 minutes.',
  'Set my usual design-review duration to 45 minutes if the client agrees.',
  'Set my usual design-review duration to 45 minutes for this meeting.',
  'Is my usual design-review duration 45 minutes',
  'Can you check whether my usual design-review duration is 45 minutes',
  'Please tell me whether my usual design-review duration is 45 minutes',
  'I wonder whether my usual design-review duration is 45 minutes',
  'My usual design-review duration is 45 minutes, right',
  'My usual design-review duration is 45 minutes, correct',
  'My usual design-review duration is 45 minutes or 30 minutes',
  'Isn’t my usual design-review duration 45 minutes',
  'My usual design-review duration is 45 minutes, isn’t it',
  'By tomorrow, set my usual design-review duration to 45 minutes.',
  'Starting tomorrow, set my usual design-review duration to 45 minutes.',
  'Next Tuesday, set my usual design-review duration to 45 minutes.',
  'Set my usual design-review duration to 45 minutes tomorrow.',
  'Set my usual design-review duration to 45 minutes on Friday.',
  'Set my usual design-review duration to 45 minutes at lunch.',
  'Over lunch, set my usual design-review duration to 45 minutes.',
  'Upon client request, set my usual design-review duration to 45 minutes.',
  'As soon as the client asks, set my usual design-review duration to 45 minutes.',
  'My usual design-review duration is "45 minutes".',
  'My usual design-review duration is 45 minutes؟',
  'My usual design-review duration is 45 minutes‽',
  'Zet mijn gebruikelijke ontwerpreview duur voor deze week op 45 minutes.',
  'Mets ma durée habituelle de revue de conception pour cette semaine à 45 minutes.',
])('rejects a non-assertive or temporary direct self claim: %s', (message) => {
  expect(claim(message)).toBeNull();
});

it.each([
  ['For one meeting, my usual duration is 45 minutes.', 'one_meeting_duration'],
  ['For a single review, my usual duration is 45 minutes.', 'single_review_duration'],
  ['For Friday only, my usual duration is 45 minutes.', 'friday_only_duration'],
  ['For Friday, my usual design-review duration is 45 minutes.', 'friday_design_review_duration'],
  ['My duration for Friday only is 45 minutes.', 'duration_for_friday_only'],
  ['My duration for one meeting is 45 minutes.', 'duration_for_one_meeting'],
  ['My duration for 2026-07-18 is 45 minutes.', 'duration_for_2026_07_18'],
  ['My duration for Q3 is 45 minutes.', 'duration_for_q3'],
  ['Mi duración para el viernes es 45 minutes.', 'duración_para_viernes'],
  ['Minha duração para sexta-feira é 45 minutes.', 'duração_para_sexta_feira'],
  ['My duration on the client demo is 45 minutes.', 'duration_on_client_demo'],
  ['My duration at the launch is 45 minutes.', 'duration_at_launch'],
  ['My duration during client demo is 45 minutes.', 'duration_during_client_demo'],
  ['My duration on launch day is 45 minutes.', 'duration_on_launch_day'],
  ['My duration throughout the launch is 45 minutes.', 'duration_throughout_launch'],
  ['My duration within the client demo is 45 minutes.', 'duration_within_client_demo'],
  ['My duration around launch day is 45 minutes.', 'duration_around_launch_day'],
  ['My duration via the client demo is 45 minutes.', 'duration_via_client_demo'],
  ['My duration per the launch is 45 minutes.', 'duration_per_launch'],
  ['My duration in sprint 7 is 45 minutes.', 'duration_in_sprint_7'],
])('does not let a proposed predicate legitimize temporary context: %s', (message, predicate) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: message,
      predicate,
      value: '45 minutes',
    }),
  ).toBeNull();
});

it('admits an explicit recurring inline context', () => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: 'My duration for client demos is 45 minutes.',
      predicate: 'duration_for_client_demos',
      value: '45 minutes',
    }),
  ).toMatchObject({ predicate: 'duration_for_client_demos', value: '45 minutes' });
});

it.each([
  ['My usual duration whilst presenting is 45 minutes.', 'usual_duration_whilst_presenting'],
  [
    'My usual duration anytime the client presents is 45 minutes.',
    'usual_duration_anytime_client_presents',
  ],
  ['My usual duration as of 07/12 is 45 minutes.', 'usual_duration_as_of_07_12'],
  ['My usual duration effective 3pm is 45 minutes.', 'usual_duration_effective_3pm'],
  ['My usual duration seems to be 45 minutes.', 'usual_duration_seems'],
  ['My usual duration appears to be 45 minutes.', 'usual_duration_appears'],
  ['My usual duration is likely 45 minutes.', 'usual_duration_likely'],
  ['My usual duration is apparently 45 minutes.', 'usual_duration_apparently'],
  ['My usual duration is supposedly 45 minutes.', 'usual_duration_supposedly'],
  ['My usual duration is reportedly 45 minutes.', 'usual_duration_reportedly'],
  ['My usual duration is conceivably 45 minutes.', 'usual_duration_conceivably'],
  ['My usual duration is a tentative 45 minutes.', 'usual_duration_tentative'],
])(
  'does not let provider predicate units authorize non-exact clause syntax: %s',
  (message, predicate) => {
    expect(
      deriveExactSelfClaimEvidence({
        userMessageText: message,
        predicate,
        value: '45 minutes',
      }),
    ).toBeNull();
  },
);

it.each([
  ['My project is Maybe Complete.', 'project_status', 'Maybe Complete'],
  ['My model is Maybe Ready.', 'model_status', 'Maybe Ready'],
  ['My book is Maybe Finished.', 'book_status', 'Maybe Finished'],
  ['My hotel is Maybe Open.', 'hotel_status', 'Maybe Open'],
  ['My film is Maybe Finished.', 'film_status', 'Maybe Finished'],
  ['My label is Maybe Active.', 'label_status', 'Maybe Active'],
])(
  'does not mistake an uncertain entity state for a literal title: %s',
  (message, predicate, value) => {
    expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
  },
);

it.each([
  '45 minutes or 30 minutes',
  '45 minutes, right',
  '45 minutes for Friday only',
  '45 minutes for Friday',
  'maybe 45 minutes',
  '45 minutes, okay',
  'about 45 minutes',
  '45 minutes, I guess',
  'between 30 and 45 minutes',
  'tal vez 45 minutes',
  'probablemente 45 minutes',
  'probablement 45 minutes',
  'waarschijnlijk 45 minutes',
  'wahrscheinlich 45 minutes',
])('does not let a proposed value absorb unsafe claim language: %s', (value) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: `My usual design-review duration is ${value}.`,
      predicate: 'usual_design_review_duration',
      value,
    }),
  ).toBeNull();
});

it.each([
  ['My 3pm duration is 45 minutes.', '3pm_duration'],
  ['My 07 12 duration is 45 minutes.', '07_12_duration'],
  ['My 07-12 duration is 45 minutes.', '07_12_duration'],
  ['My 20260712 duration is 45 minutes.', '20260712_duration'],
  ['My sprint7 duration is 45 minutes.', 'sprint7_duration'],
  ['My sprint 7 duration is 45 minutes.', 'sprint_7_duration'],
  ['My Q5 duration is 45 minutes.', 'q5_duration'],
  ['My 2026Q3 duration is 45 minutes.', '2026q3_duration'],
])('rejects a compact numeric or temporal property qualifier: %s', (message, predicate) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: message,
      predicate,
      value: '45 minutes',
    }),
  ).toBeNull();
});

it.each(['~', '≈', '∼', '<', '≤', '>', '≥', '≠', '±'])(
  'rejects a raw non-exact operator even when the provider omits it: %s',
  (operator) => {
    expect(
      deriveExactSelfClaimEvidence({
        userMessageText: `My age is ${operator}42.`,
        predicate: 'age',
        value: '42',
      }),
    ).toBeNull();
  },
);

it.each(['45+', '45±5', '40-45', '40–45', '45 < 60'])(
  'rejects a non-exact numeric value returned whole by the provider: %s',
  (value) => {
    expect(
      deriveExactSelfClaimEvidence({
        userMessageText: `My usual duration is ${value} minutes.`,
        predicate: 'usual_duration',
        value: `${value} minutes`,
      }),
    ).toBeNull();
  },
);

it.each([
  ['My name is Maybe Baby.', 'preferred_name', 'Maybe Baby'],
  ['My title is Maybe Later.', 'preferred_title', 'Maybe Later'],
  ['Mi título es "Tal Vez".', 'título', 'Tal Vez'],
  ['Meu título é "Talvez Amanhã".', 'título', 'Talvez Amanhã'],
])(
  'admits an explicit literal property without weakening state facts: %s',
  (message, predicate, value) => {
    expect(
      deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
    ).toMatchObject({ predicate, value });
  },
);

it.each([
  ['The project deadline is probably Friday.', 'Friday'],
  ['The project deadline is around Friday.', 'Friday'],
  ['The project deadline is approximately Friday.', 'Friday'],
  ['The project deadline is likely Friday.', 'Friday'],
  ['The project deadline is apparently Friday.', 'Friday'],
  ['The project deadline is reportedly Friday.', 'Friday'],
  ['The project deadline is probablemente viernes.', 'probablemente viernes'],
  ['The project budget is ~100.', '100'],
  ['The project budget is <100.', '100'],
  ['The project budget is 100 or 200.', '100'],
  ['The project budget is 100+.', '100'],
])('rejects an inexact or partial named-subject value: %s', (message, value) => {
  const predicate = message.includes('budget') ? 'project_budget' : 'project_deadline';
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText: message,
      subject: 'project',
      predicate,
      value,
    }),
  ).toBeNull();
});

it.each([
  'My estimated duration is 45 minutes.',
  'My approximate duration is 45 minutes.',
  'My possible duration is 45 minutes.',
  'My probable duration is 45 minutes.',
  'My expected duration is 45 minutes.',
  'My projected duration is 45 minutes.',
  'My presumed duration is 45 minutes.',
  'My supposed duration is 45 minutes.',
  'My alleged duration is 45 minutes.',
  'My reported duration is 45 minutes.',
  'My provisional duration is 45 minutes.',
  'My interim duration is 45 minutes.',
  'My trial duration is 45 minutes.',
  'My onetime duration is 45 minutes.',
  'My duration estimated is 45 minutes.',
  'My launch duration is 45 minutes.',
  'My Ramadan duration is 45 minutes.',
  'My noon duration is 45 minutes.',
  'My lunch duration is 45 minutes.',
  'My Qthree duration is 45 minutes.',
  'My nextweek duration is 45 minutes.',
  'My tomorrow2 duration is 45 minutes.',
  'My usual approximate duration is 45 minutes.',
  'My uncertain status is Complete.',
  'My doubtful status is Complete.',
  'My unclear status is Complete.',
  'My fuzzy status is Complete.',
  'My ballpark status is Complete.',
  'My forecast status is Complete.',
  'My rough status is Complete.',
  'My putative status is Complete.',
  'My hypothetical status is Complete.',
  'My ostensible status is Complete.',
  'My draft status is Complete.',
  'My candidate status is Complete.',
  'My target status is Complete.',
])('does not promote an arbitrary qualifier into durable property syntax: %s', (message) => {
  const nominal = message
    .slice('My '.length, message.indexOf(' is '))
    .replace(/\s+/gu, '_')
    .toLocaleLowerCase();
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: message,
      predicate: nominal,
      value: message.includes('Complete') ? 'Complete' : '45 minutes',
    }),
  ).toBeNull();
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
])('rejects a structurally inexact numeric payload: %s', (value) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: `My age is ${value}.`,
      predicate: 'age',
      value,
    }),
  ).toBeNull();
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText: `The project budget is ${value}.`,
      subject: 'project',
      predicate: 'project_budget',
      value,
    }),
  ).toBeNull();
});

it.each([
  ['I am 42.', 'age', '42'],
  ['I am a software engineer.', 'occupation', 'software engineer'],
  ['I am vegetarian.', 'dietary_identity', 'vegetarian'],
  ['I have two children.', 'dependent_count', 'two children'],
  ['I own a Tesla.', 'ownership', 'Tesla'],
  ['I go by Mo.', 'preferred_name', 'Mo'],
  ['I like concise answers.', 'response_preference', 'concise answers'],
  ['I need wheelchair access.', 'accessibility_requirement', 'wheelchair access'],
  ['I avoid peanuts.', 'avoidance', 'peanuts'],
  ['I was born on 12 July.', 'birthday', '12 July'],
  ['I grew up in Cairo.', 'hometown', 'Cairo'],
  ['I commute by bike.', 'commute_method', 'bike'],
  ['I wear size 42.', 'wear_size', '42'],
])(
  'admits a code-owned self-relation family with predicate agreement: %s',
  (message, predicate, value) => {
    expect(
      deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
    ).toMatchObject({ predicate, value });
  },
);

it.each([
  ['I am 42.', 'private_secret', '42'],
  ['I own a Tesla.', 'favorite_food', 'Tesla'],
  ['I was born on 12 July.', 'meeting_deadline', '12 July'],
  ['I commute by bike.', 'preferred_color', 'bike'],
])('does not let a provider predicate relabel a self-relation: %s', (message, predicate, value) => {
  expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
});

it.each([
  ['I am 42.', 'occupation', '42'],
  ['I am 42.', 'dietary_identity', '42'],
  ['I am a software engineer.', 'age', 'software engineer'],
  ['I am vegetarian.', 'age', 'vegetarian'],
  ['I have two children.', 'allergy', 'two children'],
  ['I have a dog.', 'condition', 'a dog'],
  ['I go by Mo.', 'preferred_color', 'Mo'],
  ['I go by Mo.', 'project_name', 'Mo'],
  ['I like concise answers.', 'favorite_food', 'concise answers'],
  ['I wear size 42.', 'screen_size', '42'],
  ['I wear size 42.', 'shoe_size', '42'],
  ['I commute by bike.', 'contact_method', 'bike'],
  ['I use VS Code.', 'uses_medication', 'VS Code'],
  ['I prefer concise answers.', 'prefers_food', 'concise answers'],
  ['I work as software engineer.', 'works_color', 'software engineer'],
])('rejects a semantically unbound self-relation predicate: %s', (message, predicate, value) => {
  expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
});

it.each([
  ['My phone number is 020 123 4567.', 'phone_number', '020 123 4567'],
  ['My preferred version is 1.2.3.', 'preferred_version', '1.2.3'],
  ['My passport number is 12 345 678.', 'passport_number', '12 345 678'],
  ['My billing address is Main Street 12 1/2.', 'billing_address', 'Main Street 12 1/2'],
  ['My server address is 192.168.1.10.', 'server_address', '192.168.1.10'],
  ['My billing address is 3 Calle Mayor.', 'billing_address', '3 Calle Mayor'],
  ['My billing address is 3 Rue Victor Hugo.', 'billing_address', '3 Rue Victor Hugo'],
  ['My billing address is 3 Rua Central.', 'billing_address', '3 Rua Central'],
])(
  'admits a structured numeric value only through its bound property head: %s',
  (message, predicate, value) => {
    expect(
      deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
    ).toMatchObject({ predicate, value });
  },
);

it.each(['roughish 45 minutes', 'foo 45 minutes', '45 cats', 'aboutish 45 minutes'])(
  'does not let an unrelated provider unit authorize structured scalar text: %s',
  (value) => {
    expect(
      deriveExactSelfClaimEvidence({
        userMessageText: `My usual duration is ${value}.`,
        predicate: 'usual_duration_code',
        value,
      }),
    ).toBeNull();
    expect(
      deriveExactNamedSubjectClaimEvidence({
        userMessageText: `The project budget is ${value}.`,
        subject: 'project',
        predicate: 'project_budget_code',
        value,
      }),
    ).toBeNull();
  },
);

it.each(['45 Friday', '100 Monday', '32 July'])(
  'does not confuse a scalar and temporal token with an exact calendar date: %s',
  (value) => {
    expect(
      deriveExactSelfClaimEvidence({
        userMessageText: `My usual duration is ${value}.`,
        predicate: 'usual_duration',
        value,
      }),
    ).toBeNull();
    expect(
      deriveExactNamedSubjectClaimEvidence({
        userMessageText: `The project budget is ${value}.`,
        subject: 'project',
        predicate: 'project_budget',
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
])('rejects multilingual inexact text for a structured version head: %s', (value) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: `My preferred version is ${value}.`,
      predicate: 'preferred_version',
      value,
    }),
  ).toBeNull();
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText: `The project version is ${value}.`,
      subject: 'project',
      predicate: 'project_version',
      value,
    }),
  ).toBeNull();
});

it.each([
  ['Ik woon in Utrecht.', 'residence', 'Utrecht'],
  ['Ik verkies beknopte antwoorden.', 'preference', 'beknopte antwoorden'],
  ['Je travaille comme ingénieur.', 'occupation', 'ingénieur'],
  ['Je préfère des réponses concises.', 'preference', 'des réponses concises'],
  ['Ich wohne in Berlin.', 'residence', 'Berlin'],
  ['Ich bevorzuge knappe Antworten.', 'preference', 'knappe Antworten'],
  ['Yo vivo en Madrid.', 'residence', 'Madrid'],
  ['Yo prefiero respuestas concisas.', 'preference', 'respuestas concisas'],
  ['Eu moro em Lisboa.', 'residence', 'Lisboa'],
  ['Eu prefiro respostas concisas.', 'preference', 'respostas concisas'],
])('admits a source-bound multilingual self relation: %s', (message, predicate, value) => {
  expect(
    deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
  ).toMatchObject({ predicate, value });
});

it.each([
  ['I was born on peanuts.', 'birthday', 'peanuts'],
  ['I commute by 42.', 'commute_method', '42'],
  ['I wear size blue.', 'wear_size', 'blue'],
  ['I own a Tesla for this week.', 'owns_tesla', 'Tesla for this week'],
  ['I like concise answers for this chat.', 'response_preference', 'concise answers for this chat'],
  [
    "I need wheelchair access for today's event.",
    'accessibility_requirement',
    "wheelchair access for today's event",
  ],
  ['I avoid peanuts at lunch.', 'avoidance', 'peanuts at lunch'],
])(
  'rejects a self-relation value outside its source-owned family: %s',
  (message, predicate, value) => {
    expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
  },
);

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
])('rejects an uncertain free-text address despite a bound address head: %s', (value) => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: `My billing address is ${value}.`,
      predicate: 'billing_address',
      value,
    }),
  ).toBeNull();
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText: `The office address is ${value}.`,
      subject: 'office',
      predicate: 'office_address',
      value,
    }),
  ).toBeNull();
});
