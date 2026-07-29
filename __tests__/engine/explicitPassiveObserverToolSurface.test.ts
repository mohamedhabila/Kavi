import { resolveExplicitPassiveObserverToolNames } from '../../src/engine/graph/explicitPassiveObserverToolSurface';
import { resolveModelTurnGroundedToolSurface } from '../../src/engine/graph/modelTurn/resolveGroundedToolSurface';
import { WAIT_TOOL } from '../../src/engine/tools/builtin-definitions-utility';
import type { ToolDefinition } from '../../src/types/tool';
import { tools } from '../helpers/turnToolSurfaceHarness';

const MUTATING_TOOL: ToolDefinition = {
  name: 'write_file',
  description: 'Write a file.',
  input_schema: { type: 'object', properties: {} },
  contract: {
    category: 'workspace_files',
    capabilities: ['write'],
    resourceKinds: ['conversation_workspace'],
    sideEffects: ['local_artifact'],
    workflowStages: ['persist_artifact'],
  },
};

function messages(content: string) {
  return [{ id: 'u1', role: 'user' as const, content, timestamp: 2 }];
}

describe('explicit passive-observer tool activation', () => {
  it('activates an explicitly requested generic wait tool in agentic mode', () => {
    expect(
      resolveExplicitPassiveObserverToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Call the `wait` tool with numeric ms 2000 three times.',
        tools: [WAIT_TOOL],
      }),
    ).toEqual(['wait']);

    expect(
      resolveExplicitPassiveObserverToolNames({
        conversationMode: 'agentic',
        latestUserMessageText:
          'For each checkpoint, call the generic wait tool once with numeric ms 60000.',
        tools: [WAIT_TOOL],
      }),
    ).toEqual(['wait']);
  });

  it('does not confuse sessions_wait with the generic wait tool', () => {
    expect(
      resolveExplicitPassiveObserverToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Call sessions_wait for the delegated worker.',
        tools: [WAIT_TOOL],
      }),
    ).toEqual([]);
  });

  it('rejects negated, non-agentic, and mutating tool requests', () => {
    expect(
      resolveExplicitPassiveObserverToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Do not use the wait tool.',
        tools: [WAIT_TOOL],
      }),
    ).toEqual([]);
    expect(
      resolveExplicitPassiveObserverToolNames({
        conversationMode: 'chitchat',
        latestUserMessageText: 'Call wait now.',
        tools: [WAIT_TOOL],
      }),
    ).toEqual([]);
    expect(
      resolveExplicitPassiveObserverToolNames({
        conversationMode: 'agentic',
        latestUserMessageText: 'Call write_file now.',
        tools: [MUTATING_TOOL],
      }),
    ).toEqual([]);
  });

  it('grounds the explicitly requested wait tool for model dispatch', async () => {
    const latestUserMessageText =
      'Use the wait tool with numeric ms 2000 exactly three times sequentially.';
    const result = await resolveModelTurnGroundedToolSurface({
      allTools: [...tools, WAIT_TOOL],
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set(),
      latestUserMessageText,
      trackedAsyncOperations: new Map(),
      workingMessages: messages(latestUserMessageText),
    });

    expect(result.groundedRequestScopedTools.map((tool) => tool.name)).toContain('wait');
  });

  it('does not starve the delegation route when a worker task also names wait', async () => {
    const latestUserMessageText =
      'Start one background worker. Give it this task: Call wait three times sequentially.';
    const result = await resolveModelTurnGroundedToolSurface({
      allTools: [...tools, WAIT_TOOL],
      conversationMode: 'agentic',
      completedWorkflowToolNames: new Set(),
      latestUserMessageText,
      trackedAsyncOperations: new Map(),
      workingMessages: messages(latestUserMessageText),
    });

    const names = result.groundedRequestScopedTools.map((tool) => tool.name);
    expect(names).toContain('sessions_spawn');
    expect(names).toContain('wait');
    expect(result.allowSessionCoordinationTools).toBe(true);
  });
});
