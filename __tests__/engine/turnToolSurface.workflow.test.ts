import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { SESSION_SPAWN_TOOL } from '../../src/engine/tools/builtin-definitions-sessions';
import { WAIT_TOOL } from '../../src/engine/tools/builtin-definitions-utility';
import { resourceFlowTools, userMessage } from '../helpers/turnToolSurfaceHarness';

describe('resolveDefaultGroundedRequestScopedTools', () => {
  it('keeps safe long-work primitives available without prompt-phrase routing', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: [SESSION_SPAWN_TOOL, WAIT_TOOL],
      workingMessages: [userMessage('Handle this task carefully.', 1)],
    });

    expect(selected.some((tool) => tool.name === 'wait')).toBe(true);
    expect(selected.some((tool) => tool.name === 'sessions_spawn')).toBe(true);
  });

  it('does not carry workflow resources past the immediately preceding user turn', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      workingMessages: [
        userMessage('Create an event.', 1),
        {
          id: 'assistant-calendar-create',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-calendar-create',
              name: 'calendar_create_event',
              arguments: '{}',
              status: 'completed',
            },
          ],
        },
        userMessage('Thanks.', 3),
        {
          id: 'assistant-thanks',
          role: 'assistant',
          content: 'You are welcome.',
          timestamp: 4,
        },
        userMessage('Start something else.', 5),
      ],
    });

    expect(selected.map((tool) => tool.name)).not.toContain('calendar_update_event');
  });

  it('does not treat a failed prior-turn producer as a resource', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      workingMessages: [
        userMessage('Create an event.', 1),
        {
          id: 'assistant-calendar-create-failed',
          role: 'assistant',
          content: '',
          timestamp: 2,
          toolCalls: [
            {
              id: 'tc-calendar-create-failed',
              name: 'calendar_create_event',
              arguments: '{}',
              status: 'failed',
            },
          ],
        },
        userMessage('Continue.', 3),
      ],
    });

    expect(selected.map((tool) => tool.name)).not.toContain('calendar_update_event');
  });

  it('keeps memory discovery activation additive with other activated tools', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: resourceFlowTools,
      sessionActivatedToolNames: ['memory_search', 'sms_compose'],
      workingMessages: [userMessage('Use what you remember, then text Avery.')],
    });

    const selectedToolNames = new Set(selected.map((tool) => tool.name));
    expect(selectedToolNames.has('memory_search')).toBe(true);
    expect(selectedToolNames.has('sms_compose')).toBe(true);
    expect(selectedToolNames.has('tool_catalog')).toBe(true);
    expect(selectedToolNames.has('tool_describe')).toBe(true);
  });
});
