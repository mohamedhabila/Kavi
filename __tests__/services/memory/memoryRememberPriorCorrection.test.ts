jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../../helpers/expoSqliteShim');
  return makeExpoSqliteMock();
});

import { closeMemoryDb } from '../../../src/services/memory/database';
import { upsertEntity } from '../../../src/services/memory/entities';
import { recordFactWithApplicability } from '../../../src/services/memory/facts/mutations';
import { listFacts } from '../../../src/services/memory/facts/queries';
import { executeMemoryRemember } from '../../../src/services/memory/memoryTools';
import {
  ensureFactSchema,
  resetFactSchemaCacheForTests,
} from '../../../src/services/memory/schema';
import { useSettingsStore } from '../../../src/store/useSettingsStore';

const expoSqlite = require('expo-sqlite') as { __resetExpoSqliteForTests: () => void };

beforeEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
  resetFactSchemaCacheForTests();
  ensureFactSchema();
  useSettingsStore.setState({ disableLongTermMemory: false });
});

afterEach(() => {
  closeMemoryDb();
  expoSqlite.__resetExpoSqliteForTests();
});

function groundedRequest(
  userMessageId: string,
  userMessageText: string,
  priorUserMessageId?: string,
) {
  return {
    requestEvidence: {
      memoryConversationId: 'conversation-request',
      sourceThreadId: 'thread-request',
      taskId: null,
      userMessageId,
      userMessageText,
      ...(priorUserMessageId ? { priorUserMessageId } : {}),
    },
  };
}

function rememberOk(
  args: Parameters<typeof executeMemoryRemember>[0],
  context?: Parameters<typeof executeMemoryRemember>[1],
) {
  const result = executeMemoryRemember(args, context);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result;
}

it('reuses one immediately prior grounded predicate for an explicit anaphoric correction', () => {
  const first = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'sprint review duration preference',
      value: '20 minutes',
      scope: 'global',
    },
    groundedRequest('user-review-duration-old', 'I usually keep sprint reviews to 20 minutes.'),
  );
  const corrected = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'sprint_review_default_duration_minutes',
      value: '30 minutes',
      scope: 'global',
    },
    groundedRequest(
      'user-review-duration-new',
      'Actually, make that 30 minutes from now on, not 20.',
      'user-review-duration-old',
    ),
  );

  expect(corrected.fact).toMatchObject({
    predicate: 'sprint review duration preference',
    value: '30 minutes',
  });
  expect(corrected.superseded).toEqual([
    expect.objectContaining({ id: first.fact.id, value: '20 minutes' }),
  ]);
  expect(listFacts({ predicate: 'sprint_review_default_duration_minutes' })).toEqual([]);
});

it('rejects cross-predicate anaphora without one immediately prior source fact', () => {
  const first = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'focus block duration preference',
      value: '40 minutes',
      scope: 'global',
    },
    groundedRequest('user-focus-old', 'I usually keep focus blocks to 40 minutes.'),
  );
  const rejected = executeMemoryRemember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'focus_block_default_minutes',
      value: '50 minutes',
      scope: 'global',
    },
    groundedRequest(
      'user-focus-new',
      'Actually, make that 50 minutes from now on, not 40.',
      'a-different-prior-message',
    ),
  );

  expect(rejected).toMatchObject({ ok: false, code: 'grounding_required' });
  expect(listFacts({ predicate: 'focus block duration preference' })).toEqual([
    expect.objectContaining({ id: first.fact.id, objectText: '40 minutes', invalidAt: null }),
  ]);
  expect(listFacts({ predicate: 'focus_block_default_minutes' })).toEqual([]);
});

