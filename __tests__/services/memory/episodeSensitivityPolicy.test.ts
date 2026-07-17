import { deriveEpisodeSensitivity } from '../../../src/services/memory/episodes/sensitivityPolicy';

const NORMAL_EVIDENCE = {
  declaredSensitivity: 'normal',
  sourceMessages: [
    { id: 'message-user', role: 'user' as const, content: 'ข้อความทั่วไป' },
    { id: 'message-tool', role: 'tool' as const, content: 'نتيجة عادية' },
    { id: 'message-assistant', role: 'assistant' as const, content: '通常の応答' },
  ],
  facts: [],
};

const BASE_INPUT = {
  summary: 'संरचित सारांश',
  messageIds: ['message-user', 'message-tool', 'message-assistant'],
  sourceStartMessageId: 'message-user',
  sourceEndMessageId: 'message-assistant',
  evidence: NORMAL_EVIDENCE,
};

describe('episode sensitivity policy', () => {
  it.each([
    ['normal', 'normal'],
    ['personal', 'private'],
    ['sensitive', 'sensitive'],
    ['restricted', 'restricted'],
  ] as const)('maps the declared %s floor without language interpretation', (floor, expected) => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: { ...NORMAL_EVIDENCE, declaredSensitivity: floor },
      }),
    ).toBe(expected);
  });

  it('maps a provider-declared fact floor into the episode floor', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          facts: [
            {
              declaredSensitivity: 'personal',
              predicate: '任意',
              objectText: 'opaque',
            },
          ],
        },
      }),
    ).toBe('private');
  });

  it('lets a validated structural detector raise the episode floor', () => {
    expect(
      deriveEpisodeSensitivity({
        ...BASE_INPUT,
        evidence: {
          ...NORMAL_EVIDENCE,
          sourceMessages: NORMAL_EVIDENCE.sourceMessages.map((message) =>
            message.id === 'message-tool'
              ? { ...message, content: `ghp_${'a'.repeat(36)}` }
              : message,
          ),
        },
      }),
    ).toBe('restricted');
  });

  it.each([undefined, null, '', 'private', {}])(
    'forbids persistence for a missing or invalid declared floor: %s',
    (declaredSensitivity) => {
      expect(
        deriveEpisodeSensitivity({
          ...BASE_INPUT,
          evidence: { ...NORMAL_EVIDENCE, declaredSensitivity },
        }),
      ).toBe('restricted');
    },
  );

  it.each([
    {
      name: 'missing source evidence',
      evidence: {
        ...NORMAL_EVIDENCE,
        sourceMessages: NORMAL_EVIDENCE.sourceMessages.slice(0, 2),
      },
    },
    {
      name: 'truncated source evidence',
      evidence: {
        ...NORMAL_EVIDENCE,
        sourceMessages: NORMAL_EVIDENCE.sourceMessages.map((message) => ({
          ...message,
          truncated: message.id === 'message-tool',
        })),
      },
    },
    {
      name: 'malformed fact evidence',
      evidence: { ...NORMAL_EVIDENCE, facts: [{ predicate: null } as never] },
    },
  ])('forbids persistence for $name', ({ evidence }) => {
    expect(deriveEpisodeSensitivity({ ...BASE_INPUT, evidence })).toBe('restricted');
  });

  it('preserves a prior episode floor across a lower replay', () => {
    expect(deriveEpisodeSensitivity({ ...BASE_INPUT, priorSensitivity: 'sensitive' })).toBe(
      'sensitive',
    );
    expect(deriveEpisodeSensitivity({ ...BASE_INPUT, priorSensitivity: 'invalid' })).toBe(
      'sensitive',
    );
  });
});
