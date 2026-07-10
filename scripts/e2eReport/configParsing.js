function parseOptionalStrictPositiveInteger(rawValue, label) {
  if (rawValue === undefined || String(rawValue).trim().length === 0) {
    return undefined;
  }
  const normalized = String(rawValue).trim();
  if (!/^[1-9][0-9]*$/u.test(normalized)) {
    throw new Error(`${label} must be a positive base-10 integer.`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return parsed;
}

module.exports = { parseOptionalStrictPositiveInteger };
