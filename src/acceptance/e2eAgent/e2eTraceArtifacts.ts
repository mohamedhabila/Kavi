import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

import type {
  AgentGoal,
  AgentRunControlGraphAuditEvent,
  AgentRunControlGraphState,
} from '../../types/agentRun';
import type { UsagePromptCacheTelemetry, UsageTokenBuckets } from '../../types/usage';
import { getE2ENativeMobileFixtureStateSnapshot } from '../../engine/tools/e2eNativeCalendarFixtures';
import type {
  E2EPromptCacheSummary,
  E2ERubric,
  E2EScenarioResult,
  E2EScenarioTurnTrace,
  E2ETokenUsageSummary,
  E2EToolCallRecord,
  E2EToolResultRecord,
} from './types';

export type E2ETraceRetentionReason = 'failed' | 'sampled_pass';

export type E2ERunReportScenarioTraceArtifact = {
  path: string;
  relativePath: string;
  retentionReason: E2ETraceRetentionReason;
};

export type E2ERedactedHash = {
  hash: string;
  length: number;
};

export type E2ERedactedValuePreview = {
  fieldPath: string;
  type: string;
  hash: string;
  preview?: string | number | boolean | null;
};

export type E2ERedactedStructuralString = E2ERedactedHash & {
  preview?: string;
};

export type E2ERedactedEvidencePrefixCount = {
  prefix: string;
  count: number;
};

export type E2ERedactedGoalTrace = {
  id: string;
  status: AgentGoal['status'];
  completionPolicy?: AgentGoal['completionPolicy'];
  successCriteria: E2ERedactedStructuralString[];
  evidenceCount: number;
  evidencePrefixCounts: E2ERedactedEvidencePrefixCount[];
};

export type E2ERedactedToolCallTrace = {
  id: string;
  name: string;
  argumentsHash: E2ERedactedHash;
  argumentKeys: string[];
  argumentSchemaDigest: string;
};

export type E2ERedactedUpdateGoalsResultTrace = {
  status?: string;
  action?: string;
  errorCount: number;
  structuredErrorCodes: string[];
  goalIdsByStatus: Record<AgentGoal['status'], string[]>;
};

export type E2ERedactedToolCatalogResultTrace = {
  mode?: string;
  category?: string;
  capabilities: string[];
  totalMatches?: number;
  toolNames: string[];
  activationNames: string[];
};

export type E2ERedactedToolResultTrace = {
  toolCallId: string;
  name: string;
  isError: boolean;
  contentHash: E2ERedactedHash;
  jsonSchemaDigest: string;
  statusFields: E2ERedactedValuePreview[];
  updateGoalsResult?: E2ERedactedUpdateGoalsResultTrace;
  toolCatalogResult?: E2ERedactedToolCatalogResultTrace;
};

export type E2ERedactedGraphSnapshotTrace = {
  status: AgentRunControlGraphState['status'];
  iteration: number;
  finalizationHoldReason?: string;
  terminalReason?: string;
  activeTaskId?: string;
  goalIdsByStatus: Record<AgentGoal['status'], string[]>;
  goalSummaries: E2ERedactedGoalTrace[];
  expectedToolNames: string[];
  observedToolResults: Array<{
    name: string;
    failed: boolean;
    canonicalized: boolean;
    graphApplied: boolean;
    evidenceCount: number;
    evidencePrefixCounts: E2ERedactedEvidencePrefixCount[];
  }>;
  pendingAsyncCount: number;
  lastModelToolNames: string[];
  sessionActivatedToolNames: string[];
  auditEventCount: number;
  selectedToolSurfaceEventCount: number;
  observedToolResultCount: number;
  auditEvents: E2ERedactedGraphAuditEvent[];
  selectedToolSurfaceEvents: E2ERedactedGraphAuditEvent[];
  performance: Pick<
    AgentRunControlGraphState['performance'],
    | 'lastCandidateToolCount'
    | 'lastActiveToolCount'
    | 'maxActiveToolCount'
    | 'lastActiveToolTokenEstimate'
    | 'maxActiveToolTokenEstimate'
  >;
};

export type E2ERedactedGraphAuditEvent = {
  type: string;
  iteration?: number;
  detailHash?: E2ERedactedHash;
  detailPreview?: string;
};

