import {
  deriveExactNamedSubjectClaimEvidence,
  deriveExactSelfClaimEvidence,
  deriveExactSelfCorrectionEvidence,
} from '../../../src/services/memory/exactSelfClaimEvidence';

it.each([
  ["My dog's name is Luna.", 'dog_name', 'Luna'],
  ['My daughter’s birthday is May 4.', 'daughter_birthday', 'May 4'],
  ['My shoe size is 42.', 'shoe_size', '42'],
  ['My passport number is X1234567.', 'passport_number', 'X1234567'],
  [
    'My Slack notification preference is mentions only.',
    'slack_notification_preference',
    'mentions only',
  ],
  ['My preferred Python version is 3.12.', 'preferred_python_version', '3.12'],
  ['My pronouns are they/them.', 'pronouns', 'they/them'],
  ['My allergy is peanuts.', 'allergy', 'peanuts'],
  ['My dietary restriction is halal.', 'dietary_restriction', 'halal'],
  [
    'My emergency contact is Sara at +31 6 1234 5678.',
    'emergency_contact',
    'Sara at +31 6 1234 5678',
  ],
  [
    'My billing address is Keizersgracht 1, Amsterdam.',
    'billing_address',
    'Keizersgracht 1, Amsterdam',
  ],
  ['My GitHub username is mohab.', 'github_username', 'mohab'],
  ['My preferred coffee is a flat white.', 'preferred_coffee', 'a flat white'],
  ['My car color is blue.', 'car_color', 'blue'],
  ['My preferred HTTP version is HTTP/2.', 'preferred_http_version', 'HTTP/2'],
  ['My compliance standard is ISO 27001.', 'compliance_standard', 'ISO 27001'],
  ['My HTTP2 preference is enabled.', 'http2_preference', 'enabled'],
  ['My 2FA method is passkey.', '2fa_method', 'passkey'],
  ['My GPT-5 preference is high reasoning.', 'gpt_5_preference', 'high reasoning'],
  ['My ISO 27001 preference is strict.', 'iso_27001_preference', 'strict'],
  [
    'My Discord notification preference is mentions only.',
    'discord_notification_preference',
    'mentions only',
  ],
  [
    'My Teams notification preference is direct messages.',
    'teams_notification_preference',
    'direct messages',
  ],
  ['My GitLab username is mohab.', 'gitlab_username', 'mohab'],
  ['My OpenAI model preference is GPT-5.', 'openai_model_preference', 'GPT-5'],
  ['My iPhone notification preference is silent.', 'iphone_notification_preference', 'silent'],
  ['My PostgreSQL version is 17.', 'postgresql_version', '17'],
  ['My Signal notification preference is silent.', 'signal_notification_preference', 'silent'],
  ['My Audible playback preference is fast.', 'audible_playback_preference', 'fast'],
  ['My Epic username is mohab.', 'epic_username', 'mohab'],
  ['My Elastic version is 9.', 'elastic_version', '9'],
  ['My AppleMusic preference is lossless.', 'apple_music_preference', 'lossless'],
  ['My preferred Rust version is 1.79.', 'preferred_rust_version', '1.79'],
  ['My preferred Java version is 21.', 'preferred_java_version', '21'],
  ['My blood type is O positive.', 'blood_type', 'O positive'],
  ['My eye color is green.', 'eye_color', 'green'],
])(
  'admits a bounded, predicate-covered explicit property descriptor: %s',
  (message, predicate, value) => {
    expect(
      deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value }),
    ).toMatchObject({ predicate, value });
  },
);

it.each([
  ['My launch status is Complete.', 'launch_status', 'Complete'],
  ['My roadmap deadline is Friday.', 'roadmap_deadline', 'Friday'],
  ['My fuzzy color is green.', 'fuzzy_color', 'green'],
  ['My fuzzyStatus color is green.', 'fuzzy_status_color', 'green'],
  ['My speculative eye color is green.', 'speculative_eye_color', 'green'],
  ['My ambiguous eye color is green.', 'ambiguous_eye_color', 'green'],
  ['My suspected eye color is green.', 'suspected_eye_color', 'green'],
  ['My maybeOpenAI model preference is Turbo.', 'maybeopenai_model_preference', 'Turbo'],
  ['My draft eye color is green.', 'draft_eye_color', 'green'],
  ['My LIKELY2 color is green.', 'likely2_color', 'green'],
  ['My TRIAL2 eye color is green.', 'trial2_eye_color', 'green'],
  ['My DRAFT2 status is Complete.', 'draft2_status', 'Complete'],
])(
  'keeps unsafe or context-sensitive open descriptors out of durable memory: %s',
  (message, predicate, value) => {
    expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
  },
);

