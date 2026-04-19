import {
  areSameLogicalToolCall,
  findMatchingToolCallIndex,
  findMatchingToolCallIndexWithinMessage,
} from '../../src/utils/toolCallMatching';
import type { ToolCall } from '../../src/types';

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tool-1',
    name: 'read_file',
    arguments: '{"path":"README.md"}',
    status: 'completed',
    ...overrides,
  };
}

describe('toolCallMatching', () => {
  it('matches the same OpenAI tool call across item-id and call-id upgrades', () => {
    const initial = makeToolCall({
      id: 'fc_1',
      raw: {
        id: 'fc_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
        _openai: {
          itemId: 'fc_1',
          outputIndex: 0,
        },
      },
    });

    const upgraded = makeToolCall({
      id: 'call_1',
      status: 'running',
      raw: {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
        _openai: {
          itemId: 'fc_1',
          callId: 'call_1',
          outputIndex: 0,
        },
      },
    });

    expect(areSameLogicalToolCall(initial, upgraded)).toBe(true);
    expect(findMatchingToolCallIndex([initial], upgraded)).toBe(0);
  });

  it('does not match distinct OpenAI tool calls that reuse the same output index', () => {
    const existing = makeToolCall({
      id: 'call_1',
      raw: {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
        _openai: {
          itemId: 'fc_1',
          callId: 'call_1',
          outputIndex: 0,
        },
      },
    });

    const incoming = makeToolCall({
      id: 'call_2',
      name: 'write_file',
      arguments: '{"path":"notes.txt"}',
      raw: {
        id: 'call_2',
        type: 'function',
        function: {
          name: 'write_file',
          arguments: '{"path":"notes.txt"}',
        },
        _openai: {
          itemId: 'fc_2',
          callId: 'call_2',
          outputIndex: 0,
        },
      },
    });

    expect(areSameLogicalToolCall(existing, incoming)).toBe(false);
    expect(findMatchingToolCallIndex([existing], incoming)).toBe(-1);
  });

  it('does not treat repeated synthetic Gemini placeholder ids as the same call across turns', () => {
    const existing = makeToolCall({
      id: 'gemini-call-0',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
        index: 0,
      },
    });

    const incoming = makeToolCall({
      id: 'gemini-call-0',
      arguments: '{"path":"package.json"}',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"package.json"}',
        },
        index: 0,
      },
    });

    expect(areSameLogicalToolCall(existing, incoming)).toBe(false);
    expect(findMatchingToolCallIndex([existing], incoming)).toBe(-1);
  });

  it('treats an exact synthetic placeholder id as the same call within one message update path', () => {
    const existing = makeToolCall({
      id: 'gemini-call-0',
      status: 'pending',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    });

    const incoming = makeToolCall({
      id: 'gemini-call-0',
      status: 'running',
      raw: {
        id: 'gemini-call-0',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: '{"path":"README.md"}',
        },
      },
    });

    expect(areSameLogicalToolCall(existing, incoming)).toBe(false);
    expect(findMatchingToolCallIndexWithinMessage([existing], incoming)).toBe(0);
  });
});
