import type {
  AgentRunPlan,
  AgentRunWorkstream,
  SubAgentSnapshot,
  SubAgentStatus,
} from '../../types';

export type WorkflowExecutionStatus = 'not-started' | 'running' | 'completed' | 'failed';

export interface WorkflowExecutionState {
  workstreamId: string;
  title?: string;
  status: WorkflowExecutionStatus;
  runningSessionIds: string[];
  completedSessionIds: string[];
  failedSessionIds: string[];
}

export interface WorkflowBlockingDependency {
  workstreamId: string;
  title?: string;
  status: WorkflowExecutionStatus;
  sessionIds: string[];
}

export interface WorkflowSpawnGateResult {
  status: 'ready' | 'blocked';
  workstreamId?: string;
  dependencyIds: string[];
  unmetDependencyIds: string[];
  duplicateRunningSessionIds: string[];
  duplicateCompletedSessionIds: string[];
  blockingDependencies: WorkflowBlockingDependency[];
}

export interface WorkflowContinuationWorkstreamState extends WorkflowExecutionState {
  title: string;
  dependencyIds: string[];
  unmetDependencyIds: string[];
}

export interface WorkflowPlanContinuationResult {
  status: 'continue' | 'ready-for-pilot';
  hasStructuredPlan: boolean;
  totalWorkstreams: number;
  completedWorkstreams: WorkflowExecutionState[];
  runningWorkstreams: WorkflowContinuationWorkstreamState[];
  readyWorkstreams: WorkflowContinuationWorkstreamState[];
  blockedWorkstreams: WorkflowContinuationWorkstreamState[];
  summary: string;
}

const NO_DEPENDENCY_REFERENCE_PATTERN = /^(?:none|no dependencies?|independent|n\/?a|na)$/i;
const TRAILING_WORKFLOW_REFERENCE_PUNCTUATION_PATTERN = /[.!?,;:]+$/;
const EMBEDDED_WORKSTREAM_ID_PATTERN = /\b(workstream-[a-z0-9-]+)\b/i;
const WORKSTREAM_NUMBER_REFERENCE_PATTERN = /\bworkstreams?\s*[-:#]?\s*(\d+)\b/i;
const LEADING_WORKSTREAM_NUMBER_PATTERN = /^(\d+)\b/;
const WORKFLOW_MARKDOWN_PATTERNS = [
  /\*\*([^*]+)\*\*/g,
  /__([^_]+)__/g,
  /`([^`]+)`/g,
  /\*([^*]+)\*/g,
  /_([^_]+)_/g,
];
const WORKFLOW_LOOKUP_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'agent',
  'agents',
  'sub',
  'subagent',
  'subagents',
  'worker',
  'workers',
  'session',
  'sessions',
  'task',
  'tasks',
  'workstream',
  'workstreams',
]);

function trimText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function sanitizeWorkflowText(value: string): string {
  let sanitized = value.trim().replace(/^#{1,6}\s*/, '');

  for (const pattern of WORKFLOW_MARKDOWN_PATTERNS) {
    sanitized = sanitized.replace(pattern, '$1');
  }

  sanitized = sanitized.replace(/^[>*•-]+\s+/, '').trim();

  const wrappers: Array<[string, string]> = [
    ['"', '"'],
    ["'", "'"],
    ['“', '”'],
    ['‘', '’'],
    ['(', ')'],
    ['[', ']'],
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of wrappers) {
      if (
        sanitized.startsWith(open) &&
        sanitized.endsWith(close) &&
        sanitized.length > open.length + close.length
      ) {
        sanitized = sanitized.slice(open.length, sanitized.length - close.length).trim();
        changed = true;
      }
    }
  }

  return sanitized.replace(/\s+/g, ' ').trim();
}

function normalizeLookupKey(value: string): string {
  return sanitizeWorkflowText(value)
    .toLowerCase()
    .replace(/\bworkstreams\b/g, 'workstream')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeWorkflowReferenceText(value: string): string {
  return sanitizeWorkflowText(value)
    .replace(TRAILING_WORKFLOW_REFERENCE_PUNCTUATION_PATTERN, '')
    .trim();
}

function isIndependentDependencyReference(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalizedValue = normalizeWorkflowReferenceText(value);
  return normalizedValue.length > 0 && NO_DEPENDENCY_REFERENCE_PATTERN.test(normalizedValue);
}

export function normalizeWorkflowDependencyReference(
  value: string | undefined,
): string | undefined {
  const trimmedValue = trimText(value);
  if (!trimmedValue) {
    return undefined;
  }

  const normalizedValue = normalizeWorkflowReferenceText(trimmedValue);
  if (!normalizedValue || isIndependentDependencyReference(normalizedValue)) {
    return undefined;
  }

  return normalizedValue;
}

function normalizeTextList(items?: string[]): string[] | undefined {
  const normalized = Array.from(
    new Set(
      (items ?? []).map((item) => trimText(item)).filter((item): item is string => Boolean(item)),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function resolveUniqueWorkstreamId(
  candidate: string | undefined,
  index: number,
  usedIds: Set<string>,
): string {
  const baseId = trimText(candidate) || `workstream-${index + 1}`;
  if (!usedIds.has(baseId)) {
    usedIds.add(baseId);
    return baseId;
  }

  let suffix = 2;
  let nextId = `${baseId}-${suffix}`;
  while (usedIds.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}-${suffix}`;
  }

  usedIds.add(nextId);
  return nextId;
}