export type E2ERedactedPromptCacheEvent = Omit<UsagePromptCacheTelemetry, 'explicitCacheName'> & {
  explicitCacheNameHash?: E2ERedactedHash;
};

export type E2ERedactedPromptCacheTrace = Omit<
  E2EPromptCacheSummary,
  'events' | 'explicitCacheNames'
> & {
  explicitCacheNameHashes: E2ERedactedHash[];
  events: E2ERedactedPromptCacheEvent[];
};

export type E2ERedactedUsageTrace = Omit<E2ETokenUsageSummary, 'promptCache'> & {
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: E2ERedactedPromptCacheTrace;
};

export type E2ERedactedTurnTrace = {
  turnIndex: number;
  completed: boolean;
  usage: E2ERedactedUsageTrace;
  toolCalls: E2ERedactedToolCallTrace[];
  toolResults: E2ERedactedToolResultTrace[];
  graphSnapshots: E2ERedactedGraphSnapshotTrace[];
};

export type E2EScenarioTraceSummary = {
  schemaVersion: 'e2e-redacted-trace-v1';
  fixtureId: string;
  conversationIdHash: E2ERedactedHash;
  completed: boolean;
  durationMs: number;
  userTurnCount: number;
  turnCount: number;
  toolCallCount: number;
  graphStatus: string | null;
  errors: E2ERedactedHash[];
  usage: E2ERedactedUsageTrace;
  toolCalls: E2ERedactedToolCallTrace[];
  toolResults: E2ERedactedToolResultTrace[];
  graphSnapshots: E2ERedactedGraphSnapshotTrace[];
  nativeFixtureState: E2ERedactedValuePreview[];
  turns: E2ERedactedTurnTrace[];
};

type TraceableScenarioEntry = {
  fixtureId: string;
  passed: boolean;
  trace?: E2EScenarioTraceSummary;
  traceArtifact?: E2ERunReportScenarioTraceArtifact;
};

type TraceableReport<TScenario extends TraceableScenarioEntry> = {
  generatedAt: string;
  runMetadata: {
    gitSha: string;
    provider: string;
    model: string;
  };
  scenarios: TScenario[];
};

const HASH_PREFIX = 'sha256';
const MAX_SAFE_PREVIEW_LENGTH = 160;
const MAX_SCENARIO_GRAPH_SNAPSHOTS = 12;
const MAX_TURN_GRAPH_SNAPSHOTS = 6;
const MAX_AUDIT_EVENTS_PER_SNAPSHOT = 32;
const MAX_SELECTED_TOOL_SURFACE_EVENTS_PER_SNAPSHOT = 8;
const MAX_OBSERVED_TOOL_RESULTS_PER_SNAPSHOT = 64;
const MAX_NATIVE_FIXTURE_STATE_FIELDS = 96;
const TOOL_SURFACE_AUDIT_TYPE = 'TOOL_SURFACE_SELECTED';
const STATUS_FIELD_PATHS = ['ok', 'status', 'code', 'errorClass', 'error'] as const;
const GOAL_STATUSES = new Set<AgentGoal['status']>(['pending', 'active', 'completed', 'blocked']);
const SAFE_STRING_PREVIEW_FIELD_PATHS = new Set(['status', 'code', 'errorClass']);
const SAFE_STRUCTURED_AUDIT_DETAIL_TYPES = new Set([
  'COMPLETION_GATE',
  'TOOL_SURFACE_SELECTED',
  'TOOL_SURFACE_TOKEN_AUDIT',
  'MEMORY_RETRIEVAL',
  'LOOP_DETECTED',
  'TOOL_BATCH_INCOMPLETE',
]);

function stableHash(value: string): string {
  return `${HASH_PREFIX}:${createHash('sha256').update(value).digest('hex')}`;
}

function hashString(value: string): E2ERedactedHash {
  return {
    hash: stableHash(value),
    length: value.length,
  };
}

function redactStructuralString(value: string): E2ERedactedStructuralString {
  const trimmed = value.trim();
  return {
    ...hashString(trimmed),
    ...(trimmed.length <= MAX_SAFE_PREVIEW_LENGTH ? { preview: trimmed } : {}),
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return '"__undefined__"';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) {
    return 'array';
  }
  if (value === null) {
    return 'null';
  }
  return typeof value;
}

