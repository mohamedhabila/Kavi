import { sanitizeGraphOwnedModelContextMessages } from '../../src/engine/graph/modelContextSanitization';

describe('modelContextSanitization', () => {
  it('compacts web_fetch tool results to a bounded excerpt for later graph turns', () => {
    const fetchBody = `# AGENTS.md

- repository instructions
- first fetched section

${'middle content\n'.repeat(320)}
## Tail Marker

tail`;
    const sanitized = sanitizeGraphOwnedModelContextMessages([
      {
        id: 'user-1',
        role: 'user',
        content: 'Research whether the docs mention AGENTS.md',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'web_fetch',
        content: JSON.stringify({
          fetches: [
            {
              url: 'https://docs.example.com/agents',
              title: 'Docs',
              links: [
                {
                  title: 'Reference',
                  url: 'https://docs.example.com/agents/reference',
                },
                {
                  title: 'Guide',
                  url: 'https://docs.example.com/agents/guide',
                },
              ],
              content: fetchBody,
              charCount: 5200,
              truncated: true,
            },
          ],
        }),
        timestamp: 2,
      },
    ]);

    const parsed = JSON.parse(sanitized[1]!.content);
    expect(parsed.fetches[0].url).toBe('https://docs.example.com/agents');
    expect(parsed.fetches[0].title).toBe('Docs');
    expect(parsed.fetches[0].links).toEqual([
      {
        title: 'Reference',
        url: 'https://docs.example.com/agents/reference',
      },
      {
        title: 'Guide',
        url: 'https://docs.example.com/agents/guide',
      },
    ]);
    expect(parsed.fetches[0].content).toBeUndefined();
    expect(parsed.fetches[0].contentExcerpt).toContain('# AGENTS.md');
    expect(parsed.fetches[0].contentExcerpt).toContain('## Tail Marker');
    expect(parsed.fetches[0].contentExcerpt).toContain('\n');
    expect(parsed.fetches[0].contentExcerpt.length).toBeLessThanOrEqual(1600);
    expect(parsed.fetches[0].charCount).toBe(5200);
  });

  it('keeps only compact research summaries for web_search tool results', () => {
    const sanitized = sanitizeGraphOwnedModelContextMessages([
      {
        id: 'user-1',
        role: 'user',
        content: 'Find the docs',
        timestamp: 1,
      },
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'web_search',
        content: JSON.stringify({
          provider: 'brave',
          searches: [
            {
              query: 'official docs AGENTS.md',
              citations: [
                'https://docs.example.com/agents',
                'https://github.com/example/project',
                'https://docs.example.com/cli',
              ],
              results: [
                {
                  title: 'Docs',
                  url: 'https://docs.example.com/agents',
                  description: 'Official docs page',
                },
                {
                  title: 'Repo',
                  url: 'https://github.com/example/project',
                  description: 'Repository root',
                },
              ],
            },
          ],
        }),
        timestamp: 2,
      },
    ]);

    const parsed = JSON.parse(sanitized[1]!.content);
    expect(parsed.summary).toBeUndefined();
    expect(parsed.searches).toEqual([
      {
        query: 'official docs AGENTS.md',
        results: [
          {
            title: 'Docs',
            url: 'https://docs.example.com/agents',
          },
          {
            title: 'Repo',
            url: 'https://github.com/example/project',
          },
        ],
      },
    ]);
  });

  it('keeps compacted persisted search batches visible after array compaction', () => {
    const sanitized = sanitizeGraphOwnedModelContextMessages([
      {
        id: 'tool-1',
        role: 'tool',
        toolCallId: 'web_search',
        content: JSON.stringify({
          provider: 'brave',
          searches: {
            items: [
              {
                query: 'official docs',
                results: {
                  items: [
                    {
                      title: 'Docs',
                      url: 'https://docs.example.com/agents',
                    },
                    {
                      title: 'Guide',
                      url: 'https://docs.example.com/guide',
                    },
                  ],
                  omittedItems: 1,
                  totalItems: 3,
                },
              },
            ],
            omittedItems: 2,
            totalItems: 3,
          },
        }),
        timestamp: 1,
      },
    ]);

    const parsed = JSON.parse(sanitized[0]!.content);
    expect(parsed.searches).toEqual([
      {
        query: 'official docs',
        results: [
          {
            title: 'Docs',
            url: 'https://docs.example.com/agents',
          },
          {
            title: 'Guide',
            url: 'https://docs.example.com/guide',
          },
        ],
      },
    ]);
  });
});
