import { buildCompactionSummary } from '../../../src/services/context/compactionSummarizer';
import type { Message } from '../../../src/types/message';

jest.mock('../../../src/services/llm/LlmService', () => ({
  LlmService: jest.fn().mockImplementation(() => ({
    sendMessage: jest.fn().mockResolvedValue({
      choices: [{ message: { content: '[Conversation Summary]\n\n## Task Overview\nDone' } }],
    }),
  })),
}));

const messages: Message[] = [
  {
    id: 'u1',
    role: 'user',
    content: 'Summarize my errands',
    timestamp: 1,
  },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Checking calendar first.',
    timestamp: 2,
  },
];

describe('compactionSummarizer', () => {
  it('uses deterministic structural summaries by default', async () => {
    const summary = await buildCompactionSummary({
      messages,
      tier: 'selective',
    });

    expect(summary).toContain('[Conversation Summary]');
    expect(summary).toContain('## Task Overview');
  });

  it('uses the configured summarizer when provided', async () => {
    const summary = await buildCompactionSummary({
      messages,
      tier: 'selective',
      summarizer: {
        provider: {
          id: 'openai',
          name: 'OpenAI',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: 'sk-test',
          model: 'gpt-5-mini',
          enabled: true,
        },
        model: 'gpt-5-mini',
        apiKey: 'sk-test',
      },
    });

    expect(summary).toContain('[Conversation Summary]');
    expect(summary).toContain('## Task Overview');
  });
});