function buildSchemaShape(value: unknown, depth = 0): unknown {
  if (depth >= 4) {
    return valueType(value);
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      item: value.length > 0 ? buildSchemaShape(value[0], depth + 1) : 'empty',
    };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return {
      type: 'object',
      keys: Object.keys(record)
        .sort()
        .map((key) => [key, buildSchemaShape(record[key], depth + 1)]),
    };
  }
  return valueType(value);
}

function schemaDigest(value: unknown): string {
  return stableHash(stableStringify(buildSchemaShape(value)));
}

function readFieldPath(value: unknown, fieldPath: string): unknown {
  if (!fieldPath.trim()) {
    return undefined;
  }

  let current = value;
  for (const segment of fieldPath.split('.')) {
    if (segment === 'length' && Array.isArray(current)) {
      current = current.length;
      continue;
    }
    const arrayIndex = Number(segment);
    if (
      Array.isArray(current) &&
      Number.isInteger(arrayIndex) &&
      arrayIndex >= 0 &&
      String(arrayIndex) === segment
    ) {
      current = current[arrayIndex];
      continue;
    }
    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function canPreviewStringField(fieldPath: string): boolean {
  const segments = fieldPath.split('.');
  const leafField = segments[segments.length - 1] ?? fieldPath;
  return SAFE_STRING_PREVIEW_FIELD_PATHS.has(leafField);
}

function buildValuePreview(
  fieldPath: string,
  value: unknown,
  options?: { allowStringPreview?: boolean },
): E2ERedactedValuePreview | null {
  if (value === undefined) {
    return null;
  }
  const serialized = stableStringify(value);
  const type = valueType(value);
  const preview: E2ERedactedValuePreview = {
    fieldPath,
    type,
    hash: stableHash(serialized),
  };
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    (options?.allowStringPreview === true &&
      typeof value === 'string' &&
      value.length <= MAX_SAFE_PREVIEW_LENGTH)
  ) {
    preview.preview = value;
  }
  return preview;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function tailItems<T>(values: ReadonlyArray<T> | undefined, limit: number): T[] {
  const source = values ?? [];
  return source.slice(Math.max(0, source.length - limit));
}

function buildToolCallTrace(call: E2EToolCallRecord): E2ERedactedToolCallTrace {
  const parsedArguments = parseJsonObject(call.arguments);
  return {
    id: call.id,
    name: call.name,
    argumentsHash: hashString(call.arguments || '{}'),
    argumentKeys: parsedArguments ? uniqueSorted(Object.keys(parsedArguments)) : [],
    argumentSchemaDigest: schemaDigest(parsedArguments ?? parseJsonValue(call.arguments)),
  };
}

function buildToolResultTrace(result: E2EToolResultRecord): E2ERedactedToolResultTrace {
  const parsed = parseJsonValue(result.content);
  const statusFields = STATUS_FIELD_PATHS.map((fieldPath) =>
    buildValuePreview(fieldPath, readFieldPath(parsed, fieldPath), {
      allowStringPreview: canPreviewStringField(fieldPath),
    }),
  ).filter((entry): entry is E2ERedactedValuePreview => Boolean(entry));

  return {
    toolCallId: result.toolCallId,
    name: result.name,
    isError: result.isError,
    contentHash: hashString(result.content),
    jsonSchemaDigest: schemaDigest(parsed),
    statusFields,
    ...(result.name === 'update_goals'
      ? { updateGoalsResult: buildUpdateGoalsResultTrace(parsed) }
      : {}),
    ...(result.name === 'tool_catalog'
      ? { toolCatalogResult: buildToolCatalogResultTrace(parsed) }
      : {}),
  };
}

function isGoalStatus(value: unknown): value is AgentGoal['status'] {
  return typeof value === 'string' && GOAL_STATUSES.has(value as AgentGoal['status']);
}

function buildGoalIdsByStatusFromJson(goals: unknown): Record<AgentGoal['status'], string[]> {
  const byStatus: Record<AgentGoal['status'], string[]> = {
    pending: [],
    active: [],
    completed: [],
    blocked: [],
  };
  if (!Array.isArray(goals)) {
    return byStatus;
  }

  for (const goal of goals) {
    if (!goal || typeof goal !== 'object' || Array.isArray(goal)) {
      continue;
    }
    const record = goal as Record<string, unknown>;
    if (typeof record.id === 'string' && isGoalStatus(record.status)) {
      byStatus[record.status].push(record.id);
    }
  }

  return {
    pending: uniqueSorted(byStatus.pending),
    active: uniqueSorted(byStatus.active),
    completed: uniqueSorted(byStatus.completed),
    blocked: uniqueSorted(byStatus.blocked),
  };
}

function safeShortString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_SAFE_PREVIEW_LENGTH ? value : undefined;
}

function buildUpdateGoalsResultTrace(parsed: unknown): E2ERedactedUpdateGoalsResultTrace {
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const structuredErrors = Array.isArray(record.structuredErrors) ? record.structuredErrors : [];
  const structuredErrorCodes = uniqueSorted(
    structuredErrors
      .map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry as Record<string, unknown>).code
          : undefined,
      )
      .filter((code): code is string => typeof code === 'string'),
  );
  return {
    ...(safeShortString(record.status) ? { status: safeShortString(record.status) } : {}),
    ...(safeShortString(record.action) ? { action: safeShortString(record.action) } : {}),
    errorCount: Array.isArray(record.errors) ? record.errors.length : 0,
    structuredErrorCodes,
    goalIdsByStatus: buildGoalIdsByStatusFromJson(record.goals),
  };
}

