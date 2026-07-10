import type {
  AgentRunPhaseKey,
  AgentRunStatus,
  AgentRunSummary,
  AgentRunTerminalReason,
} from '../../types/agentRun';
import type { ConversationMode } from '../../types/conversation';
import type { AssistantCompletionStatus } from '../../types/message';
import type {
  ForegroundScenarioCompletionSnapshot,
  ForegroundScenarioRouteDirective,
} from './foregroundScenarioDriverTypes';
import {
  E2E_PUBLIC_ASSISTANT_STATUSES,
  E2E_PUBLIC_BUILT_IN_PERSONA_IDS,
  E2E_PUBLIC_CONVERSATION_MODES,
  E2E_PUBLIC_FINISH_REASONS,
  E2E_PUBLIC_GRAPH_STATUSES,
  E2E_PUBLIC_ROUTE_DIRECTIVES,
  E2E_PUBLIC_RUN_PHASES,
  E2E_PUBLIC_RUN_STATUSES,
  E2E_PUBLIC_TERMINAL_REASONS,
} from './e2eTraceExecutionPolicy';
import { hashString, type E2ERedactedHash } from './e2eTraceRedaction';
import type { E2EScenarioTurnTrace } from './types';

type PublicEnum<T extends string> = T | 'OTHER';
type PublicBuiltInPersonaId = (typeof E2E_PUBLIC_BUILT_IN_PERSONA_IDS)[number];
type PublicFinishReason = (typeof E2E_PUBLIC_FINISH_REASONS)[number];

export type E2ERedactedUserEvidence = {
  messageIdHash: E2ERedactedHash;
  textHash: E2ERedactedHash;
};

export type E2ERedactedLifecycleBoundaryEvidence = NonNullable<
  E2EScenarioTurnTrace['lifecycleBefore']
>;

export type E2ERedactedRouteEvidence = {
  directive: PublicEnum<ForegroundScenarioRouteDirective>;
  directiveHash: E2ERedactedHash;
  mode: PublicEnum<ConversationMode>;
  modeHash: E2ERedactedHash;
  personaId?: PublicBuiltInPersonaId;
  personaIdHash: E2ERedactedHash;
};

export type E2ERedactedFinalAssistantEvidence = {
  messageIdHash: E2ERedactedHash;
  textHash: E2ERedactedHash;
  completionStatus: PublicEnum<AssistantCompletionStatus>;
  completionStatusHash: E2ERedactedHash;
  finishReason?: PublicFinishReason;
  finishReasonHash?: E2ERedactedHash;
  terminalReason?: AgentRunTerminalReason;
  terminalReasonHash?: E2ERedactedHash;
};

export type E2ERedactedCompletionEvidence = {
  assistantStatus: PublicEnum<ForegroundScenarioCompletionSnapshot['assistantStatus']>;
  assistantStatusHash: E2ERedactedHash;
  executionCompleted: boolean;
  finalResponseCompleted: boolean;
  runStatus: PublicEnum<ForegroundScenarioCompletionSnapshot['runStatus']>;
  runStatusHash: E2ERedactedHash;
  runCompleted: boolean | null;
  graphStatus: PublicEnum<NonNullable<ForegroundScenarioCompletionSnapshot['graphStatus']>> | null;
  graphStatusHash?: E2ERedactedHash;
  runTerminalReason?: AgentRunTerminalReason;
  runTerminalReasonHash?: E2ERedactedHash;
  graphTerminalReason?: AgentRunTerminalReason;
  graphTerminalReasonHash?: E2ERedactedHash;
};

export type E2ERedactedAgentRunSummary = Required<Omit<AgentRunSummary, 'durationMs'>> & {
  durationMs?: number;
};

