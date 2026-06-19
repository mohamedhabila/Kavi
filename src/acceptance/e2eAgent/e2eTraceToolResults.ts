import type { AgentGoal } from '../../types/agentRun';
import type { E2EToolCallRecord, E2EToolResultRecord } from './types';
import {
  MAX_SAFE_PREVIEW_LENGTH,
  buildValuePreview,
  canPreviewStringField,
  hashString,
  parseJsonObject,
  parseJsonValue,
  readFieldPath,
  schemaDigest,
  uniqueSorted,
  type E2ERedactedHash,
  type E2ERedactedValuePreview,
} from './e2eTraceRedaction';

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

const STATUS_FIELD_PATHS = ['ok', 'status', 'code', 'errorClass', 'error'] as const;
const GOAL_STATUSES = new Set<AgentGoal['status']>(['pending', 'active', 'completed', 'blocked']);

export function buildToolCallTrace(call: E2EToolCallRecord): E2ERedactedToolCallTrace {
  const parsedArguments = parseJsonObject(call.arguments);
  return {
    id: call.id,
    name: call.name,
    argumentsHash: hashString(call.arguments || '{}'),
    argumentKeys: parsedArguments ? uniqueSorted(Object.keys(parsedArguments)) : [],
    argumentSchemaDigest: schemaDigest(parsedArguments ?? parseJsonValue(call.arguments)),
  };
}

export function buildToolResultTrace(result: E2EToolResultRecord): E2ERedactedToolResultTrace {
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