function buildToolCatalogResultTrace(parsed: unknown): E2ERedactedToolCatalogResultTrace {
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const tools = Array.isArray(record.tools) ? record.tools : [];
  const toolNames = tools
    .map((tool) =>
      tool && typeof tool === 'object' && !Array.isArray(tool)
        ? (tool as Record<string, unknown>).name
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
  const activationNames = tools
    .map((tool) => {
      if (!tool || typeof tool !== 'object' || Array.isArray(tool)) {
        return undefined;
      }
      const activation = (tool as Record<string, unknown>).activation;
      if (!activation || typeof activation !== 'object' || Array.isArray(activation)) {
        return undefined;
      }
      const name = (activation as Record<string, unknown>).name;
      return typeof name === 'string' ? name : undefined;
    })
    .filter((name): name is string => typeof name === 'string');

  return {
    ...(safeShortString(record.mode) ? { mode: safeShortString(record.mode) } : {}),
    ...(safeShortString(record.category) ? { category: safeShortString(record.category) } : {}),
    capabilities: Array.isArray(record.capabilities)
      ? uniqueSorted(record.capabilities.filter((value): value is string => typeof value === 'string'))
      : [],
    ...(typeof record.totalMatches === 'number' ? { totalMatches: record.totalMatches } : {}),
    toolNames: uniqueSorted(toolNames),
    activationNames: uniqueSorted(activationNames),
  };
}

function buildGoalIdsByStatus(
  goals: ReadonlyArray<AgentGoal> | undefined,
): Record<AgentGoal['status'], string[]> {
  const byStatus: Record<AgentGoal['status'], string[]> = {
    pending: [],
    active: [],
    completed: [],
    blocked: [],
  };
  for (const goal of goals ?? []) {
    byStatus[goal.status].push(goal.id);
  }
  return {
    pending: uniqueSorted(byStatus.pending),
    active: uniqueSorted(byStatus.active),
    completed: uniqueSorted(byStatus.completed),
    blocked: uniqueSorted(byStatus.blocked),
  };
}

function evidencePrefix(value: string): string {
  const separatorIndex = value.indexOf(':');
  return separatorIndex > 0 ? value.slice(0, separatorIndex).trim() : 'unscoped';
}

function buildEvidencePrefixCounts(
  evidence: ReadonlyArray<string> | undefined,
): E2ERedactedEvidencePrefixCount[] {
  const counts = new Map<string, number>();
  for (const entry of evidence ?? []) {
    const prefix = evidencePrefix(entry);
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((left, right) => left.prefix.localeCompare(right.prefix));
}

function buildGoalSummaries(goals: ReadonlyArray<AgentGoal> | undefined): E2ERedactedGoalTrace[] {
  return (goals ?? []).map((goal) => ({
    id: goal.id,
    status: goal.status,
    ...(goal.completionPolicy ? { completionPolicy: goal.completionPolicy } : {}),
    successCriteria: (goal.successCriteria ?? []).map(redactStructuralString),
    evidenceCount: goal.evidence.length,
    evidencePrefixCounts: buildEvidencePrefixCounts(goal.evidence),
  }));
}

function safeAuditDetail(
  type: string,
  detail: string | undefined,
): {
  detailHash?: E2ERedactedHash;
  detailPreview?: string;
} {
  if (!detail?.trim()) {
    return {};
  }
  const trimmed = detail.trim();
  if (!SAFE_STRUCTURED_AUDIT_DETAIL_TYPES.has(type)) {
    return {
      detailHash: hashString(trimmed),
    };
  }
  return {
    detailHash: hashString(trimmed),
    detailPreview:
      trimmed.length > MAX_SAFE_PREVIEW_LENGTH
        ? `${trimmed.slice(0, MAX_SAFE_PREVIEW_LENGTH)}...`
        : trimmed,
  };
}

function buildAuditEventTrace(event: AgentRunControlGraphAuditEvent): E2ERedactedGraphAuditEvent {
  return {
    type: event.type,
    ...(event.iteration !== undefined ? { iteration: event.iteration } : {}),
    ...safeAuditDetail(event.type, event.detail),
  };
}

function buildGraphSnapshotTrace(
  snapshot: AgentRunControlGraphState,
): E2ERedactedGraphSnapshotTrace {
  const sourceAuditEvents = snapshot.audit ?? [];
  const sourceObservedToolResults = snapshot.observedToolResults ?? [];
  const auditEvents = tailItems(sourceAuditEvents, MAX_AUDIT_EVENTS_PER_SNAPSHOT).map(
    buildAuditEventTrace,
  );
  const selectedToolSurfaceEvents = tailItems(
    sourceAuditEvents.filter((event) => event.type === TOOL_SURFACE_AUDIT_TYPE),
    MAX_SELECTED_TOOL_SURFACE_EVENTS_PER_SNAPSHOT,
  ).map(buildAuditEventTrace);
  const performance = snapshot.performance;
  return {
    status: snapshot.status,
    iteration: snapshot.iteration ?? 0,
    ...(snapshot.finalizationHoldReason
      ? { finalizationHoldReason: snapshot.finalizationHoldReason }
      : {}),
    ...(snapshot.terminalReason ? { terminalReason: snapshot.terminalReason } : {}),
    ...(snapshot.activeTaskId ? { activeTaskId: snapshot.activeTaskId } : {}),
    goalIdsByStatus: buildGoalIdsByStatus(snapshot.goals),
    goalSummaries: buildGoalSummaries(snapshot.goals),
    expectedToolNames: uniqueSorted((snapshot.expectedToolCalls ?? []).map((call) => call.name)),
    observedToolResults: tailItems(
      sourceObservedToolResults,
      MAX_OBSERVED_TOOL_RESULTS_PER_SNAPSHOT,
    ).map((result) => ({
      name: result.name,
      failed: result.failed === true,
      canonicalized: result.canonicalized === true,
      graphApplied: result.graphApplied === true,
      evidenceCount: result.evidence?.length ?? 0,
      evidencePrefixCounts: buildEvidencePrefixCounts(result.evidence),
    })),
    pendingAsyncCount: snapshot.pendingAsyncCount ?? 0,
    lastModelToolNames: uniqueSorted(snapshot.lastModelToolNames ?? []),
    sessionActivatedToolNames: uniqueSorted(snapshot.sessionActivatedToolNames ?? []),
    auditEventCount: sourceAuditEvents.length,
    selectedToolSurfaceEventCount: sourceAuditEvents.filter(
      (event) => event.type === TOOL_SURFACE_AUDIT_TYPE,
    ).length,
    observedToolResultCount: sourceObservedToolResults.length,
    auditEvents,
    selectedToolSurfaceEvents,
    performance: {
      lastCandidateToolCount: performance?.lastCandidateToolCount ?? 0,
      lastActiveToolCount: performance?.lastActiveToolCount ?? 0,
      maxActiveToolCount: performance?.maxActiveToolCount ?? 0,
      lastActiveToolTokenEstimate: performance?.lastActiveToolTokenEstimate ?? 0,
      maxActiveToolTokenEstimate: performance?.maxActiveToolTokenEstimate ?? 0,
    },
  };
}

function collectPrimitiveValuePreviews(
  value: unknown,
  path: string[],
  previews: E2ERedactedValuePreview[],
): void {
  if (previews.length >= MAX_NATIVE_FIXTURE_STATE_FIELDS) {
    return;
  }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) {
      const preview = buildValuePreview(path.join('.'), value.length, {
        allowStringPreview: false,
      });
      if (preview) {
        previews.push(preview);
      }
      return;
    }
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      collectPrimitiveValuePreviews(record[key], [...path, key], previews);
      if (previews.length >= MAX_NATIVE_FIXTURE_STATE_FIELDS) {
        return;
      }
    }
    return;
  }

  const fieldPath = path.join('.');
  if (!fieldPath) {
    return;
  }
  const preview = buildValuePreview(fieldPath, value, {
    allowStringPreview: false,
  });
  if (preview) {
    previews.push(preview);
  }
}

