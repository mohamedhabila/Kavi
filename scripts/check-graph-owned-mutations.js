#!/usr/bin/env node

const path = require('path');
const { fail, findRipgrepLines } = require('./lib/ripgrepCheck');

const label = 'check-graph-owned-mutations';
const projectRoot = path.resolve(__dirname, '..');

const allowlistedPathPrefixes = [
  'src/store/',
  'src/services/agents/agentControlGraphState.ts',
  'src/services/agents/agentRunAsyncState.ts',
  'src/services/agents/runTrace.ts',
  'src/types/',
  'src/engine/graph/',
];

function isAllowlisted(filePath) {
  const normalized = filePath.split(path.sep).join('/');
  return allowlistedPathPrefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

function main() {
  let matches = [];
  try {
    matches = findRipgrepLines(projectRoot, String.raw`controlGraph\s*[:=]`, ['src']);
  } catch (error) {
    fail(label, error.message);
    return;
  }

  if (matches.length === 0) {
    console.log(
      '[check-graph-owned-mutations] No direct controlGraph assignments found under src/.',
    );
    return;
  }

  const violations = matches.filter((line) => {
    const filePath = line.split(':')[0];
    return filePath && !isAllowlisted(filePath);
  });

  if (violations.length > 0) {
    fail(label, 'Direct controlGraph writes found outside the graph/store persistence layer:');
    for (const violation of violations) {
      console.error(`  ${violation}`);
    }
    return;
  }

  console.log(
    '[check-graph-owned-mutations] controlGraph assignments are confined to graph + store layers.',
  );
}

main();