it('rejects ambiguous prior-message facts instead of guessing a correction target', () => {
  const user = upsertEntity({ name: 'user', type: 'self' });
  const first = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: 'planning review duration',
      objectText: '25 minutes',
      scope: 'global',
      sourceMessageId: 'user-ambiguous-old',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  const second = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: 'retrospective review duration',
      objectText: '25 minutes',
      scope: 'global',
      sourceMessageId: 'user-ambiguous-old',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  );
  const rejected = executeMemoryRemember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'review_default_duration',
      value: '35 minutes',
      scope: 'global',
    },
    groundedRequest(
      'user-ambiguous-new',
      'Actually, make my usual review duration 35 minutes from now on, not 25 minutes.',
      'user-ambiguous-old',
    ),
  );

  expect(rejected).toMatchObject({ ok: false, code: 'grounding_required' });
  expect(listFacts()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: first.fact.id, invalidAt: null }),
      expect.objectContaining({ id: second.fact.id, invalidAt: null }),
    ]),
  );
  expect(listFacts({ predicate: 'meeting_default_minutes' })).toEqual([]);
});

it('binds an anaphoric correction to the immediately prior user fact, not the provider predicate', () => {
  const user = upsertEntity({ name: 'user', type: 'self' });
  const eyeColor = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: 'eye_color',
      objectText: 'blue',
      scope: 'global',
      sourceMessageId: 'user-eye-color-prior',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;
  const carColor = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: 'car_color',
      objectText: 'blue',
      scope: 'global',
      sourceMessageId: 'user-car-color-older',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;

  const corrected = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'car_color',
      value: 'green',
      scope: 'global',
    },
    groundedRequest(
      'user-color-correction',
      'Actually, make that green from now on, not blue.',
      'user-eye-color-prior',
    ),
  );

  expect(corrected.fact).toMatchObject({ predicate: 'eye_color', value: 'green' });
  expect(corrected.superseded).toEqual([
    expect.objectContaining({ id: eyeColor.id, value: 'blue' }),
  ]);
  expect(listFacts({ predicate: 'car_color' })).toEqual([
    expect.objectContaining({ id: carColor.id, objectText: 'blue', invalidAt: null }),
  ]);
});

it('still admits a distinct direct claim after a prior message wrote multiple facts', () => {
  const user = upsertEntity({ name: 'user', type: 'self' });
  for (const [predicate, objectText] of [
    ['planning review duration', '25 minutes'],
    ['planning review color', 'blue'],
  ] as const) {
    recordFactWithApplicability(
      {
        subjectId: user.id,
        predicate,
        objectText,
        scope: 'global',
        sourceMessageId: 'user-multi-fact-prior',
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    );
  }

  const remembered = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'preferred editor font',
      value: 'JetBrains Mono',
      scope: 'global',
    },
    groundedRequest(
      'user-distinct-new',
      'My preferred editor font is JetBrains Mono.',
      'user-multi-fact-prior',
    ),
  );

  expect(remembered.fact).toMatchObject({
    predicate: 'preferred editor font',
    value: 'JetBrains Mono',
  });
});

it.each([
  {
    message: 'In general, my usual design-review duration is 45 minutes.',
    predicate: 'usual_design_review_duration',
  },
  {
    message: 'For design reviews, my usual meeting duration is 45 minutes.',
    predicate: 'usual_design_review_meeting_duration',
  },
])('persists a structurally complete contextual claim: $message', ({ message, predicate }) => {
  const remembered = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate,
      value: '45 minutes',
      scope: 'global',
    },
    groundedRequest('user-contextual-direct', message),
  );

  expect(remembered.fact).toMatchObject({
    predicate,
    value: '45 minutes',
  });
});

it.each([
  {
    subject: 'user',
    subjectType: 'self' as const,
    predicate: 'favorite_movie',
    value: 'about time',
    message: 'My favorite movie is "about time".',
  },
  {
    subject: 'user',
    subjectType: 'self' as const,
    predicate: '2fa_method',
    value: 'passkey',
    message: 'My 2FA method is passkey.',
  },
  {
    subject: 'project',
    subjectType: 'project' as const,
    predicate: 'project_name',
    value: 'Maybe',
    message: 'The project name is Maybe.',
  },
])('persists a safe literal or numeric-profile claim: $message', (fixture) => {
  const remembered = rememberOk(
    {
      subject: fixture.subject,
      subjectType: fixture.subjectType,
      predicate: fixture.predicate,
      value: fixture.value,
      scope: 'global',
    },
    groundedRequest('user-safe-literal', fixture.message),
  );

  expect(remembered.fact).toMatchObject({
    predicate: fixture.predicate,
    value: fixture.value,
  });
});

