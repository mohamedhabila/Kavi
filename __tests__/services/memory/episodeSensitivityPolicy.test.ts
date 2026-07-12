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
});