it('rejects an unsafe technical-looking correction descriptor', () => {
  expect(
    deriveExactSelfCorrectionEvidence({
      userMessageText: 'Update my DRAFT2 status to Complete going forward, not Incomplete.',
      predicate: 'draft2_status',
      value: 'Complete',
      currentValue: 'Incomplete',
    }),
  ).toBeNull();
});

it('bounds an otherwise exact open property value', () => {
  const value = 'x'.repeat(201);
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText: `My eye color is ${value}.`,
      predicate: 'eye_color',
      value,
    }),
  ).toBeNull();
});

it.each([
  [
    'My Discord notification preference is mentions only.',
    'notification_preference',
    'mentions only',
  ],
  ['My blood type is O positive.', 'type', 'O positive'],
  ['My blood type is O positive.', 'blo_type', 'O positive'],
  ['My eye color is green.', 'color', 'green'],
  [
    'My Discord notification preference is mentions only.',
    'discor_notification_preference',
    'mentions only',
  ],
  ['My eye color is green.', 'spouse_eye_color', 'green'],
  [
    'My Discord notification preference is mentions only.',
    'work_discord_notification_preference',
    'mentions only',
  ],
  ['My status is healthy.', 'medical_status', 'healthy'],
  ['My status is Complete.', 'project_status', 'Complete'],
  ['My color is green.', 'eye_color', 'green'],
  ['My address is 1 Main Street.', 'billing_address', '1 Main Street'],
  ['My number is 12345.', 'passport_number', '12345'],
  ['My preference is silent.', 'notification_preference', 'silent'],
  ['My pet is Luna.', 'pet_type', 'Luna'],
  ['My pet is Luna.', 'pet_ownership', 'Luna'],
  ['My preferred Python version is 3.12.', 'python_version', '3.12'],
  ['My favorite drink is matcha.', 'drink', 'matcha'],
  ['My primary email is me@example.com.', 'email', 'me@example.com'],
])('does not let a provider omit or add property semantics: %s', (message, predicate, value) => {
  expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
});

it.each([
  {
    message:
      'Update my Discord notification preference to direct messages going forward, not mentions only.',
    predicate: 'discord_notification_preference',
    value: 'direct messages',
    currentValue: 'mentions only',
  },
  {
    message: 'Update my nationality to Nigerian going forward, not Canadian.',
    predicate: 'nationality',
    value: 'Nigerian',
    currentValue: 'Canadian',
  },
  {
    message: 'Update my marital status to engaged going forward, not single.',
    predicate: 'marital_status',
    value: 'engaged',
    currentValue: 'single',
  },
])('admits an open explicit property value in a target-bound correction: $message', (fixture) => {
  expect(
    deriveExactSelfCorrectionEvidence({
      userMessageText: fixture.message,
      predicate: fixture.predicate,
      value: fixture.value,
      currentValue: fixture.currentValue,
    }),
  ).toMatchObject({ predicate: fixture.predicate, value: fixture.value });
});

it('admits an open exact value for a named-subject property', () => {
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText: 'Mina nationality is Palestinian.',
      subject: 'Mina',
      predicate: 'nationality',
      value: 'Palestinian',
    }),
  ).toMatchObject({ subject: 'Mina', predicate: 'nationality', value: 'Palestinian' });
});

it('grounds release properties without accepting provider-only semantics', () => {
  expect(
    deriveExactSelfClaimEvidence({
      userMessageText:
        'My project title is Android Release Build Validation. Please remember the release follow-up.',
      predicate: 'project_title',
      value: 'Android Release Build Validation',
    }),
  ).toMatchObject({ predicate: 'project_title', value: 'Android Release Build Validation' });
  expect(
    deriveExactNamedSubjectClaimEvidence({
      userMessageText:
        'release title is Production Mobile Release. Create and remember the release artifact.',
      subject: 'release',
      predicate: 'release_title',
      value: 'Production Mobile Release',
    }),
  ).toMatchObject({ predicate: 'release_title', value: 'Production Mobile Release' });
});

it.each(['medical_nationality', 'spouse_nationality', 'palestinian_nationality'])(
  'rejects named-subject predicate semantics absent from the exact assertion: %s',
  (predicate) => {
    expect(
      deriveExactNamedSubjectClaimEvidence({
        userMessageText: 'Mina nationality is Palestinian.',
        subject: 'Mina',
        predicate,
        value: 'Palestinian',
      }),
    ).toBeNull();
  },
);

it.each([
  ['My LAUNCH status is Complete.', 'launch_status', 'Complete'],
  ['My LaunchReview status is Complete.', 'launch_review_status', 'Complete'],
  ['My arbitraryCase status is Complete.', 'arbitrary_case_status', 'Complete'],
  ['My XQZ status is Complete.', 'xqz_status', 'Complete'],
])(
  'does not treat descriptor casing as semantic property authorization: %s',
  (message, predicate, value) => {
    expect(deriveExactSelfClaimEvidence({ userMessageText: message, predicate, value })).toBeNull();
  },
);
