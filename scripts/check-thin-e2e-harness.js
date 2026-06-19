#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fail, finishCheck } = require('./lib/ripgrepCheck');

const label = 'check-thin-e2e-harness';
const projectRoot = path.resolve(__dirname, '..');
const liveE2eEntrypoints = [
  '__tests__/acceptance/e2eAgentMetrics.test.ts',
  '__tests__/acceptance/e2eDelegationMetrics.test.ts',
  '__tests__/acceptance/e2eAgentAssessmentCollect.test.ts',
];
const scenarioSourceFiles = [
  'src/acceptance/e2eAgent/scenarios.ts',
  'src/acceptance/e2eAgent/scenariosCoreMemory.ts',
  'src/acceptance/e2eAgent/scenariosCoreMultiTurn.ts',
  'src/acceptance/e2eAgent/scenariosCoreWorkspace.ts',
  'src/acceptance/e2eAgent/scenariosDelegation.ts',
  'src/acceptance/e2eAgent/benchmarkScenarios.ts',
  'src/acceptance/e2eAgent/directBenchmarkScenarios.ts',
];
const allowedMocks = new Set(['expo-sqlite']);
const bannedScenarioFields = [
  'allowedTools',
  'requiredTools',
  'expectedToolCalls',
  'expectedToolNames',
  'toolSelections',
  'selectedTools',
  'toolPlan',
  'toolPolicy',
];
const bannedRubricKinds = [
  'tool_called',
  'tool_sequence',
  'tool_call_max',
  'first_turn_tool_called',
  'graph_session_tools',
  'json_field',
];

function readFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function findJestMocks(relativePath, source) {
  const matches = [];
  const pattern = /jest\.mock\(\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    matches.push({
      moduleName: match[1],
      index: match.index,
    });
  }

  return matches.map((entry) => ({
    moduleName: entry.moduleName,
    lineNumber: source.slice(0, entry.index).split(/\r?\n/).length,
  }));
}

function findBannedScenarioFields(relativePath, source) {
  const matches = [];

  for (const field of bannedScenarioFields) {
    const pattern = new RegExp(`\\b${field}\\s*:`, 'g');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      matches.push({
        message: `${relativePath}:${source.slice(0, match.index).split(/\r?\n/).length} declares "${field}"`,
      });
    }
  }

  for (const kind of bannedRubricKinds) {
    const pattern = new RegExp(`\\bkind\\s*:\\s*['"]${kind}['"]`, 'g');
    let match;
    while ((match = pattern.exec(source)) !== null) {
      matches.push({
        message: `${relativePath}:${source.slice(0, match.index).split(/\r?\n/).length} declares removed tool-trajectory rubric "${kind}"`,
      });
    }
  }

  return matches;
}

function main() {
  const failures = [];

  for (const relativePath of liveE2eEntrypoints) {
    let source;
    try {
      source = readFile(relativePath);
    } catch (error) {
      fail(label, `Unable to read ${relativePath}: ${error.message}`);
      return;
    }

    for (const mock of findJestMocks(relativePath, source)) {
      if (!allowedMocks.has(mock.moduleName)) {
        failures.push(
          `${relativePath}:${mock.lineNumber} mocks "${mock.moduleName}" in a live E2E entrypoint`,
        );
      }
    }
  }

  for (const relativePath of scenarioSourceFiles) {
    let source;
    try {
      source = readFile(relativePath);
    } catch (error) {
      fail(label, `Unable to read ${relativePath}: ${error.message}`);
      return;
    }

    for (const match of findBannedScenarioFields(relativePath, source)) {
      failures.push(match.message);
    }
  }

  finishCheck(
    label,
    failures,
    'Live E2E entrypoints only use environment shims, and scenarios stay result-driven.',
  );
}

main();
