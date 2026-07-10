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

  it('forwards input and options to consolidateTurn with persist=false', async () => {
    const turnInput = {
      userMessage: 'Hello',
      assistantMessage: 'Hi',
      conversationId: 'conv-1',
      threadId: 'conv-1',
    };
    const extractor = jest.fn().mockResolvedValue('{"newFacts":[]}');
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

    await extractProviderEnrichment(turnInput, { extractor, now: () => 42 });

    expect(mockConsolidateTurn).toHaveBeenCalledWith(
      turnInput,
      expect.objectContaining({ extractor, persist: false, now: expect.any(Function) }),
    );
  });

  it('returns the consolidated result on success', async () => {
    const expected = {
      status: 'valid',
      result: {
        episodeSummary: 'User likes tea',
        newFacts: [{ subject: 'user', predicate: 'prefers', value: 'tea' }],
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
        conversationId: 'c1',
        threadId: 'c1',
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
        { userMessage: 'x', assistantMessage: 'y', conversationId: 'c1', threadId: 'c1' },
        { extractor: jest.fn() },
      ),
    ).resolves.toEqual(expected);
  });
});
