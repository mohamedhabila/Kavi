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
    expect(names.has('calendar_list')).toBe(false);
    expect(names.has('device_query')).toBe(false);
    expect(selected.length).toBeLessThanOrEqual(16);
    expect(tokenEstimate).toBeLessThanOrEqual(3_500);
  });

  it('keeps an unscoped artifact goal out of unrelated mobile domains', async () => {
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
    expect(selected.length).toBeLessThanOrEqual(24);
    expect(tokenEstimate).toBeLessThanOrEqual(4_500);
  });
});