function buildNativeFixtureStateTrace(): E2ERedactedValuePreview[] {
  const previews: E2ERedactedValuePreview[] = [];
  collectPrimitiveValuePreviews(getE2ENativeMobileFixtureStateSnapshot(), [], previews);
  return previews;
}

function buildPromptCacheTrace(
  promptCache: E2EPromptCacheSummary | undefined,
): E2ERedactedPromptCacheTrace | undefined {
  if (!promptCache) {
    return undefined;
  }
  return {
    eligibleTurnCount: promptCache.eligibleTurnCount,
    enabledTurnCount: promptCache.enabledTurnCount,
    skippedTurnCount: promptCache.skippedTurnCount,
    createEventCount: promptCache.createEventCount,
    reuseEventCount: promptCache.reuseEventCount,
    providerManagedEventCount: promptCache.providerManagedEventCount,
    thresholdTokens: [...promptCache.thresholdTokens],
    explicitCacheNameHashes: promptCache.explicitCacheNames.map(hashString),
    reasonCounts: [...promptCache.reasonCounts],
    ...(promptCache.prefixStability ? { prefixStability: promptCache.prefixStability } : {}),
    events: promptCache.events.map((event) => ({
      eligible: event.eligible,
      enabled: event.enabled,
      estimatedInputTokens: event.estimatedInputTokens,
      thresholdTokens: event.thresholdTokens,
      providerFamily: event.providerFamily,
      ...(event.hostedFamily ? { hostedFamily: event.hostedFamily } : {}),
      mode: event.mode,
      event: event.event,
      reason: event.reason,
      ...(event.explicitCacheName
        ? { explicitCacheNameHash: hashString(event.explicitCacheName) }
        : {}),
      ...(event.stableSystemPromptDigest
        ? { stableSystemPromptDigest: event.stableSystemPromptDigest }
        : {}),
      ...(event.stableToolDeclarationDigest
        ? { stableToolDeclarationDigest: event.stableToolDeclarationDigest }
        : {}),
      ...(event.cacheablePrefixDigest
        ? { cacheablePrefixDigest: event.cacheablePrefixDigest }
        : {}),
      ...(event.toolDeclarationDigest
        ? { toolDeclarationDigest: event.toolDeclarationDigest }
        : {}),
      ...(event.prefixDivergenceReason
        ? { prefixDivergenceReason: event.prefixDivergenceReason }
        : {}),
    })),
  };
}

