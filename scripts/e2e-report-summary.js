#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { writeE2eReportSummaryArtifact } = require('./e2eReport/summary');

function resolveProjectRoot() {
  return path.resolve(__dirname, '..');
}

function resolveReportPath() {
  const configured = process.argv[2]?.trim() || process.env.E2E_REPORT_PATH?.trim();
  if (configured) {
    return path.resolve(configured);
  }
  return path.join(resolveProjectRoot(), '.artifacts', 'e2e-agent-report.json');
}

function main() {
  const reportPath = resolveReportPath();
  if (!fs.existsSync(reportPath)) {
    console.error(`[e2e-report-summary] Report not found: ${reportPath}`);
    process.exit(1);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const summaryPath = writeE2eReportSummaryArtifact(reportPath, report);
  console.log(`[e2e-report-summary] wrote ${summaryPath}`);
}

main();
