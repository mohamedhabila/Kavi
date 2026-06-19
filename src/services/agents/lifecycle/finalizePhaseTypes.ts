import type { Message } from '../../../types/message';
import type { AgentRunTerminalDeliverable } from '../finalizationDeliverables';

export interface AgentRunResultPreview {
  sourceName: string;
  preview: string;
}

export interface AgentRunFinalizationEvidence {
  originalPrompt: string;
  transcriptMessages: Message[];
  lastNonEmptyAssistantContent: string;
  lastSubstantiveResult: string;
  lastSubstantiveResultSourceName?: string;
  resultPreviews: AgentRunResultPreview[];
  terminalDeliverables?: AgentRunTerminalDeliverable[];
  toolsUsed: string[];
  iterations: number;
  hasIncompleteToolCalls: boolean;
}