function tokenizeLookupKey(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(' ')
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && !WORKFLOW_LOOKUP_STOPWORDS.has(token)),
    ),
  );
}

function buildWorkstreamLookup(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id' | 'title'>>,
): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const workstream of workstreams) {
    lookup.set(normalizeLookupKey(workstream.id), workstream.id);
    lookup.set(normalizeLookupKey(workstream.title), workstream.id);
  }

  return lookup;
}

function resolveWorkstreamIdByNumber(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id'>>,
  rawNumber: string | undefined,
): string | undefined {
  if (!rawNumber) {
    return undefined;
  }

  const number = Number.parseInt(rawNumber, 10);
  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  const candidateId = `workstream-${number}`;
  return workstreams.some((workstream) => workstream.id === candidateId) ? candidateId : undefined;
}

function resolveNumericWorkstreamReference(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id'>>,
  reference: string,
): string | undefined {
  const sanitizedReference = sanitizeWorkflowText(reference);
  return resolveWorkstreamIdByNumber(
    workstreams,
    sanitizedReference.match(WORKSTREAM_NUMBER_REFERENCE_PATTERN)?.[1] ??
      sanitizedReference.match(LEADING_WORKSTREAM_NUMBER_PATTERN)?.[1],
  );
}

function resolveUniqueContainedWorkstreamMatch(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id' | 'title'>>,
  normalizedReference: string,
): string | undefined {
  if (!normalizedReference || tokenizeLookupKey(normalizedReference).length < 2) {
    return undefined;
  }

  const matches = workstreams.filter((workstream) => {
    const titleKey = normalizeLookupKey(workstream.title);
    return Boolean(
      titleKey &&
      titleKey !== normalizedReference &&
      (normalizedReference.includes(titleKey) || titleKey.includes(normalizedReference)),
    );
  });

  return matches.length === 1 ? matches[0].id : undefined;
}

