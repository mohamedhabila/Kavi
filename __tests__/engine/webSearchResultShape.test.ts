import { normalizeWebSearchResults } from '../../src/services/browser/core/resultShape';

describe('normalizeWebSearchResults', () => {
  it('preserves provider order for returned candidate urls', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'Responses endpoint',
          url: 'https://api.openai.com/v1/responses',
          description: 'Machine endpoint',
        },
        {
          title: 'Responses API',
          url: 'https://platform.openai.com/docs/api-reference/responses',
          description: 'Human-readable docs page',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'Responses endpoint',
        url: 'https://api.openai.com/v1/responses',
        description: 'Machine endpoint',
      },
      {
        title: 'Responses API',
        url: 'https://platform.openai.com/docs/api-reference/responses',
        description: 'Human-readable docs page',
      },
    ]);
    expect(normalized.citations).toEqual([
      'https://api.openai.com/v1/responses',
      'https://platform.openai.com/docs/api-reference/responses',
    ]);
  });

  it('keeps both root and specific pages when the provider returned both', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'Google AI',
          url: 'https://ai.google.dev',
          description: 'Top level site',
        },
        {
          title: 'GenerateContent API',
          url: 'https://ai.google.dev/api/generate-content',
          description: 'Specific docs page',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'Google AI',
        url: 'https://ai.google.dev',
        description: 'Top level site',
      },
      {
        title: 'GenerateContent API',
        url: 'https://ai.google.dev/api/generate-content',
        description: 'Specific docs page',
      },
    ]);
  });

  it('replaces bare-domain titles with path-aware titles for pathful urls', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'openai.com',
          url: 'https://developers.openai.com/api/docs/guides/migrate-to-responses',
          description: '',
        },
        {
          title: 'google.dev',
          url: 'https://ai.google.dev/api/generate-content',
          description: '',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'developers.openai.com / api / docs / guides / migrate to responses',
        url: 'https://developers.openai.com/api/docs/guides/migrate-to-responses',
        description: '',
      },
      {
        title: 'ai.google.dev / api / generate content',
        url: 'https://ai.google.dev/api/generate-content',
        description: '',
      },
    ]);
  });

  it('drops template urls only when concrete urls exist', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'Template endpoint',
          url: 'https://generativelanguage.googleapis.com/v1beta/{model=models/*}:generateContent',
          description: '',
        },
        {
          title: 'GenerateContent API',
          url: 'https://ai.google.dev/api/generate-content',
          description: '',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'GenerateContent API',
        url: 'https://ai.google.dev/api/generate-content',
        description: '',
      },
    ]);
  });

  it('backfills results from citations when structured rows are absent', () => {
    const normalized = normalizeWebSearchResults({
      citations: [
        'https://ai.google.dev/api/generate-content',
        'https://ai.google.dev/api/generate-content',
      ],
      fallbackDescription: 'Fallback provider text',
    });

    expect(normalized.results).toEqual([
      {
        title: 'ai.google.dev / api / generate content',
        url: 'https://ai.google.dev/api/generate-content',
        description: 'Fallback provider text',
      },
    ]);
    expect(normalized.citations).toEqual(['https://ai.google.dev/api/generate-content']);
  });

  it('keeps deeper docs path context in fallback titles for reference-style urls', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'developers.openai.com',
          url: 'https://developers.openai.com/api/reference/responses/overview',
          description: '',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'developers.openai.com / api / reference / responses / overview',
        url: 'https://developers.openai.com/api/reference/responses/overview',
        description: '',
      },
    ]);
  });

  it('prefers deeper url-derived breadcrumb titles when provider breadcrumbs are a shallow suffix', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'developers.openai.com / responses / overview',
          url: 'https://developers.openai.com/api/reference/responses/overview',
          description: '',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'developers.openai.com / api / reference / responses / overview',
        url: 'https://developers.openai.com/api/reference/responses/overview',
        description: '',
      },
    ]);
  });

  it('keeps human-readable provider titles when they are not url breadcrumbs', () => {
    const normalized = normalizeWebSearchResults({
      results: [
        {
          title: 'Responses API overview',
          url: 'https://developers.openai.com/api/reference/responses/overview',
          description: '',
        },
      ],
    });

    expect(normalized.results).toEqual([
      {
        title: 'Responses API overview',
        url: 'https://developers.openai.com/api/reference/responses/overview',
        description: '',
      },
    ]);
  });
});