export type E2ERedactedAgentRunEvidence = {
  runIdHash: E2ERedactedHash;
  userMessageIdHash: E2ERedactedHash;
  status: PublicEnum<AgentRunStatus>;
  statusHash: E2ERedactedHash;
  phase: PublicEnum<AgentRunPhaseKey>;
  phaseHash: E2ERedactedHash;
  completed: boolean;
  terminalReason?: AgentRunTerminalReason;
  terminalReasonHash?: E2ERedactedHash;
  summary: E2ERedactedAgentRunSummary;
};

const ROUTE_DIRECTIVES = new Set<string>(E2E_PUBLIC_ROUTE_DIRECTIVES);
const CONVERSATION_MODES = new Set<string>(E2E_PUBLIC_CONVERSATION_MODES);
const BUILT_IN_PERSONA_IDS = new Set<string>(E2E_PUBLIC_BUILT_IN_PERSONA_IDS);
const ASSISTANT_STATUSES = new Set<string>(E2E_PUBLIC_ASSISTANT_STATUSES);
const RUN_STATUSES = new Set<string>(E2E_PUBLIC_RUN_STATUSES);
const GRAPH_STATUSES = new Set<string>(E2E_PUBLIC_GRAPH_STATUSES);
const RUN_PHASES = new Set<string>(E2E_PUBLIC_RUN_PHASES);
const TERMINAL_REASONS = new Set<string>(E2E_PUBLIC_TERMINAL_REASONS);
const FINISH_REASONS = new Set<string>(E2E_PUBLIC_FINISH_REASONS);

function publicEnum<T extends string>(value: string, allowed: ReadonlySet<string>): PublicEnum<T> {
  return allowed.has(value) ? (value as T) : 'OTHER';
}

function optionalClassifiedString<T extends string>(
  value: string | null,
  allowed: ReadonlySet<string>,
): { value?: T; valueHash?: E2ERedactedHash } {
  if (value === null) return {};
  return {
    ...(allowed.has(value) ? { value: value as T } : {}),
    valueHash: hashString(value),
  };
}