function resolveUniqueTokenOverlapWorkstreamMatch(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id' | 'title'>>,
  normalizedReference: string,
): string | undefined {
  const referenceTokens = tokenizeLookupKey(normalizedReference);
  if (referenceTokens.length < 2) {
    return undefined;
  }

  const scoredMatches = workstreams
    .map((workstream) => {
      const titleTokens = tokenizeLookupKey(normalizeLookupKey(workstream.title));
      const matchingTokenCount = titleTokens.reduce(
        (count, token) => count + (referenceTokens.includes(token) ? 1 : 0),
        0,
      );

      return {
        id: workstream.id,
        matchingTokenCount,
        fullyCovered:
          titleTokens.length > 0 && titleTokens.every((token) => referenceTokens.includes(token)),
      };
    })
    .filter((match) => match.matchingTokenCount > 0)
    .sort((left, right) => {
      if (left.fullyCovered !== right.fullyCovered) {
        return left.fullyCovered ? -1 : 1;
      }

      return right.matchingTokenCount - left.matchingTokenCount;
    });

  const topMatch = scoredMatches[0];
  if (!topMatch) {
    return undefined;
  }

  const runnerUp = scoredMatches[1];
  if (topMatch.fullyCovered) {
    if (
      runnerUp &&
      runnerUp.fullyCovered &&
      runnerUp.matchingTokenCount === topMatch.matchingTokenCount
    ) {
      return undefined;
    }

    return topMatch.id;
  }

  if (topMatch.matchingTokenCount < 2) {
    return undefined;
  }

  if (runnerUp && runnerUp.matchingTokenCount === topMatch.matchingTokenCount) {
    return undefined;
  }

  return topMatch.id;
}

export function resolveWorkflowWorkstreamReference(
  workstreams: ReadonlyArray<Pick<AgentRunWorkstream, 'id' | 'title'>>,
  reference: string | undefined,
): string | undefined {
  const normalizedReferenceText = normalizeWorkflowDependencyReference(reference);
  if (!normalizedReferenceText) {
    return undefined;
  }

  const lookup = buildWorkstreamLookup(workstreams);
  const directMatch = lookup.get(normalizeLookupKey(normalizedReferenceText));
  if (directMatch) {
    return directMatch;
  }

  const embeddedId = normalizedReferenceText.match(EMBEDDED_WORKSTREAM_ID_PATTERN)?.[1];
  if (embeddedId && workstreams.some((workstream) => workstream.id === embeddedId)) {
    return embeddedId;
  }

  const numericMatch = resolveNumericWorkstreamReference(workstreams, normalizedReferenceText);
  if (numericMatch) {
    return numericMatch;
  }

  const normalizedReference = normalizeLookupKey(normalizedReferenceText);
  const containedMatch = resolveUniqueContainedWorkstreamMatch(workstreams, normalizedReference);
  if (containedMatch) {
    return containedMatch;
  }

  const tokenOverlapMatch = resolveUniqueTokenOverlapWorkstreamMatch(
    workstreams,
    normalizedReference,
  );
  if (tokenOverlapMatch) {
    return tokenOverlapMatch;
  }

  return undefined;
}

export function normalizeWorkflowWorkstreams(
  workstreams?: AgentRunWorkstream[],
): AgentRunWorkstream[] {
  const usedIds = new Set<string>();

  const normalizedWorkstreams = (workstreams ?? [])
    .map<AgentRunWorkstream | null>((workstream, index) => {
      const title = trimText(sanitizeWorkflowText(workstream.title));
      if (!title) {
        return null;
      }

      const normalizedWorkstream: AgentRunWorkstream = {
        id: resolveUniqueWorkstreamId(workstream.id, index, usedIds),
        title,
      };

      const goal = trimText(workstream.goal);
      const successCriteria = normalizeTextList(workstream.successCriteria);
      const dependencies = normalizeTextList(workstream.dependencies)
        ?.map((dependency) => normalizeWorkflowDependencyReference(dependency))
        .filter((dependency): dependency is string => Boolean(dependency));

      if (goal) {
        normalizedWorkstream.goal = goal;
      }
      if (successCriteria) {
        normalizedWorkstream.successCriteria = successCriteria;
      }
      if (dependencies) {
        normalizedWorkstream.dependencies = dependencies;
      }

      return normalizedWorkstream;
    })
    .filter((workstream): workstream is AgentRunWorkstream => workstream !== null);

  return normalizedWorkstreams.map((workstream) => {
    const dependencyIds = Array.from(
      new Set(
        (workstream.dependencies ?? [])
          .map((dependency) => {
            const normalizedDependency = normalizeWorkflowDependencyReference(dependency);
            if (!normalizedDependency) {
              return undefined;
            }

            return (
              resolveWorkflowWorkstreamReference(normalizedWorkstreams, normalizedDependency) ??
              normalizedDependency
            );
          })
          .filter((dependency): dependency is string =>
            Boolean(dependency && dependency !== workstream.id),
          ),
      ),
    );

    return {
      ...workstream,
      dependencies: dependencyIds.length > 0 ? dependencyIds : undefined,
    };
  });
}

