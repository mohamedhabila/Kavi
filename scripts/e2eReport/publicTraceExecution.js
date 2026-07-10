const {
  E2E_PUBLIC_ASSISTANT_STATUSES,
  E2E_PUBLIC_BUILT_IN_PERSONA_IDS,
  E2E_PUBLIC_CONVERSATION_MODES,
  E2E_PUBLIC_FINISH_REASONS,
  E2E_PUBLIC_GRAPH_STATUSES,
  E2E_PUBLIC_ROUTE_DIRECTIVES,
  E2E_PUBLIC_RUN_PHASES,
  E2E_PUBLIC_RUN_STATUSES,
  E2E_PUBLIC_TERMINAL_REASONS,
} = require('../../src/acceptance/e2eAgent/e2eTraceExecutionPolicy.ts');
const {
  asRecord,
  finiteNumber,
  nonNegativeInteger,
  projectHash,
  safeEnum,
} = require('./publicTracePrimitives');

const ROUTE_DIRECTIVES = new Set([...E2E_PUBLIC_ROUTE_DIRECTIVES, 'OTHER']);
const CONVERSATION_MODES = new Set([...E2E_PUBLIC_CONVERSATION_MODES, 'OTHER']);
const BUILT_IN_PERSONA_IDS = new Set(E2E_PUBLIC_BUILT_IN_PERSONA_IDS);
const ASSISTANT_STATUSES = new Set([...E2E_PUBLIC_ASSISTANT_STATUSES, 'OTHER']);
const RUN_STATUSES = new Set([...E2E_PUBLIC_RUN_STATUSES, 'OTHER']);
const GRAPH_STATUSES = new Set([...E2E_PUBLIC_GRAPH_STATUSES, 'OTHER']);
const RUN_PHASES = new Set([...E2E_PUBLIC_RUN_PHASES, 'OTHER']);
const TERMINAL_REASONS = new Set(E2E_PUBLIC_TERMINAL_REASONS);
const FINISH_REASONS = new Set(E2E_PUBLIC_FINISH_REASONS);

function projectUserEvidence(value) {
  const source = asRecord(value);
  const messageIdHash = source ? projectHash(source.messageIdHash) : null;
  const textHash = source ? projectHash(source.textHash) : null;
  return source && messageIdHash && textHash ? { messageIdHash, textHash } : null;
}

function projectLifecycleBoundaryEvidence(value) {
  if (value === null) return null;
  const source = asRecord(value);
  if (
    !source ||
    source.boundary !== 'app_relaunch' ||
    source.chatStore !== 'rehydrated' ||
    source.memoryStore !== 'reopened'
  ) {
    return undefined;
  }
  return {
    boundary: 'app_relaunch',
    chatStore: 'rehydrated',
    memoryStore: 'reopened',
  };
}

function projectRouteEvidence(value) {
  const source = asRecord(value);
  const directive = source ? safeEnum(source.directive, ROUTE_DIRECTIVES) : undefined;
  const directiveHash = source ? projectHash(source.directiveHash) : null;
  const mode = source ? safeEnum(source.mode, CONVERSATION_MODES) : undefined;
  const modeHash = source ? projectHash(source.modeHash) : null;
  const personaIdHash = source ? projectHash(source.personaIdHash) : null;
  if (!source || !directive || !directiveHash || !mode || !modeHash || !personaIdHash) return null;
  const personaId = safeEnum(source.personaId, BUILT_IN_PERSONA_IDS);
  return {
    directive,
    directiveHash,
    mode,
    modeHash,
    ...(personaId ? { personaId } : {}),
    personaIdHash,
  };
}

function projectOptionalClassifiedString(source, valueKey, hashKey, allowed) {
  const rawValue = source[valueKey];
  const rawHash = source[hashKey];
  const value = rawValue === undefined ? undefined : safeEnum(rawValue, allowed);
  const valueHash = rawHash === undefined ? undefined : projectHash(rawHash);
  if ((rawValue !== undefined && !valueHash) || (rawHash !== undefined && !valueHash)) return null;
  return {
    ...(value ? { [valueKey]: value } : {}),
    ...(valueHash ? { [hashKey]: valueHash } : {}),
  };
}

