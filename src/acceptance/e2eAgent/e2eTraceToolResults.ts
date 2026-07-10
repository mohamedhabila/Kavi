import { TOOL_CATALOG_AVAILABLE_CATEGORIES } from '../../engine/tools/builtin-tool-catalogConfig';
import type { ToolCapability } from '../../engine/tools/capabilityRegistry';
import type { GoalValidationErrorCode } from '../../engine/goals/validation';
import type { AgentGoalMutation } from '../../engine/goals/types';
import type { AgentGoal } from '../../types/agentRun';
import type { E2EToolCallRecord, E2EToolResultRecord } from './types';
import {
  buildValueFingerprint,
  hashString,
  parseJsonObject,
  parseJsonValue,
  readFieldPath,
  schemaDigest,
  uniqueSorted,
  type E2ERedactedHash,
  type E2ERedactedValueFingerprint,
} from './e2eTraceRedaction';
import { buildRedactedToolName, buildRedactedToolNameList } from './e2eTraceToolNames';

const SAFE_TOOL_STATUSES = [
  'active',
  'awaiting_review',
  'awaiting_tool_results',
  'blocked',
  'cancel_requested',
  'cancelled',
  'completed',
  'created',
  'deleted',
  'duplicate',
  'error',
  'failed',
  'finalized',
  'model_turn',
  'not_found',
  'ok',
  'partial',
  'pending',
  'ready',
  'recovering',
  'retrying',
  'running',
  'scheduled',
  'success',
  'timeout',
  'unsupported',
  'updated',
  'waiting_async',
  'yielded',
] as const;

type E2ESafeToolStatus = (typeof SAFE_TOOL_STATUSES)[number];
type E2ESafeGoalAction = AgentGoalMutation['action'];
type E2ESafeToolCatalogMode = 'describe' | 'search';

export type E2ERedactedToolCallTrace = {
  toolCallIdHash: E2ERedactedHash;
  name?: string;
  nameHash: E2ERedactedHash;
  argumentsHash: E2ERedactedHash;
  argumentFieldCount: number;
  argumentSchemaDigest: string;
};

export type E2ERedactedStatusFieldTrace = E2ERedactedValueFingerprint & {
  enumValue?: E2ESafeToolStatus;
};

export type E2ERedactedUpdateGoalsResultTrace = {
  status?: E2ESafeToolStatus;
  statusHash?: E2ERedactedHash;
  action?: E2ESafeGoalAction;
  actionHash?: E2ERedactedHash;
  errorCount: number;
  structuredErrorCodeCount: number;
  structuredErrorCodes: GoalValidationErrorCode[];
  structuredErrorCodeHashes: E2ERedactedHash[];
  goalIdHashesByStatus: Record<AgentGoal['status'], E2ERedactedHash[]>;
};

export type E2ERedactedToolCatalogResultTrace = {
  mode?: E2ESafeToolCatalogMode;
  modeHash?: E2ERedactedHash;
  category?: string;
  categoryHash?: E2ERedactedHash;
  capabilities: ToolCapability[];
  capabilityCount: number;
  capabilityHashes: E2ERedactedHash[];
  totalMatches?: number;
  toolNames: string[];
  toolNameHashes: E2ERedactedHash[];
  activationNames: string[];
  activationNameHashes: E2ERedactedHash[];
};

export type E2ERedactedToolResultTrace = {
  toolCallIdHash: E2ERedactedHash;
  name?: string;
  nameHash: E2ERedactedHash;
  isError: boolean;
  contentHash: E2ERedactedHash;
  jsonSchemaDigest: string;
  statusFields: E2ERedactedStatusFieldTrace[];
  updateGoalsResult?: E2ERedactedUpdateGoalsResultTrace;
  toolCatalogResult?: E2ERedactedToolCatalogResultTrace;
};

const STATUS_FIELD_PATHS = ['ok', 'status', 'code', 'errorClass', 'error'] as const;
const GOAL_STATUSES = new Set<AgentGoal['status']>(['pending', 'active', 'completed', 'blocked']);
const SAFE_TOOL_STATUS_SET = new Set<string>(SAFE_TOOL_STATUSES);
const SAFE_GOAL_ACTION_SET = new Set<string>([
  'add',
  'complete',
  'activate',
  'block',
  'remove',
  'update',
]);
const SAFE_GOAL_VALIDATION_ERROR_CODE_SET = new Set<string>([
  'missing_title',
  'missing_completion_policy',
  'missing_success_criteria',
  'weak_success_criteria',
  'invalid_success_criteria',
  'goal_not_found',
  'duplicate_id',
  'dependency_missing',
  'cycle_detected',
  'invalid_lifecycle',
  'evidence_required',
  'evidence_satisfied',
  'invalid_block',
  'invalid_update_action',
  'invalid_add_status',
]);
const SAFE_TOOL_CAPABILITY_SET = new Set<string>([
  'discover',
  'read',
  'write',
  'commit',
  'push',
  'deploy',
  'monitor',
  'wait',
  'verify',
  'coordinate',
  'compute',
]);
const SAFE_TOOL_CATALOG_MODE_SET = new Set<string>(['describe', 'search']);
const SAFE_TOOL_CATALOG_CATEGORY_SET = new Set<string>(TOOL_CATALOG_AVAILABLE_CATEGORIES);
export function buildToolCallTrace(call: E2EToolCallRecord): E2ERedactedToolCallTrace {
  const parsedArguments = parseJsonObject(call.arguments);
  return {
    toolCallIdHash: hashString(call.id),
    ...buildRedactedToolName(call.name),
    argumentsHash: hashString(call.arguments || '{}'),
    argumentFieldCount: parsedArguments ? Object.keys(parsedArguments).length : 0,
    argumentSchemaDigest: schemaDigest(parsedArguments ?? parseJsonValue(call.arguments)),
  };
}