export function inferWorkflowWorkstreamId(
  workstreams: ReadonlyArray<AgentRunWorkstream>,
  params: {
    workstreamId?: string;
    name?: string;
    prompt?: string;
  },
): string | undefined {
  const explicitMatch = resolveWorkflowWorkstreamReference(workstreams, params.workstreamId);
  if (explicitMatch) {
    return explicitMatch;
  }

  const explicitId = trimText(params.workstreamId);
  if (explicitId) {
    return explicitId;
  }

  if (workstreams.length === 1) {
    return workstreams[0].id;
  }

  const nameMatch = resolveWorkflowWorkstreamReference(workstreams, params.name);
  if (nameMatch) {
    return nameMatch;
  }

  const promptHeadline = trimText(params.prompt?.split('\n', 1)[0]);
  return resolveWorkflowWorkstreamReference(workstreams, promptHeadline);
}

function summarizeExecutionStatus(
  snapshotStatus: SubAgentStatus,
): Exclude<WorkflowExecutionStatus, 'not-started'> {
  if (snapshotStatus === 'running') {
    return 'running';
  }

  if (snapshotStatus === 'completed') {
    return 'completed';
  }

  return 'failed';
}

export function getWorkflowExecutionStates(
  workstreams: ReadonlyArray<AgentRunWorkstream>,
  workers: ReadonlyArray<Pick<SubAgentSnapshot, 'workstreamId' | 'sessionId' | 'status'>>,
): Record<string, WorkflowExecutionState> {
  const states: Record<string, WorkflowExecutionState> = {};

  for (const workstream of workstreams) {
    states[workstream.id] = {
      workstreamId: workstream.id,
      title: workstream.title,
      status: 'not-started',
      runningSessionIds: [],
      completedSessionIds: [],
      failedSessionIds: [],
    };
  }

  for (const worker of workers) {
    const rawWorkstreamId = trimText(worker.workstreamId);
    const workstreamId = rawWorkstreamId
      ? (resolveWorkflowWorkstreamReference(workstreams, rawWorkstreamId) ?? rawWorkstreamId)
      : undefined;
    if (!workstreamId) {
      continue;
    }

    const currentState = states[workstreamId] ?? {
      workstreamId,
      status: 'not-started' as WorkflowExecutionStatus,
      runningSessionIds: [],
      completedSessionIds: [],
      failedSessionIds: [],
    };

    switch (summarizeExecutionStatus(worker.status)) {
      case 'running':
        currentState.runningSessionIds.push(worker.sessionId);
        break;
      case 'completed':
        currentState.completedSessionIds.push(worker.sessionId);
        break;
      case 'failed':
        currentState.failedSessionIds.push(worker.sessionId);
        break;
      default:
        break;
    }

    currentState.status =
      currentState.runningSessionIds.length > 0
        ? 'running'
        : currentState.completedSessionIds.length > 0
          ? 'completed'
          : currentState.failedSessionIds.length > 0
            ? 'failed'
            : 'not-started';

    states[workstreamId] = currentState;
  }

  return states;
}

