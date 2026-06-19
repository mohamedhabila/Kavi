#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Flush partial E2E report entries to final JSON (Node-only; no RN imports)
// ---------------------------------------------------------------------------

const {
  buildRunMetadata,
  normalizeEntry,
  readEntries,
  resolveMaxRetries,
  resolvePartialPath,
} = require('./e2eReport/parser');
const { buildCache } = require('./e2eReport/cache');
const {
  buildAssessment,
  buildGraderAudit,
  buildReliability,
  buildReadiness,
  buildTotals,
} = require('./e2eReport/metrics');
const { buildReadinessDashboard } = require('./e2eReport/dashboard');
const { writeReportArtifacts } = require('./e2eReport/writer');

function buildE2eRunReport(entries, options = {}) {
  const totals = buildTotals(entries);
  const assessment = buildAssessment(entries);
  const cache = buildCache(entries);
  const graderAudit = buildGraderAudit(entries);
  const maxScenarioRetries = options.maxScenarioRetries ?? resolveMaxRetries();
  const reliability = buildReliability(entries, maxScenarioRetries);
  const readiness = buildReadiness(entries, assessment, cache, graderAudit, reliability);
  const generatedAt = options.generatedAt || new Date().toISOString();
  const runMetadata = options.runMetadata || buildRunMetadata();
  const readinessDashboard = buildReadinessDashboard({
    generatedAt,
    runMetadata,
    entries,
    totals,
    cache,
    graderAudit,
    assessment,
    reliability,
    readiness,
  });

  return {
    generatedAt,
    maxScenarioRetries,
    runMetadata,
    scenarios: entries,
    totals,
    cache,
    graderAudit,
    assessment,
    reliability,
    readiness,
    readinessDashboard,
    metricsPassing: totals.failedCount === 0 && totals.scenarioCount > 0 && cache.passing,
  };
}

function flushE2eRunReport() {
  const reportPath = process.env.E2E_REPORT_PATH?.trim();
  if (!reportPath) {
    return undefined;
  }

  const partialPath = resolvePartialPath(reportPath);
  const entries = readEntries(partialPath).map(normalizeEntry);
  if (entries.length === 0) {
    return undefined;
  }

  const report = buildE2eRunReport(entries);
  const { resolvedReportPath, readinessArtifacts } = writeReportArtifacts(
    reportPath,
    partialPath,
    report,
  );
  const { totals, cache, reliability, assessment, readiness, readinessDashboard } = report;

  console.log(
    `[e2e-run-report] scenarios=${totals.passedCount}/${totals.scenarioCount} passed tokens=${totals.totalTokens} cacheR=${totals.cacheReadTokens} eligibleCacheRate=${cache.eligibleCacheReadRate.toFixed(3)}`,
  );
  console.log(
    `[e2e-run-report] reliability pass1=${reliability.pass1PassedCount}/${reliability.scenarioCount} pass^${reliability.k}=${reliability.passKPassedCount}/${reliability.scenarioCount} retried=${reliability.retriedScenarioCount}`,
  );
  console.log(
    `[e2e-run-report] assessment evidenceScore=${assessment.evidenceScore.toFixed(3)} dimensionsPassing=${assessment.dimensionsPassing}`,
  );
  console.log(
    `[e2e-run-report] readiness=${readiness.passing} failedCriteria=${readiness.failedCriteria.join(',') || 'none'}`,
  );
  console.log(
    `[e2e-readiness-dashboard] passing=${readinessDashboard.overall.passing} minedEvalCandidates=${readinessDashboard.minedEvalCandidates.length} externalRequirements=${readinessDashboard.benchmarkRequirements.externalRequired}`,
  );
  console.log(`[e2e-run-report] wrote ${resolvedReportPath}`);
  console.log(`[e2e-readiness-dashboard] wrote ${readinessArtifacts.dashboardPath}`);

  return { report, resolvedReportPath, readinessArtifacts };
}

if (require.main === module) {
  flushE2eRunReport();
}

module.exports = {
  buildE2eRunReport,
  flushE2eRunReport,
};
