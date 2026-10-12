import {
  applyOrchestratorCompactionEffect,
  buildOrchestratorCompactionEffect,
} from '../../src/engine/orchestratorCompactionEffect';
import type { OrchestratorCompactionEvent } from '../../src/engine/orchestratorCompaction';

function createEvent(): OrchestratorCompactionEvent {
  return {
    notice: 'Context compacted',
    messages: [
      {
        id: 'system-1',
        role: 'system',
        content: 'Summary',
        timestamp: 1,
      },
    ],
    tier: 'selective',
    tokensBefore: 2000,
    tokensAfter: 1200,
  };
}

describe('orchestrator compaction effect', () => {
  it('builds a warning log entry for foreground compaction updates', () => {
    const effect = buildOrchestratorCompactionEffect({
      event: createEvent(),
    });

    expect(effect.messages).toHaveLength(1);
    expect(effect.logEntry).toEqual(
      expect.objectContaining({
        kind: 'compaction',
        level: 'warning',
        title: 'Context compacted',
        detail: 'Context compacted',
      }),
    );
  });

  it('applies compaction messages and emits the optional log entry', () => {
    const applyConversationCompaction = jest.fn();
    const appendConversationLog = jest.fn();
    const effect = buildOrchestratorCompactionEffect({
      event: createEvent(),
    });

    applyOrchestratorCompactionEffect({
      effect,
      actions: {
        applyConversationCompaction,
        appendConversationLog,
      },
    });

    expect(applyConversationCompaction).toHaveBeenCalledWith(effect.messages);
    expect(appendConversationLog).toHaveBeenCalledWith(effect.logEntry);
  });

  it('supports non-foreground compaction updates without appending a log entry', () => {
    const appendConversationLog = jest.fn();
    const effect = buildOrchestratorCompactionEffect({
      event: createEvent(),
      includeLogEntry: false,
    });

    applyOrchestratorCompactionEffect({
      effect,
      actions: {
        applyConversationCompaction: jest.fn(),
        appendConversationLog,
      },
    });

    expect(effect.logEntry).toBeUndefined();
    expect(appendConversationLog).not.toHaveBeenCalled();
  });
});