it('classifies intimate facts at the write boundary and refuses credentials', () => {
  const sensitive = rememberOk(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'allergy',
      value: 'penicillin',
      scope: 'global',
    },
    groundedRequest('user-sensitive-allergy', 'My allergy is penicillin.'),
  );
  expect(listFacts({ predicate: 'allergy' })).toEqual([
    expect.objectContaining({ id: sensitive.fact.id, sensitivity: 'sensitive' }),
  ]);

  const restricted = executeMemoryRemember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'token',
      value: 'sk-PROJ12345678',
      scope: 'global',
    },
    groundedRequest('user-restricted-token', 'My token is sk-PROJ12345678.'),
  );
  expect(restricted).toMatchObject({ ok: false, code: 'permission_denied' });
  expect(listFacts({ predicate: 'token', includeInvalidated: true })).toEqual([]);
});

it.each([
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message:
      'Set my design-review duration to 45 minutes going forward, not 30 minutes for tomorrow review.',
  },
  {
    predicate: 'gebruikelijke ontwerpreview duur',
    currentValue: '30 minuten',
    value: '45 minuten',
    message:
      'Voortaan, zet mijn gebruikelijke ontwerpreview duur op 45 minuten voor deze week, niet 30 minuten.',
  },
  {
    predicate: 'durée revue conception',
    currentValue: '30 minutes',
    value: '45 minutes',
    message:
      'Désormais, mets ma durée habituelle de revue de conception à 45 minutes pour cette semaine, pas 30 minutes.',
  },
])(
  'does not let a rejected correction fall through to a direct replacement: $message',
  (fixture) => {
    const user = upsertEntity({ name: 'user', type: 'self' });
    const current = recordFactWithApplicability(
      {
        subjectId: user.id,
        predicate: fixture.predicate,
        objectText: fixture.currentValue,
        scope: 'global',
        sourceMessageId: 'user-unsafe-current',
      },
      { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
    ).fact;

    const rejected = executeMemoryRemember(
      {
        subject: 'user',
        subjectType: 'self',
        predicate: fixture.predicate,
        value: fixture.value,
        scope: 'global',
      },
      groundedRequest('user-unsafe-new', fixture.message, 'user-unsafe-current'),
    );

    expect(rejected).toMatchObject({ ok: false, code: 'grounding_required' });
    expect(listFacts({ predicate: fixture.predicate })).toEqual([
      expect.objectContaining({
        id: current.id,
        objectText: fixture.currentValue,
        invalidAt: null,
      }),
    ]);
  },
);

it('does not insert a drifted predicate when strict correction evidence rejects', () => {
  const user = upsertEntity({ name: 'user', type: 'self' });
  const current = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: 'design review duration preference',
      objectText: '30 minutes',
      scope: 'global',
      sourceMessageId: 'user-drift-unsafe-prior',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;

  const rejected = executeMemoryRemember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: 'design_review_default_duration_minutes',
      value: '45 minutes',
      scope: 'global',
    },
    groundedRequest(
      'user-drift-unsafe-new',
      'Set my design-review duration to 45 minutes going forward, not 30 minutes. Just for today.',
      'user-drift-unsafe-prior',
    ),
  );

  expect(rejected).toMatchObject({ ok: false, code: 'grounding_required' });
  expect(listFacts({ predicate: 'design review duration preference' })).toEqual([
    expect.objectContaining({ id: current.id, objectText: '30 minutes', invalidAt: null }),
  ]);
  expect(listFacts({ predicate: 'design_review_default_duration_minutes' })).toEqual([]);
});

