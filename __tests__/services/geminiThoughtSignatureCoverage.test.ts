import { borrowThoughtSignatureFromReplayParts } from '../../src/services/llm/providers/gemini/contentParts';
import { hasGeminiToolTurnThoughtSignatureCoverage } from '../../src/services/llm/providers/gemini/thoughtSignatureCoverage';

describe('hasGeminiToolTurnThoughtSignatureCoverage', () => {
  it('requires signatures for Gemini 3 tool turns', () => {
    const covered = hasGeminiToolTurnThoughtSignatureCoverage({
      model: 'gemini-3.5-flash',
      pendingToolCalls: [{ raw: { thoughtSignature: 'sig-1' } }],
      providerReplay: {
        geminiParts: [
          {
            functionCall: { name: 'write_file', args: { path: 'a.txt' } },
            thoughtSignature: 'sig-1',
          },
        ],
      },
    });
    expect(covered).toBe(true);
  });

  it('borrows thought signatures from preceding replay thought parts', () => {
    const replayParts = [
      { text: 'plan', thought: true, thoughtSignature: 'sig-thought' },
      { functionCall: { name: 'read_file', args: { path: 'a.txt' } } },
    ];
    expect(borrowThoughtSignatureFromReplayParts(replayParts, 0)).toBe('sig-thought');
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{}],
        providerReplay: { geminiParts: replayParts },
      }),
    ).toBe(true);
  });

  it('passes parallel function calls when only the first call carries a signature', () => {
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: { thoughtSignature: 'sig-1' } }, { raw: {} }],
        providerReplay: {
          geminiParts: [
            {
              functionCall: { name: 'read_file', args: { path: 'a.txt' } },
              thoughtSignature: 'sig-1',
            },
            { functionCall: { name: 'read_file', args: { path: 'b.txt' } } },
          ],
        },
      }),
    ).toBe(true);
  });

  it('does not require signatures on parallel siblings beyond the first function call', () => {
    expect(
      hasGeminiToolTurnThoughtSignatureCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ raw: {} }, { raw: { thoughtSignature: 'sig-2' } }],
        providerReplay: {
          geminiParts: [
            { functionCall: { name: 'read_file', args: { path: 'a.txt' } } },
            {
              functionCall: { name: 'read_file', args: { path: 'b.txt' } },
              thoughtSignature: 'sig-2',
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it('reports missing coverage when replay and raw lack signatures', () => {
    const covered = hasGeminiToolTurnThoughtSignatureCoverage({
      model: 'gemini-3.5-flash',
      pendingToolCalls: [{ raw: { id: 'tc-1', type: 'function' } }],
      providerReplay: {
        geminiParts: [{ functionCall: { name: 'write_file', args: { path: 'a.txt' } } }],
      },
    });
    expect(covered).toBe(false);
  });
});
