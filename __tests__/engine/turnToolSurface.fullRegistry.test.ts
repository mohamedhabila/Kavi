import { resolveDefaultGroundedRequestScopedTools } from '../../src/engine/graph/turnToolSurface';
import { TOOL_DEFINITIONS } from '../../src/engine/tools/definitions';
import {
  compressToolDefinitions,
  estimateAllToolTokens,
} from '../../src/engine/tools/toolManagerTokenBudget';
import type { Message } from '../../src/types/message';

const userMessage: Message = {
  id: 'user-1',
  role: 'user',
  content: 'Create and verify the requested local release artifact.',
  timestamp: 1,
};

describe('full-registry turn tool surface', () => {
  // The turn-1 surface is deliberately small — progressive disclosure is what keeps
  // the tool budget affordable on mobile. It is not, however, file-only: a general
  // assistant that cannot see web or read-only device state on the first turn pays a
  // discovery round-trip for the most common requests it receives, and often answers
  // from parametric knowledge instead. The budget below is the real constraint.
  it('keeps a new agentic turn on a compact core plus discovery surface', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: TOOL_DEFINITIONS,
      conversationMode: 'agentic',
      observedToolNames: new Set<string>(),
      workingMessages: [userMessage],
    });
    const names = new Set(selected.map((tool) => tool.name));
    const tokenEstimate = estimateAllToolTokens(compressToolDefinitions(selected));

    expect(names.has('tool_catalog')).toBe(true);
    expect(names.has('tool_describe')).toBe(true);

    // Everyday read paths are present from turn 1.
    expect(names.has('web_search')).toBe(true);
    expect(names.has('web_fetch')).toBe(true);
    expect(names.has('calendar_events')).toBe(true);
    expect(names.has('device_query')).toBe(true);

    // Mutations stay behind discovery and approval.
    expect(names.has('calendar_create_event')).toBe(false);
    expect(names.has('contacts_create')).toBe(false);
    expect(names.has('sms_compose')).toBe(false);
    expect(names.has('notification_send')).toBe(false);

    expect(selected.length).toBeLessThanOrEqual(22);
    expect(tokenEstimate).toBeLessThanOrEqual(5_000);
  });

  it('gives chitchat the same read-only everyday surface without graph or delegation tools', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: TOOL_DEFINITIONS,
      conversationMode: 'chitchat',
      observedToolNames: new Set<string>(),
      workingMessages: [userMessage],
    });
    const names = new Set(selected.map((tool) => tool.name));

    expect(names.has('web_search')).toBe(true);
    expect(names.has('calendar_events')).toBe(true);
    expect(names.has('update_goals')).toBe(false);
    expect(names.has('sessions_spawn')).toBe(false);
  });

  it('keeps an unscoped artifact goal out of unrelated mobile mutation domains', async () => {
    const selected = await resolveDefaultGroundedRequestScopedTools({
      allTools: TOOL_DEFINITIONS,
      conversationMode: 'agentic',
      observedToolNames: new Set<string>(),
      goals: [
        {
          id: 'release-artifact',
          title: 'Create release artifact',
          status: 'active',
          completionPolicy: 'blocking',
          dependencies: [],
          evidence: [],
          createdAt: 1,
          updatedAt: 1,
          requiredCapabilities: ['write'],
          successCriteria: ['evidence.file_hash:release-readiness-decision.md:sha256'],
        },
      ],
      workingMessages: [userMessage],
    });
    const names = new Set(selected.map((tool) => tool.name));
    const tokenEstimate = estimateAllToolTokens(compressToolDefinitions(selected));

    expect(names.has('write_file')).toBe(true);
    expect(names.has('calendar_create_event')).toBe(false);
    expect(names.has('contacts_create')).toBe(false);
    expect(names.has('notification_send')).toBe(false);
    expect(selected.length).toBeLessThanOrEqual(30);
    expect(tokenEstimate).toBeLessThanOrEqual(6_000);
  });
});
