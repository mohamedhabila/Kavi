import type { ConversationLogEntry } from '../types/conversation';
import type { Message } from '../types/message';
import { generateId } from '../utils/id';
import type { OrchestratorCompactionEvent } from './orchestratorCompaction';

export type OrchestratorCompactionEffect = {
  logEntry?: ConversationLogEntry;
  messages: Message[];
  /** The compaction summary text, if any. */
  summary?: string;
};

export function buildOrchestratorCompactionEffect(params: {
  event: OrchestratorCompactionEvent;
  includeLogEntry?: boolean;
}): OrchestratorCompactionEffect {
  return {
    messages: params.event.messages,
    summary: params.event.summary,
    logEntry:
      params.includeLogEntry === false
        ? undefined
        : {
            id: generateId(),
            timestamp: Date.now(),
            kind: 'compaction',
            level: 'warning',
            title: 'Context compacted',
            detail: params.event.notice,
          },
  };
}

export function applyOrchestratorCompactionEffect(params: {
  actions: {
    appendConversationLog?: (entry: ConversationLogEntry) => void;
    applyConversationCompaction: (messages: Message[]) => void;
    writeCompactionSummary?: (summary: string) => void;
  };
  effect: OrchestratorCompactionEffect;
}): void {
  params.actions.applyConversationCompaction(params.effect.messages);
  if (params.effect.logEntry) {
    params.actions.appendConversationLog?.(params.effect.logEntry);
  }
  if (params.effect.summary && params.effect.summary.trim().length > 0) {
    params.actions.writeCompactionSummary?.(params.effect.summary.trim());
  }
}
