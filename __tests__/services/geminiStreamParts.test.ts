import { mergeGeminiStreamCandidateParts } from '../../src/services/llm/core/streaming/candidateMerger';
import { finalizeGeminiStreamToolState } from '../../src/services/llm/providers/gemini/streamParts';

describe('mergeGeminiStreamCandidateParts', () => {
  it('accumulates thought and answer parts from incremental stream chunks', () => {
    const merged = mergeGeminiStreamCandidateParts(
      [{ text: 'Let me think', thought: true }],
      [{ text: 'Answer' }],
    );

    expect(merged).toEqual([{ text: 'Let me think', thought: true }, { text: 'Answer' }]);
  });

  it('replaces cumulative text growth at the same part index', () => {
    let merged = mergeGeminiStreamCandidateParts([], [{ text: 'Hello' }]);
    merged = mergeGeminiStreamCandidateParts(merged, [{ text: 'Hello world' }]);
    merged = mergeGeminiStreamCandidateParts(merged, [{ text: 'Hello world from Gemini' }]);

    expect(merged).toEqual([{ text: 'Hello world from Gemini' }]);
  });

  it('keeps only the final function call when the tool choice is revised mid-stream', () => {
    let merged = mergeGeminiStreamCandidateParts(
      [],
      [{ functionCall: { id: 'tc1', name: 'read_file', args: { path: 'draft.txt' } } }],
    );
    merged = mergeGeminiStreamCandidateParts(merged, [
      { functionCall: { id: 'tc1', name: 'text_search', args: { query: 'draft' } } },
    ]);
    merged = mergeGeminiStreamCandidateParts(merged, [
      { functionCall: { id: 'tc1', name: 'read_file', args: { path: 'final.txt' } } },
    ]);

    expect(merged).toEqual([
      { functionCall: { id: 'tc1', name: 'read_file', args: { path: 'final.txt' } } },
    ]);
  });
});

describe('finalizeGeminiStreamToolState', () => {
  it('borrows thought signatures from trailing empty signature carrier parts', () => {
    const finalized = finalizeGeminiStreamToolState({
      parts: [
        {
          functionCall: {
            name: 'list_files',
            args: { path: 'artifacts/' },
          },
        },
        {
          text: '',
          thoughtSignature: 'sig-trailing-carrier',
        },
      ],
      safeJsonParse: (value) => value,
    });

    expect(finalized.replayParts[0]?.thoughtSignature).toBe('sig-trailing-carrier');
    expect(finalized.replayParts[0]?.functionCall?.id).toMatch(
      /^gemini-call-\d+-[0-9a-f]{8}$/,
    );
    expect(finalized.toolCalls[0]?.raw?.thoughtSignature).toBe('sig-trailing-carrier');
  });
  it('dedupes duplicate streamed function calls and keeps the signed copy', () => {
    const finalized = finalizeGeminiStreamToolState({
      parts: [
        {
          functionCall: {
            name: 'write_file',
            args: { path: 'artifacts/item-a.txt', content: 'ITEM-A-E2E' },
          },
          thoughtSignature: 'sig-primary',
        },
        {
          functionCall: {
            name: 'write_file',
            args: { path: 'artifacts/item-a.txt', content: 'ITEM-A-E2E' },
          },
        },
        { text: '' },
      ],
      safeJsonParse: (value) => value,
    });

    expect(finalized.toolCalls).toHaveLength(1);
    expect(finalized.replayParts).toHaveLength(1);
    expect(finalized.replayParts[0]?.functionCall?.id).toMatch(
      /^gemini-call-\d+-[0-9a-f]{8}$/,
    );
    expect(finalized.replayParts[0]?.thoughtSignature).toBe('sig-primary');
    expect(finalized.toolCalls[0]?.raw?.thoughtSignature).toBe('sig-primary');
  });

  it('keeps parallel function calls with identical names and args when ids differ', () => {
    const finalized = finalizeGeminiStreamToolState({
      parts: [
        {
          functionCall: {
            id: 'tc-a',
            name: 'memory_recall',
            args: { subject: 'shared' },
          },
          thoughtSignature: 'sig-primary',
        },
        {
          functionCall: {
            id: 'tc-b',
            name: 'memory_recall',
            args: { subject: 'shared' },
          },
        },
      ],
      safeJsonParse: (value) => value,
    });

    expect(finalized.toolCalls.map((call) => call.id)).toEqual(['tc-a', 'tc-b']);
    expect(finalized.replayParts.map((part) => part.functionCall?.id)).toEqual(['tc-a', 'tc-b']);
  });

  it('borrows thought signatures from empty signature carrier parts', () => {
    const finalized = finalizeGeminiStreamToolState({
      parts: [
        {
          text: '',
          thought: true,
          thoughtSignature: 'sig-thought-carrier',
        },
        {
          functionCall: {
            name: 'read_file',
            args: { path: 'artifacts/e2e.txt' },
          },
        },
      ],
      safeJsonParse: (value) => value,
    });

    expect(finalized.replayParts[0]?.thoughtSignature).toBe('sig-thought-carrier');
    expect(finalized.replayParts[1]?.thoughtSignature).toBe('sig-thought-carrier');
  });
});
