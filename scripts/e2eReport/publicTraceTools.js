const { projectGoalHashesByStatus } = require('./publicTraceGoals');
const {
  MAX_TRACE_ITEMS,
  SHA256_PATTERN,
  asRecord,
  nonNegativeInteger,
  projectArray,
  projectHash,
  projectHashArray,
  projectSafeToolNameArray,
  safeEnum,
  safePublicToolName,
} = require('./publicTracePrimitives');
const { projectValueFingerprint } = require('./publicTraceValues');

const SAFE_TOOL_STATUSES = new Set([
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
]);

const SAFE_GOAL_ACTIONS = new Set(['add', 'complete', 'activate', 'block', 'remove', 'update']);
const SAFE_GOAL_ERROR_CODES = new Set([
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
const SAFE_TOOL_CAPABILITIES = new Set([
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
const SAFE_CATALOG_MODES = new Set(['describe', 'search']);
const SAFE_CATALOG_CATEGORIES = new Set([
  'files',
  'browser',
  'workspace',
  'web',
  'canvas',
  'ssh',
  'expo',
  'github',
  'sessions',
  'agents',
  'calendar',
  'contacts',
  'native',
  'media',
  'memory',
  'pdf',
  'interaction',
  'mcp',
  'skills',
]);
const SAFE_STATUS_FIELD_PATHS = new Set(['ok', 'status', 'code', 'errorClass', 'error']);

function projectToolCall(value) {
  const source = asRecord(value);
  const toolCallIdHash = source ? projectHash(source.toolCallIdHash) : null;
  const nameHash = source ? projectHash(source.nameHash) : null;
  const argumentsHash = source ? projectHash(source.argumentsHash) : null;
  const argumentFieldCount = source ? nonNegativeInteger(source.argumentFieldCount) : null;
  if (
    !source ||
    !toolCallIdHash ||
    !nameHash ||
    !argumentsHash ||
    argumentFieldCount === null ||
    typeof source.argumentSchemaDigest !== 'string' ||
    !SHA256_PATTERN.test(source.argumentSchemaDigest)
  ) {
    return null;
  }
  const name = safePublicToolName(source.name);
  return {
    toolCallIdHash,
    ...(name ? { name } : {}),
    nameHash,
    argumentsHash,
    argumentFieldCount,
    argumentSchemaDigest: source.argumentSchemaDigest,
  };
}

function projectStatusField(value) {
  const projected = projectValueFingerprint(value, SAFE_STATUS_FIELD_PATHS);
  const source = asRecord(value);
  if (!projected || !source) {
    return null;
  }
  const enumValue = safeEnum(source.enumValue, SAFE_TOOL_STATUSES);
  return { ...projected, ...(enumValue ? { enumValue } : {}) };
}

function projectUpdateGoalsResult(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const errorCount = nonNegativeInteger(source.errorCount);
  const structuredErrorCodeCount = nonNegativeInteger(source.structuredErrorCodeCount);
  const structuredErrorCodes = Array.isArray(source.structuredErrorCodes)
    ? source.structuredErrorCodes.filter((code) => SAFE_GOAL_ERROR_CODES.has(code)).slice(0, 64)
    : null;
  const structuredErrorCodeHashes = projectHashArray(source.structuredErrorCodeHashes, 64);
  const goalIdHashesByStatus = projectGoalHashesByStatus(source.goalIdHashesByStatus);
  if (
    errorCount === null ||
    structuredErrorCodeCount === null ||
    !structuredErrorCodes ||
    !structuredErrorCodeHashes ||
    !goalIdHashesByStatus
  ) {
    return null;
  }
  const status = safeEnum(source.status, SAFE_TOOL_STATUSES);
  const action = safeEnum(source.action, SAFE_GOAL_ACTIONS);
  const statusHash = source.statusHash === undefined ? undefined : projectHash(source.statusHash);
  const actionHash = source.actionHash === undefined ? undefined : projectHash(source.actionHash);
  if (
    (source.statusHash !== undefined && !statusHash) ||
    (source.actionHash !== undefined && !actionHash)
  ) {
    return null;
  }
  return {
    ...(status ? { status } : {}),
    ...(statusHash ? { statusHash } : {}),
    ...(action ? { action } : {}),
    ...(actionHash ? { actionHash } : {}),
    errorCount,
    structuredErrorCodeCount,
    structuredErrorCodes,
    structuredErrorCodeHashes,
    goalIdHashesByStatus,
  };
}

function projectToolCatalogResult(value) {
  const source = asRecord(value);
  if (!source) {
    return null;
  }
  const capabilityCount = nonNegativeInteger(source.capabilityCount);
  const capabilityHashes = projectHashArray(source.capabilityHashes, 64);
  const toolNames = projectSafeToolNameArray(source.toolNames);
  const toolNameHashes = projectHashArray(source.toolNameHashes, MAX_TRACE_ITEMS);
  const activationNames = projectSafeToolNameArray(source.activationNames);
  const activationNameHashes = projectHashArray(source.activationNameHashes, MAX_TRACE_ITEMS);
  if (
    capabilityCount === null ||
    !capabilityHashes ||
    !toolNames ||
    !toolNameHashes ||
    !activationNames ||
    !activationNameHashes ||
    !Array.isArray(source.capabilities)
  ) {
    return null;
  }
  const mode = safeEnum(source.mode, SAFE_CATALOG_MODES);
  const category = safeEnum(source.category, SAFE_CATALOG_CATEGORIES);
  const modeHash = source.modeHash === undefined ? undefined : projectHash(source.modeHash);
  const categoryHash =
    source.categoryHash === undefined ? undefined : projectHash(source.categoryHash);
  if (
    (source.modeHash !== undefined && !modeHash) ||
    (source.categoryHash !== undefined && !categoryHash)
  ) {
    return null;
  }
  const totalMatches =
    source.totalMatches === undefined ? undefined : nonNegativeInteger(source.totalMatches);
  if (source.totalMatches !== undefined && totalMatches === null) {
    return null;
  }
  return {
    ...(mode ? { mode } : {}),
    ...(modeHash ? { modeHash } : {}),
    ...(category ? { category } : {}),
    ...(categoryHash ? { categoryHash } : {}),
    capabilities: source.capabilities
      .filter((capability) => SAFE_TOOL_CAPABILITIES.has(capability))
      .slice(0, 64),
    capabilityCount,
    capabilityHashes,
    ...(totalMatches !== undefined ? { totalMatches } : {}),
    toolNames,
    toolNameHashes,
    activationNames,
    activationNameHashes,
  };
}

function projectToolResult(value) {
  const source = asRecord(value);
  const toolCallIdHash = source ? projectHash(source.toolCallIdHash) : null;
  const nameHash = source ? projectHash(source.nameHash) : null;
  const contentHash = source ? projectHash(source.contentHash) : null;
  const statusFields = source
    ? projectArray(source.statusFields, projectStatusField, SAFE_STATUS_FIELD_PATHS.size)
    : null;
  if (
    !source ||
    !toolCallIdHash ||
    !nameHash ||
    typeof source.isError !== 'boolean' ||
    !contentHash ||
    typeof source.jsonSchemaDigest !== 'string' ||
    !SHA256_PATTERN.test(source.jsonSchemaDigest) ||
    !statusFields
  ) {
    return null;
  }
  const name = safePublicToolName(source.name);
  const projected = {
    toolCallIdHash,
    ...(name ? { name } : {}),
    nameHash,
    isError: source.isError,
    contentHash,
    jsonSchemaDigest: source.jsonSchemaDigest,
    statusFields,
  };
  if (source.updateGoalsResult !== undefined) {
    const updateGoalsResult = projectUpdateGoalsResult(source.updateGoalsResult);
    if (!updateGoalsResult) {
      return null;
    }
    projected.updateGoalsResult = updateGoalsResult;
  }
  if (source.toolCatalogResult !== undefined) {
    const toolCatalogResult = projectToolCatalogResult(source.toolCatalogResult);
    if (!toolCatalogResult) {
      return null;
    }
    projected.toolCatalogResult = toolCatalogResult;
  }
  return projected;
}

module.exports = { projectToolCall, projectToolResult };