function count(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function duration(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function buildRunSummary(summary: AgentRunSummary): E2ERedactedAgentRunSummary {
  return {
    assistantTurns: count(summary.assistantTurns),
    startedTools: count(summary.startedTools),
    completedTools: count(summary.completedTools),
    failedTools: count(summary.failedTools),
    spawnedSubAgents: count(summary.spawnedSubAgents),
    ...(duration(summary.durationMs) !== undefined ? { durationMs: duration(summary.durationMs) } : {}),
  };
}

export function buildUserEvidence(turn: E2EScenarioTurnTrace): E2ERedactedUserEvidence {
  return {
    messageIdHash: hashString(turn.user.messageId),
    textHash: hashString(turn.user.text),
  };
}

export function buildLifecycleBoundaryEvidence(
  value: E2EScenarioTurnTrace['lifecycleBefore'],
): E2ERedactedLifecycleBoundaryEvidence | null {
  if (value === null) return null;
  if (!value) throw new Error('Missing E2E lifecycle boundary evidence.');
  if (
    value.boundary !== 'app_relaunch' ||
    value.chatStore !== 'rehydrated' ||
    value.memoryStore !== 'reopened'
  ) {
    throw new Error('Unsupported E2E lifecycle boundary evidence.');
  }
  return {
    boundary: 'app_relaunch',
    chatStore: 'rehydrated',
    memoryStore: 'reopened',
  };
}

export function buildRouteEvidence(turn: E2EScenarioTurnTrace): E2ERedactedRouteEvidence {
  return {
    directive: publicEnum<ForegroundScenarioRouteDirective>(turn.route.directive, ROUTE_DIRECTIVES),
    directiveHash: hashString(turn.route.directive),
    mode: publicEnum<ConversationMode>(turn.route.mode, CONVERSATION_MODES),
    modeHash: hashString(turn.route.mode),
    ...(BUILT_IN_PERSONA_IDS.has(turn.route.personaId)
      ? { personaId: turn.route.personaId as PublicBuiltInPersonaId }
      : {}),
    personaIdHash: hashString(turn.route.personaId),
  };
}

export function buildFinalAssistantEvidence(
  turn: E2EScenarioTurnTrace,
): E2ERedactedFinalAssistantEvidence | null {
  const assistant = turn.finalAssistant;
  if (!assistant) return null;
  const finishReason = optionalClassifiedString<PublicFinishReason>(
    assistant.finishReason,
    FINISH_REASONS,
  );
  const terminalReason = optionalClassifiedString<AgentRunTerminalReason>(
    assistant.terminalReason,
    TERMINAL_REASONS,
  );
  return {
    messageIdHash: hashString(assistant.messageId),
    textHash: hashString(assistant.text),
    completionStatus: publicEnum<AssistantCompletionStatus>(
      assistant.completionStatus,
      ASSISTANT_STATUSES,
    ),
    completionStatusHash: hashString(assistant.completionStatus),
    ...(finishReason.value ? { finishReason: finishReason.value } : {}),
    ...(finishReason.valueHash ? { finishReasonHash: finishReason.valueHash } : {}),
    ...(terminalReason.value ? { terminalReason: terminalReason.value } : {}),
    ...(terminalReason.valueHash ? { terminalReasonHash: terminalReason.valueHash } : {}),
  };
}

export function buildCompletionEvidence(
  completion: ForegroundScenarioCompletionSnapshot,
): E2ERedactedCompletionEvidence {
  const runTerminal = optionalClassifiedString<AgentRunTerminalReason>(
    completion.runTerminalReason,
    TERMINAL_REASONS,
  );
  const graphTerminal = optionalClassifiedString<AgentRunTerminalReason>(
    completion.graphTerminalReason,
    TERMINAL_REASONS,
  );
  return {
    assistantStatus: publicEnum(completion.assistantStatus, ASSISTANT_STATUSES),
    assistantStatusHash: hashString(completion.assistantStatus),
    executionCompleted: completion.executionCompleted,
    finalResponseCompleted: completion.finalResponseCompleted,
    runStatus: publicEnum(completion.runStatus, RUN_STATUSES),
    runStatusHash: hashString(completion.runStatus),
    runCompleted: completion.runCompleted,
    graphStatus:
      completion.graphStatus === null
        ? null
        : publicEnum<NonNullable<ForegroundScenarioCompletionSnapshot['graphStatus']>>(
            completion.graphStatus,
            GRAPH_STATUSES,
          ),
    ...(completion.graphStatus === null
      ? {}
      : { graphStatusHash: hashString(completion.graphStatus) }),
    ...(runTerminal.value ? { runTerminalReason: runTerminal.value } : {}),
    ...(runTerminal.valueHash ? { runTerminalReasonHash: runTerminal.valueHash } : {}),
    ...(graphTerminal.value ? { graphTerminalReason: graphTerminal.value } : {}),
    ...(graphTerminal.valueHash
      ? { graphTerminalReasonHash: graphTerminal.valueHash }
      : {}),
  };
}

export function buildAgentRunEvidence(
  run: E2EScenarioTurnTrace['agentRun'],
): E2ERedactedAgentRunEvidence | null {
  if (!run) return null;
  const terminalReason = optionalClassifiedString<AgentRunTerminalReason>(
    run.terminalReason,
    TERMINAL_REASONS,
  );
  return {
    runIdHash: hashString(run.runId),
    userMessageIdHash: hashString(run.userMessageId),
    status: publicEnum(run.status, RUN_STATUSES),
    statusHash: hashString(run.status),
    phase: publicEnum(run.currentPhase, RUN_PHASES),
    phaseHash: hashString(run.currentPhase),
    completed: run.completedAt !== null,
    ...(terminalReason.value ? { terminalReason: terminalReason.value } : {}),
    ...(terminalReason.valueHash ? { terminalReasonHash: terminalReason.valueHash } : {}),
    summary: buildRunSummary(run.summary),
  };
}
