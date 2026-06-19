import { finalizeGeminiStreamToolState } from '../../../../../src/services/llm/providers/gemini/streamParts';

describe('finalizeGeminiStreamToolState', () => {
  it('attaches turn-level thought signature only to the first parallel function call', () => {
    const { replayParts, toolCalls } = finalizeGeminiStreamToolState({
      parts: [
        { text: 'plan', thought: true, thoughtSignature: 'sig-turn' },
        {
          functionCall: { name: 'read_file', args: { path: 'a.txt' } },
        },
        {
          functionCall: { name: 'read_file', args: { path: 'b.txt' } },
        },
      ],
      safeJsonParse: (value) => value,
    });

    expect(replayParts).toHaveLength(3);
    expect(replayParts[1]?.thoughtSignature).toBe('sig-turn');
    expect(replayParts[2]?.thoughtSignature).toBeUndefined();
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]?.raw?.thoughtSignature).toBe('sig-turn');
    expect(toolCalls[1]?.raw?.thoughtSignature).toBeUndefined();
  });

  it('merges a terminal empty-text signature carrier onto the first function call', () => {
    const { replayParts, toolCalls } = finalizeGeminiStreamToolState({
      parts: [
        { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } } },
        { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
        { text: '', thoughtSignature: 'sig-terminal' },
      ],
      safeJsonParse: (value) => value,
    });

    expect(replayParts[0]?.thoughtSignature).toBe('sig-terminal');
    expect(replayParts[1]?.thoughtSignature).toBeUndefined();
    expect(toolCalls[0]?.raw?.thoughtSignature).toBe('sig-terminal');
    expect(toolCalls[1]?.raw?.thoughtSignature).toBeUndefined();
  });

  it('merges a non-adjacent empty-text signature carrier onto the first function call', () => {
    const { replayParts, toolCalls } = finalizeGeminiStreamToolState({
      parts: [
        { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-a' } } },
        { functionCall: { name: 'memory_recall', args: { subject: 'e2e-state-b' } } },
        { text: 'ignored' },
        { text: '', thoughtSignature: 'sig-separated' },
      ],
      safeJsonParse: (value) => value,
    });

    expect(replayParts[0]?.thoughtSignature).toBe('sig-separated');
    expect(replayParts[1]?.thoughtSignature).toBeUndefined();
    expect(toolCalls[0]?.raw?.thoughtSignature).toBe('sig-separated');
  });

  it('borrows a thought-part signature that precedes an unsigned function call', () => {
    const { replayParts, toolCalls } = finalizeGeminiStreamToolState({
      parts: [
        { text: 'planning', thought: true, thoughtSignature: 'sig-thought' },
        { functionCall: { name: 'read_file', args: { path: 'artifacts/chain-proof.txt' } } },
      ],
      safeJsonParse: (value) => value,
    });

    expect(replayParts[0]?.thoughtSignature).toBe('sig-thought');
    expect(replayParts[1]?.thoughtSignature).toBe('sig-thought');
    expect(toolCalls[0]?.raw?.thoughtSignature).toBe('sig-thought');
  });

  it('resolves sequential step-2 stream shape after tool results settle', () => {
    const { replayParts, toolCalls } = finalizeGeminiStreamToolState({
      parts: [
        { functionCall: { name: 'list_files', args: { path: 'artifacts/' } } },
        { text: '', thoughtSignature: 'sig-step-2' },
      ],
      safeJsonParse: (value) => value,
    });

    expect(replayParts[0]?.thoughtSignature).toBe('sig-step-2');
    expect(toolCalls[0]?.raw?.thoughtSignature).toBe('sig-step-2');
    expect(toolCalls[0]?.name).toBe('list_files');
  });

  it('generates deterministic shape-sensitive fallback ids for id-less stream finalizations', () => {
    const first = finalizeGeminiStreamToolState({
      parts: [{ functionCall: { name: 'memory_recall', args: { subject: 'a' } } }],
      safeJsonParse: (value) => value,
    });
    const repeatedFirst = finalizeGeminiStreamToolState({
      parts: [{ functionCall: { name: 'memory_recall', args: { subject: 'a' } } }],
      safeJsonParse: (value) => value,
    });
    const second = finalizeGeminiStreamToolState({
      parts: [{ functionCall: { name: 'write_file', args: { path: 'a.txt' } } }],
      safeJsonParse: (value) => value,
    });

    const firstId = first.toolCalls[0]?.id;
    const repeatedFirstId = repeatedFirst.toolCalls[0]?.id;
    const secondId = second.toolCalls[0]?.id;
    expect(firstId).toMatch(/^gemini-call-\d+-[0-9a-f]{8}$/);
    expect(repeatedFirstId).toBe(firstId);
    expect(secondId).toMatch(/^gemini-call-\d+-[0-9a-f]{8}$/);
    expect(secondId).not.toBe(firstId);
  });

  it('drops undeclared stream function calls before replay or execution', () => {
    const finalized = finalizeGeminiStreamToolState({
      declaredToolNames: new Set(['memory_recall']),
      parts: [
        { functionCall: { name: 'gemini-call-0-3486f50d', args: {} } },
        { functionCall: { name: 'memory_recall', args: { subject: 'locomo-user' } } },
      ],
      safeJsonParse: (value) => value,
    });

    expect(finalized.toolCalls).toHaveLength(1);
    expect(finalized.toolCalls[0]?.name).toBe('memory_recall');
    expect(finalized.replayParts).toHaveLength(1);
    expect(finalized.replayParts[0]?.functionCall?.name).toBe('memory_recall');
  });
});
