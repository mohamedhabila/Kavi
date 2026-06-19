import type { LivingMemoryBridgeOutput } from '../../services/memory/livingMemoryBridge';
import type {
  AssistantCompletionMetadata,
  Message,
  MessageProviderReplay,
  ToolCall,
} from '../../types/message';
import type { LlmProviderConfig } from '../../types/provider';
import type { OrchestratorState } from '../../types/conversation';
import type { TokenUsage } from '../../types/usage';
import type { AgentControlGraphEvent, AgentControlPerformance } from './agentControlGraph';
import type { PreparedAgentTurn } from './agentTurnPreparation';
import type { AgentTurnCompactionEngine } from './agentTurnRequestBudget';
import type { AgentControlGraphForcedTextReason } from './forcedTextTurn';
import type { OrchestratorCompactionEvent } from '../orchestratorCompaction';
import type { ThinkingLevel } from '../thinking';

export interface PendingAgentToolCall {
  id: string;
  name: string;
  arguments: string;
  raw?: Record<string, any>;
}

export interface AgentModelTurnCallbacks {
  onAssistantStreamReset?: () => void;
  onReasoning?: (token: string) => void;
  onStateChange: (state: OrchestratorState) => void;
  onToken: (token: string) => void;
  onToolCallQueued?: (toolCall: ToolCall) => void;
}

export interface ExecuteAgentControlGraphModelTurnParams {
  activeProvider: LlmProviderConfig;
  applyGraphEvents: (events: AgentControlGraphEvent[]) => void;
  callbacks: AgentModelTurnCallbacks;
  compactionEngine: AgentTurnCompactionEngine;
  conversationId: string;
  effectiveForceTextReasonThisTurn?: AgentControlGraphForcedTextReason;
  hasPendingAsyncOperations: boolean;
  iteration: number;
  livingMemory?: LivingMemoryBridgeOutput | null;
  llm: {
    sendMessage: (
      messages: Array<{ role: string; content: any }>,
      options: Record<string, any>,
    ) => Promise<any>;
    streamMessage: (
      messages: Array<{ role: string; content: any }>,
      options: Record<string, any>,
    ) => AsyncIterable<any>;
  };
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
  preparedTurn: PreparedAgentTurn;
  toolSurfacePinTelemetry?: {
    sessionPinnedCount: number;
    turnPinnedCount: number;
  };
  recordPerformanceMetrics: (metrics: Partial<AgentControlPerformance>, bucket: string) => void;
  reportUsage: (usage: TokenUsage) => void;
  requestMaxTokens: number;
  requestModel: string;
  signal?: AbortController;
  temperature?: number;
  thinkingLevel: ThinkingLevel;
  warn: (message: string, error: unknown) => void;
  workingMessages: Message[];
  yieldToUiFrame: () => Promise<void>;
}

export interface ExecuteAgentControlGraphModelTurnResult {
  completion?: AssistantCompletionMetadata;
  contextWindow: number;
  fullContent: string;
  pendingToolCalls: PendingAgentToolCall[];
  providerReplay?: MessageProviderReplay;
  reasoning: string;
  requestMaxTokens: number;
  workingMessages: Message[];
}
