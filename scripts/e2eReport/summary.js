const fs = require('fs');
const path = require('path');

function asNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function asBooleanLabel(value) {
  return value ? 'pass' : 'fail';
}

function formatPercent(value) {
  return `${(asNumber(value) * 100).toFixed(1)}%`;
}

function formatDuration(durationMs) {
  const value = asNumber(durationMs);
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function formatInteger(value) {
  return String(Math.round(asNumber(value)));
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function formatGitSha(gitSha) {
  const normalized = String(gitSha || '').trim();
  if (!normalized || normalized === 'unknown') {
    return 'unknown';
  }
  return normalized.slice(0, 12);
}

function formatList(values, fallback = 'none') {
  const list = Array.isArray(values)
    ? values.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  return list.length > 0 ? list.join(', ') : fallback;
}

function buildScenarioRows(report) {
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  if (scenarios.length === 0) {
    return ['No scenarios were recorded.'];
  }

  const lines = [
    '| Scenario | Result | Attempts | Tools | Graph | Tokens | Cache Read | Duration | Issues |',
    '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |',
  ];

  for (const scenario of scenarios) {
    const usage = scenario.usage || {};
    const failedRubricCount = Array.isArray(scenario.failedRubrics)
      ? scenario.failedRubrics.length
      : 0;
    const errorCount = Array.isArray(scenario.errors) ? scenario.errors.length : 0;
    const issueCount = failedRubricCount + errorCount;
    lines.push(
      [
        markdownCell(scenario.fixtureId || 'unknown'),
        markdownCell(scenario.passed ? 'pass' : 'fail'),
        formatInteger(scenario.attemptCount),
        formatInteger(scenario.toolCallCount),
        markdownCell(scenario.graphStatus || 'unknown'),
        formatInteger(usage.totalTokens),
        formatInteger(usage.cacheReadTokens),
        formatDuration(scenario.durationMs),
        formatInteger(issueCount),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    );
  }

  return lines;
}

function buildFailedScenarioRows(report) {
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const failedScenarios = scenarios.filter((scenario) => !scenario.passed);
  if (failedScenarios.length === 0) {
    return ['No failed scenarios.'];
  }

  const lines = [
    '| Scenario | Attempts | Graph | Error Count | Failed Rubrics | Loop Diagnostics |',
    '| --- | ---: | --- | ---: | ---: | --- |',
  ];

  for (const scenario of failedScenarios) {
    const failedRubricCount = Array.isArray(scenario.failedRubrics)
      ? scenario.failedRubrics.length
      : 0;
    const errorCount = Array.isArray(scenario.errors) ? scenario.errors.length : 0;
    const repeatedToolCalls = scenario.loopDiagnostics?.repeatedToolCalls;
    const repeatedToolCallCount = Array.isArray(repeatedToolCalls) ? repeatedToolCalls.length : 0;
    const loopStatus = scenario.loopDiagnostics?.passing === false
      ? `${repeatedToolCallCount} repeated-tool-call groups`
      : 'pass';
    lines.push(
      [
        markdownCell(scenario.fixtureId || 'unknown'),
        formatInteger(scenario.attemptCount),
        markdownCell(scenario.graphStatus || 'unknown'),
        formatInteger(errorCount),
        formatInteger(failedRubricCount),
        markdownCell(loopStatus),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'),
    );
  }

  return lines;
}

function buildE2eReportSummaryMarkdown(report, options = {}) {
  const totals = report.totals || {};
  const cache = report.cache || {};
  const reliability = report.reliability || {};
  const readiness = report.readiness || {};
  const graderAudit = report.graderAudit || {};
  const assessment = report.assessment || {};
  const metadata = report.runMetadata || {};
  const generatedAt = report.generatedAt || options.generatedAt || new Date().toISOString();
  const scenarioCount = asNumber(totals.scenarioCount);
  const passedCount = asNumber(totals.passedCount);
  const scenarioPassRate = scenarioCount > 0 ? passedCount / scenarioCount : 0;

  const lines = [
    '# E2E Agent Report Summary',
    '',
    `Generated: ${generatedAt}`,
    `Git SHA: ${formatGitSha(metadata.gitSha)}`,
    `Provider: ${metadata.provider || 'unknown'}`,
    `Model: ${metadata.model || 'unknown'}`,
    `Scenario Manifest: ${metadata.scenarioManifestVersion || 'unknown'}`,
    '',
    '> Sanitized artifact: prompts, transcripts, tool outputs, provider error text, raw traces, and credentials are intentionally excluded.',
    '',
    '## Result',
    '',
    `- Metrics: ${asBooleanLabel(report.metricsPassing)}`,
    `- Readiness: ${asBooleanLabel(readiness.passing)}`,
    `- Scenarios: ${passedCount}/${scenarioCount} passed (${formatPercent(scenarioPassRate)})`,
    `- Reliability: pass@1 ${formatInteger(reliability.pass1PassedCount)}/${formatInteger(
      reliability.scenarioCount,
    )}, pass@${formatInteger(reliability.k)} ${formatInteger(
      reliability.passKPassedCount,
    )}/${formatInteger(reliability.scenarioCount)}, retried ${formatInteger(
      reliability.retriedScenarioCount,
    )}`,
    `- Failed criteria: ${formatList(readiness.failedCriteria)}`,
    '',
    '## Aggregate Metrics',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Input tokens | ${formatInteger(totals.inputTokens)} |`,
    `| Output tokens | ${formatInteger(totals.outputTokens)} |`,
    `| Cache read tokens | ${formatInteger(totals.cacheReadTokens)} |`,
    `| Cache write tokens | ${formatInteger(totals.cacheWriteTokens)} |`,
    `| Total tokens | ${formatInteger(totals.totalTokens)} |`,
    `| Duration | ${formatDuration(totals.durationMs)} |`,
    `| Eligible cache read rate | ${formatPercent(cache.eligibleCacheReadRate)} |`,
    `| Target cache read rate | ${formatPercent(cache.targetEligibleCacheReadRate)} |`,
    `| Cache passing | ${asBooleanLabel(cache.passing)} |`,
    `| Evidence score | ${asNumber(assessment.evidenceScore).toFixed(3)} |`,
    `| Dimensions passing | ${formatInteger(assessment.dimensionsPassing)} |`,
    `| Grader audit | ${asBooleanLabel(graderAudit.passing)} |`,
    '',
    '## Failed Scenarios',
    '',
    ...buildFailedScenarioRows(report),
    '',
    '## Scenario Outcomes',
    '',
    ...buildScenarioRows(report),
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function resolveSummaryPath(reportPath, env = process.env) {
  const configured = env.E2E_REPORT_SUMMARY_PATH?.trim() || env.E2E_SUMMARY_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  const resolvedReportPath = path.resolve(reportPath);
  if (resolvedReportPath.endsWith('.json')) {
    return `${resolvedReportPath.slice(0, -'.json'.length)}.md`;
  }
  return `${resolvedReportPath}.summary.md`;
}

function writeE2eReportSummaryArtifact(reportPath, report, env = process.env) {
  const summaryPath = resolveSummaryPath(reportPath, env);
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, buildE2eReportSummaryMarkdown(report), 'utf8');
  return summaryPath;
}

module.exports = {
  buildE2eReportSummaryMarkdown,
  resolveSummaryPath,
  writeE2eReportSummaryArtifact,
};
