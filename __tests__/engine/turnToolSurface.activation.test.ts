import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { tools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('surfaces delegated session wait after a session producer has run', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      goals: [
        {
          id: 'delegated-work',
          title: 'Coordinate delegated worker',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['coordinate'],
        },
      ],
      observedToolNames: ['sessions_spawn'],
      workingMessages: [
        { id: 'u1', role: 'user', content: 'Delegate this and use the result.', timestamp: 1 },
        {
          id: 'a1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc1',
              name: 'sessions_spawn',
              arguments: '{"prompt":"do work"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 't1',
          role: 'tool',
          toolCallId: 'tc1',
          content: '{"status":"running","sessionId":"worker-1"}',
          timestamp: 3,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('sessions_spawn')).toBe(true);
    expect(selectedToolNames.has('sessions_wait')).toBe(true);
  });

  it('surfaces session delegation from worker evidence criteria without required capabilities', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      goals: [
        {
          id: 'worker-chain',
          title: 'Coordinate delegated worker',
          status: 'active',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          completionPolicy: 'blocking',
          successCriteria: ['evidence.prefix:worker', 'evidence.min:1'],
        },
      ],
      observedToolNames: [],
      workingMessages: [
        {
          id: 'u1',
          role: 'user',
          content: 'Delegate workstream worker-chain and record worker evidence.',
          timestamp: 1,
        },
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('sessions_spawn')).toBe(true);
  });

  it('keeps catalog-activated tools on surface across a new user turn via session cache', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      workingMessages: [
        userMessage('Find memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_recall',
            tools: [{ name: 'memory_recall' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        userMessage('Use memory recall now.'),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });

  it('drops non-core catalog activation on a new user turn without session cache', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      workingMessages: [
        userMessage('Find memory recall tooling.'),
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-search',
              name: 'tool_catalog',
              arguments: '{"query":"memory_recall"}',
              status: 'completed',
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            mode: 'search',
            query: 'memory_recall',
            tools: [{ name: 'memory_recall' }],
          }),
          toolCallId: 'tc-search',
          timestamp: 3,
        },
        userMessage('Use memory recall now.'),
      ],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_recall')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
  });

  it('surfaces session-activated tools without discovery pins', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: tools,
      observedToolNames: new Set<string>(),
      sessionActivatedToolNames: ['memory_recall'],
      workingMessages: [userMessage('Recall the stored fact.')],
    });

    const names = new Set(selected.map((tool) => tool.name));
    expect(names.has('memory_recall')).toBe(true);
    expect(names.has('tool_catalog')).toBe(true);
  });
});
