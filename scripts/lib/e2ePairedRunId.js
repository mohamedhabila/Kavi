const SAFE_E2E_PAIRED_RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

function requireE2ePairedRunId(value) {
  if (
    typeof value !== 'string' ||
    !SAFE_E2E_PAIRED_RUN_ID_PATTERN.test(value) ||
    value === '.' ||
    value === '..' ||
    value !== value.trim()
  ) {
    throw new Error('E2E_PAIRED_RUN_ID must be a bounded path-free identifier.');
  }
  return value;
}

module.exports = {
  requireE2ePairedRunId,
};
