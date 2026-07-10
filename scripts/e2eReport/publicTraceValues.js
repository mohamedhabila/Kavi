const { SHA256_PATTERN, asRecord, nonNegativeInteger } = require('./publicTracePrimitives');

const SAFE_VALUE_TYPES = new Set([
  'array',
  'boolean',
  'null',
  'number',
  'object',
  'string',
  'undefined',
]);

function projectValueFingerprint(value, allowedPaths) {
  const source = asRecord(value);
  if (!source || !allowedPaths.has(source.fieldPath) || !SAFE_VALUE_TYPES.has(source.valueType)) {
    return null;
  }
  if (typeof source.valueHash !== 'string' || !SHA256_PATTERN.test(source.valueHash)) {
    return null;
  }
  const projected = {
    fieldPath: source.fieldPath,
    valueType: source.valueType,
    valueHash: source.valueHash,
  };
  if (source.count !== undefined) {
    const count = nonNegativeInteger(source.count);
    if (count === null) {
      return null;
    }
    projected.count = count;
  }
  return projected;
}

module.exports = { projectValueFingerprint };
