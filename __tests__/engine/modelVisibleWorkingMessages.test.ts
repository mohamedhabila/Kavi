import { sanitizeModelVisibleWorkingMessages } from '../../src/engine/graph/modelVisibleWorkingMessages';

describe('modelVisibleWorkingMessages', () => {
  it('compacts research tool payloads before later model turns without placeholdering history by default', () => {
    const fetchBody = `# AGENTS.md

- repository instructions
- first fetched section

\`\`\`text
alpha
beta
\`\`\`

${'middle content\n'.repeat(300)}
## Tail Marker

tail`;
    const sanitized = sanitizeModelVisibleWorkingMessages([
      {
        id: 'user-1',
        role: 'user',
        content: 'Compare official docs and cite checked URLs.',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'web_search',
        content: JSON.stringify({
          provider: 'gemini',
          searches: [
            {
              query: 'OpenAI Codex AGENTS.md',
              results: [
                {
                  title: 'Result 1',
                  url: 'https://docs.example.com/1',
                },
                {
                  title: 'Result 2',
                  url: 'https://docs.example.com/2',
                },
                {
                  title: 'Result 3',
                  url: 'https://docs.example.com/3',
                },
                {
                  title: 'Result 4',
                  url: 'https://docs.example.com/4',
                },
                {
                  title: 'Result 5',
                  url: 'https://docs.example.com/5',
                },
                {
                  title: 'Result 6',
                  url: 'https://docs.example.com/6',
                },
              ],
            },
          ],
        }),
        timestamp: 2,
      },
      {
        id: 'tool-2',
        role: 'tool',
        toolCallId: 'web_fetch',
        content: JSON.stringify({
          fetches: [
            {
              url: 'https://docs.example.com/codex',
              title: 'Codex docs',
              links: [
                {
                  title: 'Reference',
                  url: 'https://docs.example.com/codex/reference',
                },
                {
                  title: 'Guide',
                  url: 'https://docs.example.com/codex/guide',
                },
              ],
              content: fetchBody,
              charCount: 4800,
              truncated: true,
            },
          ],
        }),
        timestamp: 3,
      },
      {
        id: 'tool-3',
        role: 'tool',
        toolCallId: 'web_fetch',
        content: JSON.stringify({
          fetches: [
            {
              url: 'https://docs.example.com/claude-code',
              title: 'Claude Code docs',
              content: fetchBody,
              charCount: 4200,
              truncated: true,
            },
          ],
        }),
        timestamp: 4,
      },
    ]);

    const searchResult = JSON.parse(sanitized[1]!.content);
    expect(searchResult.provider).toBe('gemini');
    expect(searchResult.summary).toBeUndefined();
    expect(searchResult.searches).toEqual([
      {
        query: 'OpenAI Codex AGENTS.md',
        results: [
          {
            title: 'Result 1',
            url: 'https://docs.example.com/1',
          },
          {
            title: 'Result 2',
            url: 'https://docs.example.com/2',
          },
          {
            title: 'Result 3',
            url: 'https://docs.example.com/3',
          },
          {
            title: 'Result 4',
            url: 'https://docs.example.com/4',
          },
          {
            title: 'Result 5',
            url: 'https://docs.example.com/5',
          },
          {
            title: 'Result 6',
            url: 'https://docs.example.com/6',
          },
        ],
      },
    ]);

    const openAiFetch = JSON.parse(sanitized[2]!.content);
    expect(openAiFetch.fetches[0].links).toEqual([
      {
        title: 'Reference',
        url: 'https://docs.example.com/codex/reference',
      },
      {
        title: 'Guide',
        url: 'https://docs.example.com/codex/guide',
      },
    ]);
    expect(openAiFetch.fetches[0].content).toBeUndefined();
    expect(openAiFetch.fetches[0].contentExcerpt).toContain('# AGENTS.md');
    expect(openAiFetch.fetches[0].contentExcerpt).toContain('## Tail Marker');
    expect(openAiFetch.fetches[0].contentExcerpt).toContain('\n');
    expect(openAiFetch.fetches[0].contentExcerpt.length).toBeLessThanOrEqual(1600);

    const claudeFetch = JSON.parse(sanitized[3]!.content);
    expect(claudeFetch.fetches[0].content).toBeUndefined();
    expect(claudeFetch.fetches[0].contentExcerpt).toContain('# AGENTS.md');
    expect(claudeFetch.fetches[0].contentExcerpt).toContain('## Tail Marker');
    expect(claudeFetch.fetches[0].contentExcerpt.length).toBeLessThanOrEqual(1600);
  });

  it('can placeholder older tool results when historical compaction is explicitly requested', () => {
    const fetchBody = `# AGENTS.md

- repository instructions
- first fetched section

${'middle content\n'.repeat(300)}
## Tail Marker

tail`;
    const sanitized = sanitizeModelVisibleWorkingMessages(
      [
        {
          id: 'user-1',
          role: 'user',
          content: 'Compare official docs and cite checked URLs.',
          timestamp: 1,
        },
        {
          id: 'tool-1',
          role: 'tool',
          toolCallId: 'web_search',
        content: JSON.stringify({
          provider: 'gemini',
          searches: [
            {
              query: 'OpenAI Codex AGENTS.md',
            },
          ],
        }),
          timestamp: 2,
        },
        {
          id: 'tool-2',
          role: 'tool',
          toolCallId: 'web_fetch',
          content: JSON.stringify({
            fetches: [
              {
                url: 'https://docs.example.com/codex',
                title: 'Codex docs',
                content: fetchBody,
                charCount: 4800,
                truncated: true,
              },
            ],
          }),
          timestamp: 3,
        },
        {
          id: 'tool-3',
          role: 'tool',
          toolCallId: 'web_fetch',
          content: JSON.stringify({
            fetches: [
              {
                url: 'https://docs.example.com/claude-code',
                title: 'Claude Code docs',
                content: fetchBody,
                charCount: 4200,
                truncated: true,
              },
            ],
          }),
          timestamp: 4,
        },
      ],
      {
        compactHistoricalToolResults: true,
        recentToolResultsToKeep: 1,
      },
    );

    expect(sanitized[1]!.content).toContain('[compacted: historical web_search');
    expect(sanitized[2]!.content).toContain('[compacted: historical web_fetch');

    const claudeFetch = JSON.parse(sanitized[3]!.content);
    expect(claudeFetch.fetches[0].content).toBeUndefined();
    expect(claudeFetch.fetches[0].contentExcerpt).toContain('# AGENTS.md');
    expect(claudeFetch.fetches[0].contentExcerpt).toContain('## Tail Marker');
  });

  it('preserves structured persisted fetch links after array compaction', () => {
    const sanitized = sanitizeModelVisibleWorkingMessages([
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'web_fetch',
        content: JSON.stringify({
          fetches: {
            items: [
              {
                url: 'https://docs.example.com/page',
                title: 'Docs page',
                links: {
                  items: [
                    {
                      title: 'Reference',
                      url: 'https://docs.example.com/reference',
                    },
                    {
                      title: 'Guide',
                      url: 'https://docs.example.com/guide',
                    },
                  ],
                  omittedItems: 2,
                  totalItems: 4,
                },
                contentExcerpt: '# Docs page\n\nbody',
              },
            ],
            omittedItems: 1,
            totalItems: 2,
          },
        }),
        timestamp: 1,
      },
    ]);

    const parsed = JSON.parse(sanitized[0]!.content);
    expect(parsed.fetches).toEqual([
      {
        url: 'https://docs.example.com/page',
        title: 'Docs page',
        links: [
          {
            title: 'Reference',
            url: 'https://docs.example.com/reference',
          },
          {
            title: 'Guide',
            url: 'https://docs.example.com/guide',
          },
        ],
        contentExcerpt: '# Docs page\n\nbody',
      },
    ]);
  });

  it('preserves compacted batched web search results for later model turns', () => {
    const sanitized = sanitizeModelVisibleWorkingMessages([
      {
        id: 'user-1',
        role: 'user',
        content: 'Find the two official docs pages in parallel.',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'web_search',
        content: JSON.stringify({
          provider: 'gemini',
          searches: [
            {
              query: 'OpenAI Responses API official documentation',
              results: [
                {
                  title: 'platform.openai.com',
                  url: 'https://platform.openai.com/docs/api-reference/responses',
                },
              ],
            },
            {
              query: 'Gemini generateContent API official documentation',
              results: [
                {
                  title: 'ai.google.dev',
                  url: 'https://ai.google.dev/api/rest/v1beta/models/generateContent',
                },
              ],
            },
          ],
        }),
        timestamp: 2,
      },
    ]);

    const searchResult = JSON.parse(sanitized[1]!.content);
    expect(searchResult.provider).toBe('gemini');
    expect(searchResult.searches).toEqual([
      {
        query: 'OpenAI Responses API official documentation',
        results: [
          {
            title: 'platform.openai.com',
            url: 'https://platform.openai.com/docs/api-reference/responses',
          },
        ],
      },
      {
        query: 'Gemini generateContent API official documentation',
        results: [
          {
            title: 'ai.google.dev',
            url: 'https://ai.google.dev/api/rest/v1beta/models/generateContent',
          },
        ],
      },
    ]);
  });

  it('compacts terminal worker results into deliverable-first session payloads', () => {
    const sanitized = sanitizeModelVisibleWorkingMessages([
      {
        id: 'user-1',
        role: 'user',
        content: 'Delegate this task and use the worker result directly.',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'sessions_spawn',
        content: JSON.stringify({
          sessionId: 'sub-123',
          status: 'completed',
          hasOutput: true,
          output: 'Worker summary',
          workstreamId: 'worker-a',
          depth: 1,
          iterations: 3,
          lastToolResultPreview: 'preview',
          guidance: 'Use sessions_output later if needed.',
          toolsUsed: ['list_files', 'glob_search'],
        }),
        timestamp: 2,
      },
      {
        id: 'tool-2',
        role: 'tool',
        toolCallId: 'sessions_status',
        content: JSON.stringify({
          sessionId: 'sub-running',
          status: 'running',
          currentActivity: 'Reading files',
          idleMs: 1200,
          guidance: 'Poll again if needed.',
        }),
        timestamp: 3,
      },
    ]);

    const completed = JSON.parse(sanitized[1]!.content);
    expect(completed).toEqual({
      status: 'completed',
      hasOutput: true,
      output: 'Worker summary',
      toolsUsed: ['list_files', 'glob_search'],
    });

    const running = JSON.parse(sanitized[2]!.content);
    expect(running).toEqual({
      sessionId: 'sub-running',
      status: 'running',
      currentActivity: 'Reading files',
      idleMs: 1200,
    });
  });
});
