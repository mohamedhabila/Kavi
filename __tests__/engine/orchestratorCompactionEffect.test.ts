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

  it('writes compaction summary to memory when summary is present', () => {
    const writeCompactionSummary = jest.fn();
    const event: OrchestratorCompactionEvent = {
      ...createEvent(),
      summary: 'Conversation summary text',
    };
    const effect = buildOrchestratorCompactionEffect({ event });

    applyOrchestratorCompactionEffect({
      effect,
      actions: {
        applyConversationCompaction: jest.fn(),
        writeCompactionSummary,
      },
    });

    expect(writeCompactionSummary).toHaveBeenCalledWith('Conversation summary text');
  });

  it('does not write compaction summary when summary is empty', () => {
    const writeCompactionSummary = jest.fn();
    const event: OrchestratorCompactionEvent = {
      ...createEvent(),
      summary: '',
    };
    const effect = buildOrchestratorCompactionEffect({ event });

    applyOrchestratorCompactionEffect({
      effect,
      actions: {
        applyConversationCompaction: jest.fn(),
        writeCompactionSummary,
      },
    });

    expect(writeCompactionSummary).not.toHaveBeenCalled();
  });

  it('does not write compaction summary when summary is missing', () => {
    const writeCompactionSummary = jest.fn();
    const event = createEvent();
    delete (event as any).summary;
    const effect = buildOrchestratorCompactionEffect({ event });

    applyOrchestratorCompactionEffect({
      effect,
      actions: {
        applyConversationCompaction: jest.fn(),
        writeCompactionSummary,
      },
    });

    expect(writeCompactionSummary).not.toHaveBeenCalled();
  });

  it('trims compaction summary before writing', () => {
    const writeCompactionSummary = jest.fn();
    const event: OrchestratorCompactionEvent = {
      ...createEvent(),
      summary: '  padded summary  ',
    };
    const effect = buildOrchestratorCompactionEffect({ event });

    applyOrchestratorCompactionEffect({
      effect,
      actions: {
        applyConversationCompaction: jest.fn(),
        writeCompactionSummary,
      },
    });

    expect(writeCompactionSummary).toHaveBeenCalledWith('padded summary');
  });
});
