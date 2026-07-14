// ---------------------------------------------------------------------------
// Tests — Provider Extractor (Optional Enrichment)
// ---------------------------------------------------------------------------
// Thin wrapper around consolidateTurn. Tests verify args forwarding and
// transparent error propagation to the queue/lifecycle layer.
// ---------------------------------------------------------------------------

const mockConsolidateTurn = jest.fn();
const mockBuildConsolidatorPrompt = jest.fn();

jest.mock('../../../src/services/memory/consolidator', () => ({
  consolidateTurn: (...args: any[]) => mockConsolidateTurn(...args),
  buildConsolidatorPrompt: (...args: any[]) => mockBuildConsolidatorPrompt(...args),
}));

import { extractProviderEnrichment } from '../../../src/services/memory/providerExtractor';

describe('extractProviderEnrichment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('forwards input and extraction options to consolidateTurn', async () => {
    const turnInput = {
      userMessage: 'Hello',
      assistantMessage: 'Hi',
    };
    const extractor = jest.fn().mockResolvedValue('{"newFacts":[]}');
    const signal = new AbortController().signal;
    mockConsolidateTurn.mockResolvedValue({
      status: 'empty_valid',
      result: {
        episodeSummary: null,
        newFacts: [],
        activeFocus: null,
        openThreads: [],
        notable: [],
      },
    });

    await extractProviderEnrichment(turnInput, { extractor, signal });

    expect(mockConsolidateTurn).toHaveBeenCalledWith(
      turnInput,
      expect.objectContaining({
        extractor,
        signal,
      }),
    );
  });

  it('returns the consolidated result on success', async () => {
    const expected = {
      status: 'valid',
      result: {
        episodeSummary: 'User likes tea',
        newFacts: [
          {
            version: 1,
            subjectRef: { kind: 'self' },
            predicate: 'prefers',
            value: 'tea',
            scope: 'global',
            importance: 0.7,
            confidence: 0.9,
            sourceMessageId: 'user-current',
            operation: 'record',
            assertionClass: 'current_direct',
            evidenceQuote: 'I prefer tea',
            sensitivity: 'personal',
          },
        ],
        activeFocus: 'Beverage preferences',
        openThreads: [],
        notable: [],
      },
    };
    mockConsolidateTurn.mockResolvedValue(expected);

    const result = await extractProviderEnrichment(
      {
        userMessage: 'I like tea',
        assistantMessage: 'Great',
      },
      { extractor: jest.fn() },
    );

    expect(result).toEqual(expected);
  });

  it.each([
    { status: 'provider_error', code: 'provider_request_failed' },
    { status: 'malformed', code: 'invalid_json' },
    { status: 'schema_invalid', code: 'invalid_field_type' },
  ])('returns the explicit $status outcome', async (expected) => {
    mockConsolidateTurn.mockResolvedValue(expected);

    await expect(
      extractProviderEnrichment(
        { userMessage: 'x', assistantMessage: 'y' },
        { extractor: jest.fn() },
      ),
    ).resolves.toEqual(expected);
  });
});
