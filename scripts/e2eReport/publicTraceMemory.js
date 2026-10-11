const { asRecord, nonNegativeInteger } = require('./publicTracePrimitives');

const PROMPT_STATUSES = new Set(['recorded', 'missing', 'opt_out']);

function projectCounts(source, keys) {
  const output = {};
  for (const key of keys) {
    const count = nonNegativeInteger(source[key]);
    if (count === null) return null;
    output[key] = count;
  }
  return output;
}

function projectFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** One turn's memory evidence: prompt builds, and whether and how fast extraction caught up. */
function projectMemoryTurnEvidence(value) {
  const source = asRecord(value);
  if (!source || typeof source.extractionSettled !== 'boolean') return null;
  if (!PROMPT_STATUSES.has(source.promptStatus)) return null;
  const counts = projectCounts(source, [
    'promptBuildCount',
    'promptItemCount',
    'promptTurnCount',
    'maxPromptChars',
  ]);
  const maxPromptBuildMs = projectFiniteNonNegative(source.maxPromptBuildMs);
  const extractionWaitMs = projectFiniteNonNegative(source.extractionWaitMs);
  if (!counts || maxPromptBuildMs === null || extractionWaitMs === null) return null;
  return {
    extractionSettled: source.extractionSettled,
    extractionWaitMs,
    promptStatus: source.promptStatus,
    ...counts,
    maxPromptBuildMs,
  };
}

/** The scenario's final memory: item counts by state and the indexed past turns. */
function projectMemoryFinalEvidence(value) {
  const source = asRecord(value);
  if (!source) return null;
  const output = projectCounts(source, [
    'itemCount',
    'currentItemCount',
    'supersededItemCount',
    'pinnedItemCount',
    'sensitiveItemCount',
    'conversationScopedItemCount',
    'indexedTurnCount',
  ]);
  if (
    !output ||
    output.currentItemCount + output.supersededItemCount !== output.itemCount ||
    output.pinnedItemCount > output.currentItemCount ||
    output.sensitiveItemCount > output.currentItemCount ||
    output.conversationScopedItemCount > output.currentItemCount
  ) {
    return null;
  }
  return output;
}

module.exports = { projectMemoryFinalEvidence, projectMemoryTurnEvidence };