function buildUsageTrace(usage: E2ETokenUsageSummary): E2ERedactedUsageTrace {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    eventCount: usage.eventCount,
    ...(usage.tokenBuckets ? { tokenBuckets: { ...usage.tokenBuckets } } : {}),
    ...(usage.promptCache ? { promptCache: buildPromptCacheTrace(usage.promptCache) } : {}),
  };
}

function buildTurnTrace(turn: E2EScenarioTurnTrace): E2ERedactedTurnTrace {
  return {
    turnIndex: turn.turnIndex,
    completed: turn.completed,
    usage: buildUsageTrace(turn.usage),
    toolCalls: turn.toolCalls.map(buildToolCallTrace),
    toolResults: turn.toolResults.map(buildToolResultTrace),
    graphSnapshots: tailItems(turn.graphSnapshots, MAX_TURN_GRAPH_SNAPSHOTS).map(
      buildGraphSnapshotTrace,
    ),
  };
}

export function buildE2EScenarioTraceSummary(params: {
  result: E2EScenarioResult;
  rubrics?: ReadonlyArray<E2ERubric>;
}): E2EScenarioTraceSummary {
  const { result } = params;
  const lastGraph = result.graphSnapshots[result.graphSnapshots.length - 1];
  return {
    schemaVersion: 'e2e-redacted-trace-v1',
    fixtureId: result.fixtureId,
    conversationIdHash: hashString(result.conversationId),
    completed: result.completed,
    durationMs: result.durationMs,
    userTurnCount: result.userTurnCount,
    turnCount: result.turnTraces.length,
    toolCallCount: result.toolCalls.length,
    graphStatus: lastGraph?.status ?? null,
    errors: result.errors.map(hashString),
    usage: buildUsageTrace(result.usage),
    toolCalls: result.toolCalls.map(buildToolCallTrace),
    toolResults: result.toolResults.map(buildToolResultTrace),
    graphSnapshots: tailItems(result.graphSnapshots, MAX_SCENARIO_GRAPH_SNAPSHOTS).map(
      buildGraphSnapshotTrace,
    ),
    nativeFixtureState: buildNativeFixtureStateTrace(),
    turns: result.turnTraces.map(buildTurnTrace),
  };
}

function sanitizeFileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scenario'
  );
}

function shouldRetainScenarioTrace(
  scenario: TraceableScenarioEntry,
  sampledPassAlreadyRetained: boolean,
): E2ETraceRetentionReason | null {
  if (!scenario.trace) {
    return null;
  }
  if (!scenario.passed) {
    return 'failed';
  }
  return sampledPassAlreadyRetained ? null : 'sampled_pass';
}

function omitInlineTrace<TScenario extends TraceableScenarioEntry>(scenario: TScenario): TScenario {
  const { trace: _trace, ...scenarioWithoutTrace } = scenario;
  return scenarioWithoutTrace as TScenario;
}

export function writeE2ERedactedTraceArtifacts<
  TScenario extends TraceableScenarioEntry,
  TReport extends TraceableReport<TScenario>,
>(report: TReport, runDir: string): TReport {
  const traceDirName = 'failed-traces';
  const traceDir = join(runDir, traceDirName);
  const traceIndex: Array<{
    fixtureId: string;
    retentionReason: E2ETraceRetentionReason;
    path: string;
  }> = [];
  let sampledPassRetained = false;
  const scenarios = report.scenarios.map((scenario) => {
    const retentionReason = shouldRetainScenarioTrace(scenario, sampledPassRetained);
    if (!retentionReason || !scenario.trace) {
      return omitInlineTrace(scenario);
    }
    if (retentionReason === 'sampled_pass') {
      sampledPassRetained = true;
    }

    mkdirSync(traceDir, { recursive: true });
    const filename = `${retentionReason}-${sanitizeFileName(scenario.fixtureId)}.json`;
    const relativePath = join(traceDirName, filename);
    const path = join(traceDir, filename);
    const artifact = {
      traceId: `${sanitizeFileName(report.generatedAt)}:${scenario.fixtureId}`,
      generatedAt: report.generatedAt,
      retentionReason,
      provider: report.runMetadata.provider,
      model: report.runMetadata.model,
      gitSha: report.runMetadata.gitSha,
      trace: scenario.trace,
    };
    writeFileSync(path, JSON.stringify(artifact, null, 2), 'utf8');
    traceIndex.push({
      fixtureId: scenario.fixtureId,
      retentionReason,
      path,
    });
    return {
      ...omitInlineTrace(scenario),
      traceArtifact: {
        path,
        relativePath,
        retentionReason,
      },
    };
  });

  if (traceIndex.length > 0) {
    writeFileSync(
      join(traceDir, 'index.json'),
      JSON.stringify(
        {
          schemaVersion: 'e2e-redacted-trace-index-v1',
          generatedAt: report.generatedAt,
          traces: traceIndex,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  return {
    ...report,
    scenarios,
  } as TReport;
}