export function evaluateWorkflowSpawnGate(params: {
  plan?: Pick<AgentRunPlan, 'workstreams'>;
  workers: ReadonlyArray<Pick<SubAgentSnapshot, 'workstreamId' | 'sessionId' | 'status'>>;
  workstreamId?: string;
  dependsOnWorkstreams?: string[];
}): WorkflowSpawnGateResult {
  const normalizedWorkstreams = normalizeWorkflowWorkstreams(params.plan?.workstreams);
  const executionStates = getWorkflowExecutionStates(normalizedWorkstreams, params.workers);
  const effectiveWorkstreamId = trimText(params.workstreamId);
  const plannedWorkstream = effectiveWorkstreamId
    ? normalizedWorkstreams.find((workstream) => workstream.id === effectiveWorkstreamId)
    : undefined;

  const dependencyIds = Array.from(
    new Set(
      [
        ...(plannedWorkstream?.dependencies ?? []),
        ...(params.dependsOnWorkstreams ?? [])
          .map((dependency) => {
            const normalizedDependency = normalizeWorkflowDependencyReference(dependency);
            if (!normalizedDependency) {
              return undefined;
            }

            return (
              resolveWorkflowWorkstreamReference(normalizedWorkstreams, normalizedDependency) ??
              normalizedDependency
            );
          })
          .filter((dependency): dependency is string => Boolean(dependency)),
      ].filter((dependencyId) => dependencyId !== effectiveWorkstreamId),
    ),
  );

  const duplicateRunningSessionIds = effectiveWorkstreamId
    ? (executionStates[effectiveWorkstreamId]?.runningSessionIds ?? [])
    : [];
  const duplicateCompletedSessionIds = effectiveWorkstreamId
    ? (executionStates[effectiveWorkstreamId]?.completedSessionIds ?? [])
    : [];

  const blockingDependencies = dependencyIds.reduce<WorkflowBlockingDependency[]>(
    (accumulator, dependencyId) => {
      const state = executionStates[dependencyId] ?? {
        workstreamId: dependencyId,
        status: 'not-started' as WorkflowExecutionStatus,
        runningSessionIds: [],
        completedSessionIds: [],
        failedSessionIds: [],
      };

      if (state.completedSessionIds.length > 0) {
        return accumulator;
      }

      accumulator.push({
        workstreamId: dependencyId,
        title: state.title,
        status: state.status,
        sessionIds:
          state.runningSessionIds.length > 0
            ? [...state.runningSessionIds]
            : [...state.failedSessionIds],
      });
      return accumulator;
    },
    [],
  );

  return {
    status:
      duplicateRunningSessionIds.length > 0 ||
      duplicateCompletedSessionIds.length > 0 ||
      blockingDependencies.length > 0
        ? 'blocked'
        : 'ready',
    ...(effectiveWorkstreamId ? { workstreamId: effectiveWorkstreamId } : {}),
    dependencyIds,
    unmetDependencyIds: blockingDependencies.map((dependency) => dependency.workstreamId),
    duplicateRunningSessionIds,
    duplicateCompletedSessionIds,
    blockingDependencies,
  };
}

