import { classifyMemoryFactSensitivity } from '../../../src/services/memory/memorySensitivityPolicy';

it.each([
  ['preferred_channel', 'Signal'],
  ['runtime_version', '20'],
  ['artifact_token', 'E2E-NEW'],
])('classifies ordinary assistant memory as normal: %s', (predicate, objectText) => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'project',
      subjectType: 'project',
      predicate,
      objectText,
    }),
  ).toBe('normal');
});

it.each(['age', 'nationality', 'marital_status', 'occupation', 'preferred_pronouns'])(
  'classifies benign identity semantics as personal: %s',
  (predicate) => {
    expect(
      classifyMemoryFactSensitivity({
        subject: 'user',
        subjectType: 'self',
        predicate,
        objectText: 'example',
      }),
    ).toBe('personal');
  },
);

it.each([
  ['passport_number', 'P1234567'],
  ['billingAddress', '42 Main Street'],
  ['allergy', 'penicillin'],
  ['blood-type', 'O+'],
  ['emergency_contact', '+31 20 555 0100'],
  ['email', 'person@example.com'],
  ['2FA_method', 'passkey'],
])('classifies intimate or contact semantics as sensitive: %s', (predicate, objectText) => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'user',
      subjectType: 'self',
      predicate,
      objectText,
    }),
  ).toBe('sensitive');
});

it.each([
  ['password', 'correct horse battery staple'],
  ['apiKey', 'ordinary-looking-value'],
  ['token', 'Abc123'],
  ['build_label', 'sk-PROJ12345678'],
  ['recovery-code', 'ABCD-EFGH'],
])('classifies credentials as restricted: %s', (predicate, objectText) => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'user',
      subjectType: 'self',
      predicate,
      objectText,
    }),
  ).toBe('restricted');
});

it('classifies the complete attribute and source-summary projection', () => {
  expect(
    classifyMemoryFactSensitivity({
      subject: 'project',
      subjectType: 'project',
      predicate: 'deployment',
      objectText: 'ready',
      attributes: { auth: { refreshToken: 'opaque' } },
    }),
  ).toBe('restricted');
  expect(
    classifyMemoryFactSensitivity({
      subject: 'project',
      subjectType: 'project',
      predicate: 'status',
      objectText: 'active',
      sourceSummary: 'Medical condition was discussed.',
    }),
  ).toBe('sensitive');
});

it.each(['API_KEY', 'api-key', 'apiKey', 'Api Key'])(
  'is invariant to common semantic separators and casing: %s',
  (predicate) => {
    expect(
      classifyMemoryFactSensitivity({
        subject: 'user',
        subjectType: 'self',
        predicate,
        objectText: 'opaque',
      }),
    ).toBe('restricted');
  },
);
