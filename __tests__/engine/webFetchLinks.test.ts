import {
  extractFetchedLinksFromHtml,
  extractFetchedLinksFromMarkdown,
} from '../../src/services/browser/core/linkExtractor';

describe('webFetchLinks', () => {
  it('prefers deeper same-host follow-up docs links over shallow generic links', () => {
    const links = extractFetchedLinksFromHtml(
      `
        <html>
          <body>
            <main>
              <article>
                <h1>Structured outputs</h1>
                <p>Use the Claude API to constrain model responses.</p>
              </article>
              <aside>
                <a href="/pricing">Pricing</a>
                <a href="/docs/en/agents-and-tools/tool-use/strict-tool-use">Strict tool use</a>
                <a href="/docs/en/agents-and-tools/tool-use/token-efficient-tool-use">Token-efficient tool use</a>
                <a href="https://github.com/example/repo">GitHub</a>
              </aside>
            </main>
          </body>
        </html>
      `,
      'https://platform.claude.com/docs/en/build-with-claude/structured-outputs',
      2,
    );

    expect(links).toEqual([
      {
        title: 'Strict tool use',
        url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use',
      },
      {
        title: 'Token-efficient tool use',
        url: 'https://platform.claude.com/docs/en/agents-and-tools/tool-use/token-efficient-tool-use',
      },
    ]);
  });

  it('preserves titled markdown links for fallback-fetched pages', () => {
    const links = extractFetchedLinksFromMarkdown(`
      # Example

      See [Responses API](https://developers.openai.com/api/docs/api-reference/responses)
      and [Structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).
    `);

    expect(links).toEqual([
      {
        title: 'Responses API',
        url: 'https://developers.openai.com/api/docs/api-reference/responses',
      },
      {
        title: 'Structured outputs guide',
        url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
      },
    ]);
  });
});
