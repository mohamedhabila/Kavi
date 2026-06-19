import { buildForegroundAssistantTurnRoutingEffect } from '../../src/engine/graph/foregroundRun/assistantTurnRouting';
import type { ToolCall } from '../../src/types/message';

function createToolCall(id: string, name: string): ToolCall {
  return {
    id,
    name,
    arguments: '{}',
    status: 'pending',
  };
}

describe('foreground assistant turn routing', () => {
  it('starts a fresh assistant turn for a second tool-only batch', () => {
    const effect = buildForegroundAssistantTurnRoutingEffect({
      persistedToolCalls: [createToolCall('tool-a', 'tool_catalog')],
      rawToolCalls: [createToolCall('tool-b', 'image_generate')],
      startNextAssistantTurn: false,
      surfacedWorkerOutputLocked: false,
    });

    expect(effect.shouldStartFreshTurnBeforeApplying).toBe(true);
    expect(effect.shouldQueueNextAssistantTurn).toBe(true);
    expect(effect.workPhasePresentation).toEqual({
      title: 'Using image_generate',
      checkpointTitle: 'Work started',
    });
  });

  it('opens a fresh turn for an empty final callback after tool use', () => {
    const effect = buildForegroundAssistantTurnRoutingEffect({
      assistantMetadata: {
        kind: 'final',
      },
      hasProviderReplay: true,
      rawToolCalls: [],
      startNextAssistantTurn: true,
      surfacedWorkerOutputLocked: false,
    });

    expect(effect.shouldStartFreshTurnBeforeApplying).toBe(true);
    expect(effect.shouldQueueNextAssistantTurn).toBe(false);
    expect(effect.shouldCommitResolvedContent).toBe(false);
    expect(effect.workPhasePresentation).toBeUndefined();
  });

  it('keeps surfaced worker output locked when late text arrives without new tool calls', () => {
    const effect = buildForegroundAssistantTurnRoutingEffect({
      incomingContent: 'Worker-authored final answer',
      rawToolCalls: [],
      startNextAssistantTurn: false,
      surfacedWorkerOutputLocked: true,
    });

    expect(effect.shouldShortCircuitForSurfacedWorkerOutput).toBe(true);
    expect(effect.shouldClearSurfacedWorkerOutputLock).toBe(false);
  });

  it('treats mixed prose plus tool calls as a tool turn instead of visible assistant text', () => {
    const effect = buildForegroundAssistantTurnRoutingEffect({
      incomingContent: 'I will create the game files now.',
      rawToolCalls: [createToolCall('write-1', 'write_file')],
      startNextAssistantTurn: false,
      surfacedWorkerOutputLocked: false,
    });

    expect(effect.shouldCommitResolvedContent).toBe(false);
    expect(effect.shouldFinalizeCommittedContent).toBe(false);
    expect(effect.shouldSyncSummaryFromContent).toBe(false);
    expect(effect.shouldQueueNextAssistantTurn).toBe(true);
    expect(effect.workPhasePresentation).toEqual({
      title: 'Using write_file',
      checkpointTitle: 'Work started',
    });
  });
});