it.each([
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'If I set my default design-review duration to 45 minutes, that would help.',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'For tomorrow, set my default design-review duration to 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'Tomorrow, set my default design-review duration to 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'For lunch, set my default design-review duration to 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'When the client asks, set my default design-review duration to 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'This afternoon, set my default design-review duration to 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'Set my default design-review duration to 45 minutes if the client agrees.',
  },
  {
    predicate: 'timezone',
    currentValue: 'UTC',
    value: 'Europe/Amsterdam',
    message: 'Is my timezone Europe/Amsterdam?',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'Is my usual design-review duration 45 minutes',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'Can you check whether my usual design-review duration is 45 minutes',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'Please tell me whether my usual design-review duration is 45 minutes',
  },
  {
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message: 'I wonder whether my usual design-review duration is 45 minutes',
  },
  ...[
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
  ].map((message) => ({
    predicate: 'keeps design review meeting duration',
    currentValue: '30 minutes',
    value: '45 minutes',
    message,
  })),
])('does not replace a current fact from unsafe direct evidence: $message', (fixture) => {
  const user = upsertEntity({ name: 'user', type: 'self' });
  const current = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: fixture.predicate,
      objectText: fixture.currentValue,
      scope: 'global',
      sourceMessageId: 'user-direct-unsafe-prior',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;

  const rejected = executeMemoryRemember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: fixture.predicate,
      value: fixture.value,
      scope: 'global',
    },
    groundedRequest('user-direct-unsafe-new', fixture.message, 'user-direct-unsafe-prior'),
  );

  expect(rejected).toMatchObject({ ok: false, code: 'grounding_required' });
  expect(listFacts({ predicate: fixture.predicate })).toEqual([
    expect.objectContaining({ id: current.id, objectText: fixture.currentValue, invalidAt: null }),
  ]);
});

it.each([
  {
    predicate: 'duration for one meeting',
    value: '45 minutes',
    message: 'My duration for one meeting is 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: '45 minutes or 30 minutes',
    message: 'My usual design-review duration is 45 minutes or 30 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: '45 minutes for Friday only',
    message: 'My usual design-review duration is 45 minutes for Friday only.',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: 'maybe 45 minutes',
    message: 'My usual design-review duration is maybe 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: '45 minutes',
    message: 'My usual design-review duration is 45 minutes؟',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: '45 minutes for Friday only',
    message:
      'Update my usual design-review duration to 45 minutes for Friday only, not 30 minutes.',
  },
  {
    predicate: 'duration on client demo',
    value: '45 minutes',
    message: 'My duration on the client demo is 45 minutes.',
  },
  {
    predicate: 'duration for 2026 07 18',
    value: '45 minutes',
    message: 'My duration for 2026-07-18 is 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: 'about 45 minutes',
    message: 'My usual design-review duration is about 45 minutes.',
  },
  {
    predicate: 'keeps design review meeting duration',
    value: '45 minutes, okay',
    message: 'My usual design-review duration is 45 minutes, okay.',
  },
  {
    predicate: 'usual duration whilst presenting',
    value: '45 minutes',
    message: 'My usual duration whilst presenting is 45 minutes.',
  },
  {
    predicate: 'usual duration seems',
    value: '45 minutes',
    message: 'My usual duration seems to be 45 minutes.',
  },
  {
    predicate: 'project status',
    value: 'Maybe Complete',
    message: 'My project is Maybe Complete.',
  },
  {
    predicate: 'duration effective 3pm',
    value: '45 minutes',
    message: 'Update my duration effective 3pm to 45 minutes going forward, not 30 minutes.',
  },
])('keeps an existing fact unchanged across an expanded unsafe proposal: $message', (fixture) => {
  const user = upsertEntity({ name: 'user', type: 'self' });
  const current = recordFactWithApplicability(
    {
      subjectId: user.id,
      predicate: fixture.predicate,
      objectText: '30 minutes',
      scope: 'global',
      sourceMessageId: 'user-expanded-unsafe-prior',
    },
    { factClass: 'subjective_user', sourceAuthority: 'grounded_user' },
  ).fact;

  const rejected = executeMemoryRemember(
    {
      subject: 'user',
      subjectType: 'self',
      predicate: fixture.predicate,
      value: fixture.value,
      scope: 'global',
    },
    groundedRequest('user-expanded-unsafe-new', fixture.message, 'user-expanded-unsafe-prior'),
  );

  expect(rejected).toMatchObject({ ok: false, code: 'grounding_required' });
  expect(listFacts({ predicate: fixture.predicate })).toEqual([
    expect.objectContaining({ id: current.id, objectText: '30 minutes', invalidAt: null }),
  ]);
});