function projectFinalAssistantEvidence(value) {
  if (value === null) return null;
  const source = asRecord(value);
  const messageIdHash = source ? projectHash(source.messageIdHash) : null;
  const textHash = source ? projectHash(source.textHash) : null;
  const completionStatus = source
    ? safeEnum(source.completionStatus, ASSISTANT_STATUSES)
    : undefined;
  const completionStatusHash = source ? projectHash(source.completionStatusHash) : null;
  if (!source || !messageIdHash || !textHash || !completionStatus || !completionStatusHash) {
    return undefined;
  }
  const finishReason = projectOptionalClassifiedString(
    source,
    'finishReason',
    'finishReasonHash',
    FINISH_REASONS,
  );
  const terminalReason = projectOptionalClassifiedString(
    source,
    'terminalReason',
    'terminalReasonHash',
    TERMINAL_REASONS,
  );
  if (!finishReason || !terminalReason) return undefined;
  return {
    messageIdHash,
    textHash,
    completionStatus,
    completionStatusHash,
    ...finishReason,
    ...terminalReason,
  };
}

function projectCompletionEvidence(value) {
  const source = asRecord(value);
  const assistantStatus = source
    ? safeEnum(source.assistantStatus, ASSISTANT_STATUSES)
    : undefined;
  const assistantStatusHash = source ? projectHash(source.assistantStatusHash) : null;
  const runStatus = source ? safeEnum(source.runStatus, RUN_STATUSES) : undefined;
  const runStatusHash = source ? projectHash(source.runStatusHash) : null;
  if (
    !source ||
    !assistantStatus ||
    !assistantStatusHash ||
    typeof source.executionCompleted !== 'boolean' ||
    typeof source.finalResponseCompleted !== 'boolean' ||
    !runStatus ||
    !runStatusHash ||
    (source.runCompleted !== null && typeof source.runCompleted !== 'boolean')
  ) {
    return null;
  }
  const graphStatus =
    source.graphStatus === null ? null : safeEnum(source.graphStatus, GRAPH_STATUSES);
  const graphStatusHash =
    source.graphStatusHash === undefined ? undefined : projectHash(source.graphStatusHash);
  if (
    graphStatus === undefined ||
    (source.graphStatus === null && source.graphStatusHash !== undefined) ||
    (source.graphStatus !== null && !graphStatusHash)
  ) {
    return null;
  }
  const runTerminal = projectOptionalClassifiedString(
    source,
    'runTerminalReason',
    'runTerminalReasonHash',
    TERMINAL_REASONS,
  );
  const graphTerminal = projectOptionalClassifiedString(
    source,
    'graphTerminalReason',
    'graphTerminalReasonHash',
    TERMINAL_REASONS,
  );
  if (!runTerminal || !graphTerminal) return null;
  return {
    assistantStatus,
    assistantStatusHash,
    executionCompleted: source.executionCompleted,
    finalResponseCompleted: source.finalResponseCompleted,
    runStatus,
    runStatusHash,
    runCompleted: source.runCompleted,
    graphStatus,
    ...(graphStatusHash ? { graphStatusHash } : {}),
    ...runTerminal,
    ...graphTerminal,
  };
}

function projectRunSummary(value) {
  const source = asRecord(value);
  if (!source) return null;
  const output = {};
  for (const key of [
    'assistantTurns',
    'startedTools',
    'completedTools',
    'failedTools',
    'spawnedSubAgents',
  ]) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) return null;
    output[key] = count;
  }
  if (source.durationMs !== undefined) {
    const durationMs = finiteNumber(source.durationMs);
    if (durationMs === null || durationMs < 0) return null;
    output.durationMs = durationMs;
  }
  return output;
}

function projectAgentRunEvidence(value) {
  if (value === null) return null;
  const source = asRecord(value);
  const runIdHash = source ? projectHash(source.runIdHash) : null;
  const userMessageIdHash = source ? projectHash(source.userMessageIdHash) : null;
  const status = source ? safeEnum(source.status, RUN_STATUSES) : undefined;
  const statusHash = source ? projectHash(source.statusHash) : null;
  const phase = source ? safeEnum(source.phase, RUN_PHASES) : undefined;
  const phaseHash = source ? projectHash(source.phaseHash) : null;
  const summary = source ? projectRunSummary(source.summary) : null;
  if (
    !source ||
    !runIdHash ||
    !userMessageIdHash ||
    !status ||
    !statusHash ||
    !phase ||
    !phaseHash ||
    typeof source.completed !== 'boolean' ||
    !summary
  ) {
    return undefined;
  }
  const terminalReason = projectOptionalClassifiedString(
    source,
    'terminalReason',
    'terminalReasonHash',
    TERMINAL_REASONS,
  );
  if (!terminalReason) return undefined;
  return {
    runIdHash,
    userMessageIdHash,
    status,
    statusHash,
    phase,
    phaseHash,
    completed: source.completed,
    ...terminalReason,
    summary,
  };
}

module.exports = {
  projectAgentRunEvidence,
  projectCompletionEvidence,
  projectFinalAssistantEvidence,
  projectLifecycleBoundaryEvidence,
  projectRouteEvidence,
  projectUserEvidence,
};
