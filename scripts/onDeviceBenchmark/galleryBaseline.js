const fs = require('fs');
const path = require('path');

function readGalleryBaseline(projectRoot, rawPath) {
  if (!rawPath?.trim()) {
    return null;
  }

  const baselinePath = path.resolve(projectRoot, rawPath.trim());
  const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const metrics = parsed.metrics || {};
  return {
    path: baselinePath,
    device: parsed.device || null,
    model: parsed.model || null,
    metrics: {
      engineInitMs: finiteOrNull(metrics.engineInitMs),
      ttftMs: finiteOrNull(metrics.ttftMs),
      decodeTokensPerSecond: finiteOrNull(metrics.decodeTokensPerSecond),
      crashFreeRunRate: finiteOrNull(metrics.crashFreeRunRate),
      activeBackend: metrics.activeBackend || null,
      contextWindowTokens: finiteOrNull(metrics.contextWindowTokens),
    },
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

module.exports = {
  readGalleryBaseline,
};
