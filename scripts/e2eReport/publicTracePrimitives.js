const { createHash } = require('crypto');

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAX_TRACE_ITEMS = 512;

const SAFE_PUBLIC_TOOL_NAMES = new Set([
  'memory_recall',
  'tool_catalog',
  'tool_describe',
  'update_goals',
  'write_file',
]);

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function boundedString(value, maxLength = 512) {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function hashPrivateString(value) {
  const text = String(value ?? '');
  return {
    hash: `sha256:${createHash('sha256').update(text).digest('hex')}`,
    length: text.length,
  };
}

function projectHash(value) {
  const source = asRecord(value);
  const length = source ? nonNegativeInteger(source.length) : null;
  if (
    !source ||
    typeof source.hash !== 'string' ||
    !SHA256_PATTERN.test(source.hash) ||
    length === null
  ) {
    return null;
  }
  return { hash: source.hash, length };
}

function projectHashArray(value, limit = MAX_TRACE_ITEMS) {
  if (!Array.isArray(value)) {
    return null;
  }
  const projected = [];
  for (const item of value.slice(0, limit)) {
    const hash = projectHash(item);
    if (!hash) {
      return null;
    }
    projected.push(hash);
  }
  return projected;
}

function projectArray(value, projector, limit = MAX_TRACE_ITEMS) {
  if (!Array.isArray(value)) {
    return null;
  }
  const projected = [];
  for (const item of value.slice(0, limit)) {
    const next = projector(item);
    if (next === null || next === undefined) {
      return null;
    }
    projected.push(next);
  }
  return projected;
}

function safeEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

function safePublicToolName(value) {
  return typeof value === 'string' && SAFE_PUBLIC_TOOL_NAMES.has(value) ? value : undefined;
}

function projectSafeToolNameArray(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  return Array.from(
    new Set(value.map(safePublicToolName).filter((name) => typeof name === 'string')),
  ).sort((left, right) => left.localeCompare(right));
}

module.exports = {
  MAX_TRACE_ITEMS,
  SHA256_PATTERN,
  asRecord,
  boundedString,
  finiteNumber,
  hashPrivateString,
  nonNegativeInteger,
  projectArray,
  projectHash,
  projectHashArray,
  projectSafeToolNameArray,
  safeEnum,
  safePublicToolName,
};