function safeAllowedString<T extends string>(
  value: unknown,
  allowedValues: ReadonlySet<string>,
): T | undefined {
  return typeof value === 'string' && allowedValues.has(value) ? (value as T) : undefined;
}

function buildStatusFieldTrace(
  fieldPath: (typeof STATUS_FIELD_PATHS)[number],
  value: unknown,
): E2ERedactedStatusFieldTrace | null {
  const fingerprint = buildValueFingerprint(fieldPath, value);
  if (!fingerprint) {
    return null;
  }
  const enumValue =
    fieldPath === 'status'
      ? safeAllowedString<E2ESafeToolStatus>(value, SAFE_TOOL_STATUS_SET)
      : undefined;
  return {
    ...fingerprint,
    ...(enumValue ? { enumValue } : {}),
  };
}

export function buildToolResultTrace(result: E2EToolResultRecord): E2ERedactedToolResultTrace {
  const parsed = parseJsonValue(result.content);
  const statusFields = STATUS_FIELD_PATHS.map((fieldPath) =>
    buildStatusFieldTrace(fieldPath, readFieldPath(parsed, fieldPath)),
  ).filter((entry): entry is E2ERedactedStatusFieldTrace => Boolean(entry));

  return {
    toolCallIdHash: hashString(result.toolCallId),
    ...buildRedactedToolName(result.name),
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

function buildGoalIdHashesByStatusFromJson(
  goals: unknown,
): Record<AgentGoal['status'], E2ERedactedHash[]> {
  const byStatus: Record<AgentGoal['status'], string[]> = {
    pending: [],
    active: [],
    completed: [],
    blocked: [],
  };
  if (Array.isArray(goals)) {
    for (const goal of goals) {
      if (!goal || typeof goal !== 'object' || Array.isArray(goal)) {
        continue;
      }
      const record = goal as Record<string, unknown>;
      if (typeof record.id === 'string' && isGoalStatus(record.status)) {
        byStatus[record.status].push(record.id);
      }
    }
  }

  const hashIds = (ids: string[]) =>
    uniqueSorted(ids)
      .map(hashString)
      .sort((left, right) => left.hash.localeCompare(right.hash));
  return {
    pending: hashIds(byStatus.pending),
    active: hashIds(byStatus.active),
    completed: hashIds(byStatus.completed),
    blocked: hashIds(byStatus.blocked),
  };
}

function hashOptionalString(value: unknown): E2ERedactedHash | undefined {
  return typeof value === 'string' && value.length > 0 ? hashString(value) : undefined;
}

function buildUpdateGoalsResultTrace(parsed: unknown): E2ERedactedUpdateGoalsResultTrace {
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const structuredErrors = Array.isArray(record.structuredErrors) ? record.structuredErrors : [];
  const allStructuredErrorCodes = uniqueSorted(
    structuredErrors
      .map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry as Record<string, unknown>).code
          : undefined,
      )
      .filter((code): code is string => typeof code === 'string'),
  );
  const status = safeAllowedString<E2ESafeToolStatus>(record.status, SAFE_TOOL_STATUS_SET);
  const action = safeAllowedString<E2ESafeGoalAction>(record.action, SAFE_GOAL_ACTION_SET);
  const statusHash = hashOptionalString(record.status);
  const actionHash = hashOptionalString(record.action);
  return {
    ...(status ? { status } : {}),
    ...(statusHash ? { statusHash } : {}),
    ...(action ? { action } : {}),
    ...(actionHash ? { actionHash } : {}),
    errorCount: Array.isArray(record.errors) ? record.errors.length : 0,
    structuredErrorCodeCount: allStructuredErrorCodes.length,
    structuredErrorCodes: allStructuredErrorCodes.filter((code) =>
      SAFE_GOAL_VALIDATION_ERROR_CODE_SET.has(code),
    ) as GoalValidationErrorCode[],
    structuredErrorCodeHashes: allStructuredErrorCodes.map(hashString),
    goalIdHashesByStatus: buildGoalIdHashesByStatusFromJson(record.goals),
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
  const allCapabilities = Array.isArray(record.capabilities)
    ? uniqueSorted(
        record.capabilities.filter((value): value is string => typeof value === 'string'),
      )
    : [];
  const mode = safeAllowedString<E2ESafeToolCatalogMode>(record.mode, SAFE_TOOL_CATALOG_MODE_SET);
  const category = safeAllowedString<string>(record.category, SAFE_TOOL_CATALOG_CATEGORY_SET);
  const modeHash = hashOptionalString(record.mode);
  const categoryHash = hashOptionalString(record.category);
  const redactedToolNames = buildRedactedToolNameList(toolNames);
  const redactedActivationNames = buildRedactedToolNameList(activationNames);

  return {
    ...(mode ? { mode } : {}),
    ...(modeHash ? { modeHash } : {}),
    ...(category ? { category } : {}),
    ...(categoryHash ? { categoryHash } : {}),
    capabilities: allCapabilities.filter((capability) =>
      SAFE_TOOL_CAPABILITY_SET.has(capability),
    ) as ToolCapability[],
    capabilityCount: allCapabilities.length,
    capabilityHashes: allCapabilities.map(hashString),
    ...(typeof record.totalMatches === 'number' ? { totalMatches: record.totalMatches } : {}),
    toolNames: redactedToolNames.names,
    toolNameHashes: redactedToolNames.nameHashes,
    activationNames: redactedActivationNames.names,
    activationNameHashes: redactedActivationNames.nameHashes,
  };
}
