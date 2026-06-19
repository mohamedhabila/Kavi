#!/usr/bin/env node

const path = require('path');
const { fail, findRipgrepFiles, finishCheck } = require('./lib/ripgrepCheck');

const label = 'check-no-legacy-planning-imports';
const projectRoot = path.resolve(__dirname, '..');
const bannedPatterns = [
  'workflowRouting',
  'executionUnit',
  'agentWorkflowPilot',
  'semanticTaskPlan',
  'structuredPlanReview',
  'requestEntryAssessment',
  'delegatedWorkerLaunchPlanning',
  'verifiedWorkflowFinalOutput',
  'pilotEvaluationContext',
  'pilotReviewDecision',
];

function main() {
  const failures = [];

  for (const pattern of bannedPatterns) {
    let matches = [];
    try {
      matches = findRipgrepFiles(projectRoot, pattern, ['src'], {
        extraArgs: ['--glob', '!**/*.test.ts', '--glob', '!**/*.test.tsx'],
        errorMessage: `Unable to run ripgrep for "${pattern}". Install ripgrep (rg) and retry.`,
      });
    } catch (error) {
      fail(label, error.message);
      return;
    }

    for (const match of matches) {
      failures.push(`${match} imports banned legacy planning symbol "${pattern}"`);
    }
  }

  finishCheck(label, failures, 'No banned legacy planning imports under src/.');
}

main();
