import { deriveEpisodeSensitivity } from '../../../src/services/memory/episodes/sensitivityPolicy';

const NORMAL_EVIDENCE = {
  sourceMessages: [
    { id: 'message-user', role: 'user' as const, content: 'Plan a museum visit.' },
    {
      id: 'message-tool',
      role: 'tool' as const,
      content: 'Museum hours were retrieved successfully.',
    },
    {
      id: 'message-assistant',
      role: 'assistant' as const,
      content: 'The museum opens at ten.',
    },
  ],
  facts: [],
};

const BASE_INPUT = {
  summary: 'Planned a museum visit.',
  messageIds: ['message-user', 'message-tool', 'message-assistant'],
  sourceStartMessageId: 'message-user',
  sourceEndMessageId: 'message-assistant',
  evidence: NORMAL_EVIDENCE,
};

describe('episode sensitivity policy', () => {
  function withUserText(content: string) {
    return {
      ...BASE_INPUT,
      evidence: {
        ...NORMAL_EVIDENCE,
        sourceMessages: NORMAL_EVIDENCE.sourceMessages.map((message) =>
          message.id === 'message-user' ? { ...message, content } : message,
        ),
      },
    };
  }

  it('keeps a complete ordinary closed turn normal', () => {
    expect(deriveEpisodeSensitivity(BASE_INPUT)).toBe('normal');
  });

  it('maps personal admitted fact semantics to private', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          facts: [
            {
              subject: 'user',
              subjectType: 'self',
              predicate: 'age',
              objectText: '42',
              memoryKind: 'semantic_fact',
            },
          ],
        },
      }),
    ).toBe('private');
  });

  it('classifies credentials found only in tool evidence as sensitive', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          sourceMessages: NORMAL_EVIDENCE.sourceMessages.map((message) =>
            message.id === 'message-tool'
              ? { ...message, content: 'API key sk-sensitive-tool-only-12345 was rejected.' }
              : message,
          ),
        },
      }),
    ).toBe('sensitive');
  });

  it('fails closed when evidence omits a persisted message id', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          sourceMessages: NORMAL_EVIDENCE.sourceMessages.filter(
            (message) => message.id !== 'message-tool',
          ),
        },
      }),
    ).toBe('sensitive');
  });

  it('fails closed when any bounded message evidence was truncated', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          sourceMessages: NORMAL_EVIDENCE.sourceMessages.map((message) =>
            message.id === 'message-tool' ? { ...message, truncated: true } : message,
          ),
        },
      }),
    ).toBe('sensitive');
  });

  it('preserves a prior sensitivity floor across a lower replay', () => {
    expect(deriveEpisodeSensitivity({ ...BASE_INPUT, priorSensitivity: 'sensitive' })).toBe(
      'sensitive',
    );
    expect(deriveEpisodeSensitivity({ ...BASE_INPUT, priorSensitivity: 'invalid' })).toBe(
      'sensitive',
    );
  });

  it.each([
    'My password is winter-sunrise-2026.',
    'كلمة المرور الخاصة بي هي شروق-الشتاء-٢٠٢٦.',
    'Mein Passwort ist winter-sonnenaufgang-2026.',
    'Mi contraseña es invierno-amanecer-2026.',
    'Mon mot de passe est hiver-soleil-2026.',
    '私のパスワードは冬の日の出2026です。',
    'Minha senha é inverno-nascer-do-sol-2026.',
    '我的密码是冬日晨光2026。',
    '我的密碼是冬日晨光2026。',
  ])('classifies localized credential evidence as sensitive: %s', (text) => {
    expect(deriveEpisodeSensitivity(withUserText(text))).toBe('sensitive');
  });

  it.each([
    'My medical history was reviewed.',
    'تمت مراجعة التاريخ الطبي.',
    'Meine Krankengeschichte wurde besprochen.',
    'Se revisó mi historial médico.',
    'Mes antécédents médicaux ont été examinés.',
    '医療履歴を確認しました。',
    'Meu histórico médico foi revisado.',
    '已经查看了我的医疗记录。',
    '已經查看了我的醫療紀錄。',
  ])('classifies localized sensitive evidence as sensitive: %s', (text) => {
    expect(deriveEpisodeSensitivity(withUserText(text))).toBe('sensitive');
  });

  it.each([
    'I am 42 years old.',
    'عمري ٤٢ سنة.',
    'Ich bin 42 Jahre alt.',
    'Tengo 42 años.',
    "J'ai 42 ans.",
    '私は42歳です。',
    'Tenho 42 anos.',
    '我今年42岁。',
    '我今年42歲。',
  ])('classifies localized age evidence as private: %s', (text) => {
    expect(deriveEpisodeSensitivity(withUserText(text))).toBe('private');
  });

  it.each([
    'The Secret Garden is on my reading list.',
    'Build the card UI component.',
    'Look up the museum address.',
    'Translate the token labels.',
  ])('keeps ordinary episode prose normal: %s', (text) => {
    expect(deriveEpisodeSensitivity(withUserText(text))).toBe('normal');
  });

  it('fails closed instead of throwing on malformed fact evidence', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          facts: [{ predicate: null } as never],
        },
      }),
    ).toBe('sensitive');
  });

  it.each([
    {
      name: 'duplicate message ids',
      input: {
        messageIds: ['message-user', 'message-tool', 'message-tool'],
        sourceEndMessageId: 'message-tool',
      },
    },
    {
      name: 'reordered source evidence',
      input: {
        evidence: {
          ...NORMAL_EVIDENCE,
          sourceMessages: [
            NORMAL_EVIDENCE.sourceMessages[0],
            NORMAL_EVIDENCE.sourceMessages[2],
            NORMAL_EVIDENCE.sourceMessages[1],
          ],
        },
      },
    },
    { name: 'start id is not first', input: { sourceStartMessageId: 'message-tool' } },
    { name: 'end id is not last', input: { sourceEndMessageId: 'message-tool' } },
    {
      name: 'invalid source role',
      input: {
        evidence: {
          ...NORMAL_EVIDENCE,
          sourceMessages: NORMAL_EVIDENCE.sourceMessages.map((message) =>
            message.id === 'message-tool' ? { ...message, role: 'provider' as never } : message,
          ),
        },
      },
    },
    {
      name: 'non-array source evidence',
      input: { evidence: { ...NORMAL_EVIDENCE, sourceMessages: null as never } },
    },
    {
      name: 'non-array fact evidence',
      input: { evidence: { ...NORMAL_EVIDENCE, facts: null as never } },
    },
  ])('fails closed for $name', ({ input }) => {
    expect(deriveEpisodeSensitivity({ ...BASE_INPUT, ...input })).toBe('sensitive');
  });

  it.each([
    {
      name: 'Arabic credential field',
      fact: {
        subject: 'user',
        subjectType: 'self',
        predicate: 'كلمة المرور',
        objectText: 'opaque',
      },
      expected: 'sensitive',
    },
    {
      name: 'Japanese personal field',
      fact: {
        subject: 'user',
        subjectType: 'self',
        predicate: '年齢',
        objectText: '42',
      },
      expected: 'private',
    },
    {
      name: 'Traditional Chinese medical field',
      fact: {
        subject: 'user',
        subjectType: 'self',
        predicate: '診斷',
        objectText: 'example',
      },
      expected: 'sensitive',
    },
    {
      name: 'structured email value',
      fact: {
        subject: 'user',
        subjectType: 'self',
        predicate: 'contact',
        objectText: 'person@example.com',
      },
      expected: 'sensitive',
    },
  ])('maps $name fact sensitivity into episode policy', ({ fact, expected }) => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: { ...NORMAL_EVIDENCE, facts: [fact] },
      }),
    ).toBe(expected);
  });
});
