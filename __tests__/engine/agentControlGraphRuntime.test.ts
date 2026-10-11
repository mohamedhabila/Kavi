import { createAgentControlGraphRuntime } from '../../src/engine/graph/agentControlGraphRuntime';

function createRuntime() {
  return createAgentControlGraphRuntime({
    callbacks: {
      onAssistantMessage: jest.fn(),
      onStateChange: jest.fn(),
      onError: jest.fn(),
      onDone: jest.fn(),
    },
    conversationId: 'conversation-1',
    initialMessages: [],
  });
}

describe('agent control graph runtime discovery activation', () => {
  it('replaces stale discovery-only pins with the latest successful result', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['calendar_list', 'read_file'],
        updateMode: 'replace',
        reason: 'tool_catalog:discovery',
      },
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['memory_recall'],
        updateMode: 'replace',
        reason: 'tool_catalog:discovery',
      },
    ]);

    expect(runtime.snapshot.sessionActivatedToolNames).toEqual(['memory_recall']);
  });

  it('clears stale discovery-only pins when the latest result is empty', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['calendar_list'],
        updateMode: 'replace',
      },
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: [],
        updateMode: 'replace',
      },
    ]);

    expect(runtime.snapshot.sessionActivatedToolNames).toBeUndefined();
  });

  it('keeps sibling catalog results when one tool is described in detail', () => {
    const runtime = createRuntime();

    runtime.applyEvents([
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['mcp__ledger__get_record', 'mcp__ledger__put_record'],
        updateMode: 'replace',
      },
      {
        type: 'SESSION_ACTIVATED_TOOLS_UPDATED',
        toolNames: ['mcp__ledger__put_record'],
        updateMode: 'merge',
      },
    ]);

    expect(runtime.snapshot.sessionActivatedToolNames).toEqual([
      'mcp__ledger__get_record',
      'mcp__ledger__put_record',
    ]);
  });
});
