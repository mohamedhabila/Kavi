#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fail, findRipgrepFiles, finishCheck } = require('./lib/ripgrepCheck');

const label = 'check-dead-exports';
const projectRoot = path.resolve(__dirname, '..');

const bannedDeadExports = [
  {
    file: 'src/engine/orchestratorText.ts',
    exportName: 'textReferencesStructuredResource',
  },
  {
    file: 'src/engine/toolCategoryNormalization.ts',
    exportName: 'normalizeExecutionRequirementCategory',
  },
];

function main() {
  const failures = [];

  for (const target of bannedDeadExports) {
    const absolutePath = path.join(projectRoot, target.file);
    let source = '';
    try {
      source = fs.readFileSync(absolutePath, 'utf8');
    } catch {
      continue;
    }

    const exportPattern = new RegExp(
      String.raw`export\s+(?:async\s+)?function\s+${target.exportName}\b`,
    );
    if (!exportPattern.test(source)) {
      continue;
    }

    let usageFiles = [];
    try {
      usageFiles = findRipgrepFiles(projectRoot, String.raw`\b${target.exportName}\b`, [
        'src',
        '__tests__',
      ]).filter((entry) => entry !== target.file);
    } catch (error) {
      fail(label, error.message);
      return;
    }

    if (usageFiles.length === 0) {
      failures.push(`${target.file} still exports orphan ${target.exportName}`);
    }
  }

  finishCheck(label, failures, 'Known orphan exports are removed.');
}

main();
