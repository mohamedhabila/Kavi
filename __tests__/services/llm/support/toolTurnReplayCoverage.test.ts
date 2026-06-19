import { hasProviderToolTurnReplayCoverage } from '../../../../src/services/llm/support/toolTurnReplayCoverage';

describe('hasProviderToolTurnReplayCoverage', () => {
  it('delegates Gemini 3 tool turns to thought signature coverage', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [{ id: 'tc-1', name: 'read_file', raw: { thoughtSignature: 'sig-1' } }],
        providerReplay: {
          geminiParts: [
            {
              functionCall: { name: 'read_file', args: { path: 'a.txt' } },
              thoughtSignature: 'sig-1',
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('requires anthropic tool_use blocks with id and name in replay', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'claude-sonnet-4-6',
        pendingToolCalls: [{ id: 'toolu_01', name: 'read_file' }],
        providerReplay: {
          anthropicBlocks: [
            { type: 'tool_use', id: 'toolu_01', name: 'read_file', input: { path: 'a.txt' } },
          ],
        },
      }),
    ).toBe(true);

    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'claude-sonnet-4-6',
        pendingToolCalls: [{ id: 'toolu_01', name: 'read_file' }],
        providerReplay: {
          anthropicBlocks: [{ type: 'tool_use', id: '', name: 'read_file', input: {} }],
        },
      }),
    ).toBe(false);
  });

  it('requires OpenAI Responses function_call replay items with call_id and name', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'gpt-4.1-mini',
        pendingToolCalls: [{ id: 'call_abc', name: 'read_file' }],
        providerReplay: {
          openaiResponseOutput: [
            {
              type: 'function_call',
              call_id: 'call_abc',
              name: 'read_file',
              arguments: '{"path":"a.txt"}',
            },
          ],
        },
      }),
    ).toBe(true);

    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'gpt-4.1-mini',
        pendingToolCalls: [{ id: 'call_abc', name: 'read_file' }],
        providerReplay: {
          openaiResponseOutput: [
            { type: 'function_call', call_id: 'call_abc', name: '', arguments: '{}' },
          ],
        },
      }),
    ).toBe(false);
  });

  it('accepts OpenAI reasoning model tool turns when function call replay is complete', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'o3-mini',
        pendingToolCalls: [{ id: 'call_reason', name: 'read_file' }],
        providerReplay: {
          openaiResponseOutput: [
            { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'plan' }] },
            {
              type: 'function_call',
              call_id: 'call_reason',
              name: 'read_file',
              arguments: '{"path":"a.txt"}',
            },
          ],
        },
      }),
    ).toBe(true);

    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'o3-mini',
        pendingToolCalls: [{ id: 'call_reason', name: 'read_file' }],
        providerReplay: {
          openaiResponseOutput: [
            {
              type: 'function_call',
              call_id: 'call_reason',
              name: 'read_file',
              arguments: '{"path":"a.txt"}',
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('routes OpenRouter Gemini models through gemini replay coverage', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'google/gemini-3.5-flash',
        pendingToolCalls: [{ id: 'tc-1', name: 'read_file', raw: { thoughtSignature: 'sig-1' } }],
        providerReplay: {
          geminiParts: [
            {
              functionCall: { name: 'read_file', args: { path: 'a.txt' } },
              thoughtSignature: 'sig-1',
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('accepts compatible tool turns when pending calls carry id and name', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'deepseek-chat',
        pendingToolCalls: [{ id: 'tc-1', name: 'read_file' }],
      }),
    ).toBe(true);

    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'deepseek-chat',
        pendingToolCalls: [{ id: '', name: 'read_file' }],
      }),
    ).toBe(false);
  });

  it('returns true when there are no pending tool calls', () => {
    expect(
      hasProviderToolTurnReplayCoverage({
        model: 'gemini-3.5-flash',
        pendingToolCalls: [],
      }),
    ).toBe(true);
  });
});
