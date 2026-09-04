import {
  filterToolsForConversationMode,
  isToolAllowedForConversationMode,
} from '../../src/engine/tools/conversationModeToolAuthority';
import type { ToolDefinition } from '../../src/types/tool';

function tool(
  name: string,
  category?: NonNullable<ToolDefinition['contract']>['category'],
): ToolDefinition {
  return {
    name,
    description: name,
    input_schema: { type: 'object', properties: {} },
    ...(category ? { contract: { category } } : {}),
  };
}

describe('conversation-mode tool authority', () => {
  const ordinaryTools = [
    tool('memory_recall', 'memory'),
    tool('memory_remember', 'memory'),
    tool('memory_preserve_source', 'memory'),
    tool('memory_manage', 'memory'),
    tool('memory_forget', 'memory'),
    tool('web_search', 'web'),
    tool('calendar_create_event', 'calendar'),
  ];
  const orchestrationTools = [
    tool('update_goals', 'goal'),
    tool('sessions_spawn', 'sessions'),
    tool('sessions_history', 'sessions'),
    tool('custom_worker_control', 'sessions'),
  ];

  it('keeps ordinary assistant and grounded memory tools but removes orchestration from chitchat', () => {
    const filtered = filterToolsForConversationMode(
      [...ordinaryTools, ...orchestrationTools],
      'chitchat',
    );

    expect(filtered.map(({ name }) => name)).toEqual(ordinaryTools.map(({ name }) => name));
  });

  it('retains the complete tool inventory in agentic mode', () => {
    const tools = [...ordinaryTools, ...orchestrationTools];

    expect(filterToolsForConversationMode(tools, 'agentic')).toEqual(tools);
  });

  it('classifies purely by contract category, so a tool with no contract at all is not excluded', () => {
    // Every registered tool carries a contract in production (see
    // `builtin-definitions-sessions.ts`'s real `sessions_wait`, which declares
    // `category: 'sessions'`). This checks the deliberate fail-open default for the
    // hypothetical case a tool ships without one: classification never falls back to
    // sniffing the name.
    expect(isToolAllowedForConversationMode(tool('sessions_wait'), 'chitchat')).toBe(true);
    expect(isToolAllowedForConversationMode(tool('sessions_wait', 'sessions'), 'chitchat')).toBe(
      false,
    );
  });

  it('keeps generic asynchronous waiting available in chitchat', () => {
    expect(isToolAllowedForConversationMode(tool('wait', 'async_wait'), 'chitchat')).toBe(true);
  });
});
