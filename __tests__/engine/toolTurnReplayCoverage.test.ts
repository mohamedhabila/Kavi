import { hasProviderToolTurnReplayCoverage } from '../../src/services/llm/support/toolTurnReplayCoverage';

describe('hasProviderToolTurnReplayCoverage', () => {
  it('requires Gemini 3 signatures when replay metadata is absent', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'gemini-3-flash-preview',
        pendingToolCalls: [
          {
            id: 'tc1',
            name: 'read_file',
            arguments: '{"path":"test.txt"}',
          },
        ],
        providerReplay: undefined,
      }),
    ).toBe(false);
  });
});