function buildWorkflowPlanContinuationSummary(params: {
  totalWorkstreams: number;
  runningWorkstreams: WorkflowContinuationWorkstreamState[];
  readyWorkstreams: WorkflowContinuationWorkstreamState[];
  blockedWorkstreams: WorkflowContinuationWorkstreamState[];
}): string {
  if (params.totalWorkstreams <= 0) {
    return 'No structured workstreams remain. Ready for Pilot review.';
  }

  const remainingCount =
    params.runningWorkstreams.length +
    params.readyWorkstreams.length +
    params.blockedWorkstreams.length;
  if (remainingCount <= 0) {
    return params.totalWorkstreams === 1
      ? 'The only structured workstream is complete. Ready for Pilot review.'
      : `All ${params.totalWorkstreams} structured workstreams are complete. Ready for Pilot review.`;
  }

  const readyFailedCount = params.readyWorkstreams.filter(
    (workstream) => workstream.status === 'failed',
  ).length;
  const readyFreshCount = params.readyWorkstreams.length - readyFailedCount;
  const statusParts: string[] = [];

  if (params.runningWorkstreams.length > 0) {
    statusParts.push(`${params.runningWorkstreams.length} running`);
  }
  if (readyFreshCount > 0) {
    statusParts.push(`${readyFreshCount} ready`);
  }
  if (readyFailedCount > 0) {
    statusParts.push(`${readyFailedCount} failed and ready for repair`);
  }
  if (params.blockedWorkstreams.length > 0) {
    statusParts.push(`${params.blockedWorkstreams.length} blocked`);
  }

  const statusSummary = statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';

  return `Structured plan still has remaining work${statusSummary}. Continue the existing run instead of handing off to Pilot yet.`;
}

export function evaluateWorkflowPlanContinuation(params: {
  plan?: Pick<AgentRunPlan, 'workstreams'>;
  workers: ReadonlyArray<Pick<SubAgentSnapshot, 'workstreamId' | 'sessionId' | 'status'>>;
}): WorkflowPlanContinuationResult {
  const normalizedWorkstreams = normalizeWorkflowWorkstreams(params.plan?.workstreams);
  if (normalizedWorkstreams.length <= 0) {
    return {
      status: 'ready-for-pilot',
      hasStructuredPlan: false,
      totalWorkstreams: 0,
      completedWorkstreams: [],
      runningWorkstreams: [],
      readyWorkstreams: [],
      blockedWorkstreams: [],
      summary: 'No structured workstreams remain. Ready for Pilot review.',
    };
  }

  const executionStates = getWorkflowExecutionStates(normalizedWorkstreams, params.workers);
  const completedWorkstreams: WorkflowExecutionState[] = [];
  const runningWorkstreams: WorkflowContinuationWorkstreamState[] = [];
  const readyWorkstreams: WorkflowContinuationWorkstreamState[] = [];
  const blockedWorkstreams: WorkflowContinuationWorkstreamState[] = [];

  for (const workstream of normalizedWorkstreams) {
    const executionState = executionStates[workstream.id] ?? {
      workstreamId: workstream.id,
      title: workstream.title,
      status: 'not-started' as WorkflowExecutionStatus,
      runningSessionIds: [],
      completedSessionIds: [],
      failedSessionIds: [],
    };

    if (executionState.status === 'completed') {
      completedWorkstreams.push(executionState);
      continue;
    }

    const dependencyIds = [...(workstream.dependencies ?? [])];
    const unmetDependencyIds = dependencyIds.filter((dependencyId) => {
      const dependencyState = executionStates[dependencyId];
      return (dependencyState?.completedSessionIds.length ?? 0) <= 0;
    });

    const continuationState: WorkflowContinuationWorkstreamState = {
      ...executionState,
      title: workstream.title,
      dependencyIds,
      unmetDependencyIds,
    };

    if (executionState.status === 'running') {
      runningWorkstreams.push(continuationState);
      continue;
    }

    if (unmetDependencyIds.length > 0) {
      blockedWorkstreams.push(continuationState);
      continue;
    }

    readyWorkstreams.push(continuationState);
  }

  const summary = buildWorkflowPlanContinuationSummary({
    totalWorkstreams: normalizedWorkstreams.length,
    runningWorkstreams,
    readyWorkstreams,
    blockedWorkstreams,
  });

  return {
    status:
      runningWorkstreams.length > 0 || readyWorkstreams.length > 0 || blockedWorkstreams.length > 0
        ? 'continue'
        : 'ready-for-pilot',
    hasStructuredPlan: true,
    totalWorkstreams: normalizedWorkstreams.length,
    completedWorkstreams,
    runningWorkstreams,
    readyWorkstreams,
    blockedWorkstreams,
    summary,
  };
}
