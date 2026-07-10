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
  E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH,
  E2E_PUBLIC_ROUTE_DIRECTIVES,
  E2E_PUBLIC_RUN_PHASES,
  E2E_PUBLIC_RUN_STATUSES,
  E2E_PUBLIC_TERMINAL_REASONS,
} from './e2eTraceExecutionPolicy';
import { hashString, type E2ERedactedHash } from './e2eTraceRedaction';
import {
  requireNonNegativeFiniteNumber,
  requireNonNegativeSafeInteger,
} from './e2eTraceValidation';
import type { E2EScenarioTurnTrace } from './types';

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
  directive: ForegroundScenarioRouteDirective;
  directiveHash: E2ERedactedHash;
  mode: ConversationMode;
  modeHash: E2ERedactedHash;
  personaId?: PublicBuiltInPersonaId;
  personaIdHash: E2ERedactedHash;
};

export type E2ERedactedFinalAssistantEvidence = {
  messageIdHash: E2ERedactedHash;
  textHash: E2ERedactedHash;
  textLength: number;
  completionStatus: AssistantCompletionStatus;
  completionStatusHash: E2ERedactedHash;
  finishReason?: PublicFinishReason;
  finishReasonHash?: E2ERedactedHash;
  terminalReason?: AgentRunTerminalReason;
  terminalReasonHash?: E2ERedactedHash;
};

export type E2ERedactedCompletionEvidence = {
  assistantStatus: ForegroundScenarioCompletionSnapshot['assistantStatus'];
  assistantStatusHash: E2ERedactedHash;
  executionCompleted: boolean;
  finalResponseCompleted: boolean;
  runStatus: ForegroundScenarioCompletionSnapshot['runStatus'];
  runStatusHash: E2ERedactedHash;
  runCompleted: boolean | null;
  graphStatus: ForegroundScenarioCompletionSnapshot['graphStatus'];
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
  status: AgentRunStatus;
  statusHash: E2ERedactedHash;
  phase: AgentRunPhaseKey;
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

function requirePublicEnum<T extends string>(
  value: string,
  allowed: ReadonlySet<string>,
  label: string,
): T {
  if (!allowed.has(value)) throw new Error(`${label} contains an unsupported enum value.`);
  return value as T;
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

function buildRunSummary(summary: AgentRunSummary): E2ERedactedAgentRunSummary {
  const durationMs =
    summary.durationMs === undefined
      ? undefined
      : requireNonNegativeFiniteNumber(summary.durationMs, 'agentRun.summary.durationMs');
  return {
    assistantTurns: requireNonNegativeSafeInteger(
      summary.assistantTurns,
      'agentRun.summary.assistantTurns',
    ),
    startedTools: requireNonNegativeSafeInteger(
      summary.startedTools,
      'agentRun.summary.startedTools',
    ),
    completedTools: requireNonNegativeSafeInteger(
      summary.completedTools,
      'agentRun.summary.completedTools',
    ),
    failedTools: requireNonNegativeSafeInteger(
      summary.failedTools,
      'agentRun.summary.failedTools',
    ),
    spawnedSubAgents: requireNonNegativeSafeInteger(
      summary.spawnedSubAgents,
      'agentRun.summary.spawnedSubAgents',
    ),
    ...(durationMs === undefined ? {} : { durationMs }),
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
    directive: requirePublicEnum<ForegroundScenarioRouteDirective>(
      turn.route.directive,
      ROUTE_DIRECTIVES,
      'turn.route.directive',
    ),
    directiveHash: hashString(turn.route.directive),
    mode: requirePublicEnum<ConversationMode>(
      turn.route.mode,
      CONVERSATION_MODES,
      'turn.route.mode',
    ),
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
  const textLength = assistant.text.length;
  if (textLength > E2E_PUBLIC_MAX_FINAL_ASSISTANT_TEXT_LENGTH) {
    throw new Error('finalAssistant.text exceeds the public trace length bound.');
  }
  return {
    messageIdHash: hashString(assistant.messageId),
    textHash: hashString(assistant.text),
    textLength,
    completionStatus: requirePublicEnum<AssistantCompletionStatus>(
      assistant.completionStatus,
      ASSISTANT_STATUSES,
      'finalAssistant.completionStatus',
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
    assistantStatus: requirePublicEnum(
      completion.assistantStatus,
      ASSISTANT_STATUSES,
      'completion.assistantStatus',
    ),
    assistantStatusHash: hashString(completion.assistantStatus),
    executionCompleted: completion.executionCompleted,
    finalResponseCompleted: completion.finalResponseCompleted,
    runStatus: requirePublicEnum(
      completion.runStatus,
      RUN_STATUSES,
      'completion.runStatus',
    ),
    runStatusHash: hashString(completion.runStatus),
    runCompleted: completion.runCompleted,
    graphStatus:
      completion.graphStatus === null
        ? null
        : requirePublicEnum<
            NonNullable<ForegroundScenarioCompletionSnapshot['graphStatus']>
          >(
            completion.graphStatus,
            GRAPH_STATUSES,
            'completion.graphStatus',
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
    status: requirePublicEnum(run.status, RUN_STATUSES, 'agentRun.status'),
    statusHash: hashString(run.status),
    phase: requirePublicEnum(run.currentPhase, RUN_PHASES, 'agentRun.phase'),
    phaseHash: hashString(run.currentPhase),
    completed: run.completedAt !== null,
    ...(terminalReason.value ? { terminalReason: terminalReason.value } : {}),
    ...(terminalReason.valueHash ? { terminalReasonHash: terminalReason.valueHash } : {}),
    summary: buildRunSummary(run.summary),
  };
}
