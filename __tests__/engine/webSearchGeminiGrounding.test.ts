import { resolveGoogleGroundingRedirectUrl } from '../../src/services/browser/core/groundingRedirect';
import { extractGeminiGroundingResult } from '../../src/engine/tools/webSearchGeminiGrounding';

jest.mock('../../src/services/browser/core/groundingRedirect', () => {
  const actual = jest.requireActual('../../src/services/browser/core/groundingRedirect');
  return {
    ...actual,
    resolveGoogleGroundingRedirectUrl: jest.fn(),
  };
});

const mockResolveGoogleGroundingRedirectUrl =
  resolveGoogleGroundingRedirectUrl as jest.MockedFunction<
    typeof resolveGoogleGroundingRedirectUrl
  >;

describe('extractGeminiGroundingResult', () => {
  beforeEach(() => {
    mockResolveGoogleGroundingRedirectUrl.mockReset();
  });

  it('keeps unresolved grounding redirect urls instead of synthesizing homepage fallbacks', async () => {
    mockResolveGoogleGroundingRedirectUrl.mockImplementation(async (url) => url);

    const result = await extractGeminiGroundingResult({
      data: {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AQXbl123',
                    title: 'OpenAI Responses API',
                    domain: 'openai.com',
                  },
                },
              ],
            },
          },
        ],
      },
      count: 8,
    });

    expect(result.results).toEqual([
      {
        title: 'OpenAI Responses API',
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AQXbl123',
        description: '',
      },
    ]);
  });

  it('ignores searchEntryPoint suggestion links when building candidate pages', async () => {
    mockResolveGoogleGroundingRedirectUrl.mockImplementation(async (url) => url);

    const result = await extractGeminiGroundingResult({
      data: {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BQYcm456',
                    title: 'Gemini generateContent API',
                    domain: 'ai.google.dev',
                  },
                },
              ],
              searchEntryPoint: {
                renderedContent:
                  'Try node.js/TypeScript or https://platform.openai.com/docs/api-reference/chat',
              },
            },
            content: {
              parts: [
                {
                  text: 'https://platform.openai.com/docs/api-reference/chat should not be read from model answer text',
                },
              ],
            },
          },
        ],
      },
      count: 8,
    });

    expect(result.results).toEqual([
      {
        title: 'Gemini generateContent API',
        url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BQYcm456',
        description: '',
      },
    ]);
  });

  it('derives path-aware titles when grounding only provides a bare domain title', async () => {
    mockResolveGoogleGroundingRedirectUrl.mockResolvedValue(
      'https://developers.openai.com/api/docs/guides/migrate-to-responses',
    );

    const result = await extractGeminiGroundingResult({
      data: {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/CQZdn789',
                    title: 'openai.com',
                    domain: 'openai.com',
                  },
                },
              ],
            },
          },
        ],
      },
      count: 8,
    });

    expect(result.results).toEqual([
      {
        title: 'developers.openai.com / api / docs / guides / migrate to responses',
        url: 'https://developers.openai.com/api/docs/guides/migrate-to-responses',
        description: '',
      },
    ]);
  });

  it('keeps deeper url path context when grounding returns a shallow breadcrumb title', async () => {
    mockResolveGoogleGroundingRedirectUrl.mockResolvedValue(
      'https://developers.openai.com/api/reference/responses/overview',
    );

    const result = await extractGeminiGroundingResult({
      data: {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/DQZen012',
                    title: 'developers.openai.com / responses / overview',
                    domain: 'developers.openai.com',
                  },
                },
              ],
            },
          },
        ],
      },
      count: 8,
    });

    expect(result.results).toEqual([
      {
        title: 'developers.openai.com / api / reference / responses / overview',
        url: 'https://developers.openai.com/api/reference/responses/overview',
        description: '',
      },
    ]);
  });

  it('prefers grounding chunks with stronger support scores before weaker raw-order rows', async () => {
    mockResolveGoogleGroundingRedirectUrl.mockImplementation(async (url) => {
      if (url.endsWith('/A')) {
        return 'https://developers.openai.com/cookbook/examples/structured_outputs_intro';
      }
      if (url.endsWith('/B')) {
        return 'https://developers.openai.com/api/docs/guides/structured-outputs';
      }
      return url;
    });

    const result = await extractGeminiGroundingResult({
      data: {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A',
                    title: 'developers.openai.com / cookbook / examples / structured outputs intro',
                    domain: 'developers.openai.com',
                  },
                },
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/B',
                    title: 'developers.openai.com / api / docs / guides / structured outputs',
                    domain: 'developers.openai.com',
                  },
                },
              ],
              groundingSupports: [
                {
                  groundingChunkIndices: [1],
                  confidenceScores: [0.93],
                },
                {
                  groundingChunkIndices: [0],
                  confidenceScores: [0.31],
                },
              ],
            },
          },
        ],
      },
      count: 8,
    });

    expect(result.results).toEqual([
      {
        title: 'developers.openai.com / api / docs / guides / structured outputs',
        url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
        description: '',
      },
      {
        title: 'developers.openai.com / cookbook / examples / structured outputs intro',
        url: 'https://developers.openai.com/cookbook/examples/structured_outputs_intro',
        description: '',
      },
    ]);
  });

  it('aggregates grounding chunks across candidates instead of only reading candidate zero', async () => {
    mockResolveGoogleGroundingRedirectUrl.mockImplementation(async (url) => {
      if (url.endsWith('/A')) {
        return 'https://developers.openai.com/cookbook/examples/structured_outputs_intro';
      }
      if (url.endsWith('/B')) {
        return 'https://developers.openai.com/api/docs/guides/structured-outputs';
      }
      return url;
    });

    const result = await extractGeminiGroundingResult({
      data: {
        candidates: [
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/A',
                    title: 'developers.openai.com / cookbook / examples / structured outputs intro',
                    domain: 'developers.openai.com',
                  },
                },
              ],
              groundingSupports: [
                {
                  groundingChunkIndices: [0],
                  confidenceScores: [0.2],
                },
              ],
            },
          },
          {
            groundingMetadata: {
              groundingChunks: [
                {
                  web: {
                    uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/B',
                    title: 'developers.openai.com / api / docs / guides / structured outputs',
                    domain: 'developers.openai.com',
                  },
                },
              ],
              groundingSupports: [
                {
                  groundingChunkIndices: [0],
                  confidenceScores: [0.95],
                },
              ],
            },
          },
        ],
      },
      count: 8,
    });

    expect(result.results).toEqual([
      {
        title: 'developers.openai.com / api / docs / guides / structured outputs',
        url: 'https://developers.openai.com/api/docs/guides/structured-outputs',
        description: '',
      },
      {
        title: 'developers.openai.com / cookbook / examples / structured outputs intro',
        url: 'https://developers.openai.com/cookbook/examples/structured_outputs_intro',
        description: '',
      },
    ]);
  });
});
