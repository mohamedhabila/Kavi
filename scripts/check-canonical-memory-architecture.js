#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fail, findRipgrepLines, finishCheck } = require('./lib/ripgrepCheck');

const label = 'check-canonical-memory-architecture';
const defaultProjectRoot = path.resolve(__dirname, '..');
const retiredArtifactCleanupPath = 'src/services/memory/retiredMemoryArtifacts.ts';

const bannedFiles = [
  'src/services/memory/store.ts',
  'src/services/memory/ranking/chunkIndex.ts',
];

const bannedPatterns = [
  {
    label: 'retired chunk table',
    pattern: String.raw`\bmemory_chunks\b`,
    allowedFiles: [retiredArtifactCleanupPath],
  },
  {
    label: 'retired Markdown memory directories',
    pattern: String.raw`['"](?:global-memory|conversation-memory)['"]`,
    allowedFiles: [retiredArtifactCleanupPath],
  },
  {
    label: 'retired Markdown memory file',
    pattern: String.raw`MEMORY\.md`,
  },
  {
    label: 'retired file-store API',
    pattern: String.raw`\b(?:readGlobalMemory|writeGlobalMemory|appendGlobalMemory|readConversationMemory|writeConversationMemory|appendConversationMemory|clearConversationMemory|readDailyMemory|appendDailyMemory|listDailyMemoryFiles|searchMemory|flushToMemory|getMemoryForSystemPrompt|getConversationMemoryForSystemPrompt)\b`,
  },
  {
    label: 'retired file-store type',
    pattern: String.raw`\b(?:MemorySearchEntry|MemorySearchResult)\b`,
  },
  {
    label: 'retired embedding-index API',
    pattern: String.raw`\b(?:hybridSearch|indexMemory|getIndexSize|chunkIndex)\b`,
  },
  {
    label: 'retired memory-store import',
    pattern: String.raw`(?:services/)?memory/(?:store|ranking/chunkIndex)`,
  },
];

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sourcePathFromMatch(match) {
  const separatorIndex = match.indexOf(':');
  return normalizePath(separatorIndex === -1 ? match : match.slice(0, separatorIndex));
}

function collectCanonicalMemoryArchitectureViolations(projectRoot = defaultProjectRoot) {
  const failures = [];

  for (const filePath of bannedFiles) {
    if (fs.existsSync(path.join(projectRoot, filePath))) {
      failures.push(`${filePath} restores a retired memory implementation`);
    }
  }

  for (const target of bannedPatterns) {
    const matches = findRipgrepLines(projectRoot, target.pattern, ['src'], {
      errorMessage: `Unable to scan for ${target.label}. Install ripgrep (rg) and retry.`,
    });
    const allowedFiles = new Set(target.allowedFiles ?? []);
    for (const match of matches) {
      const filePath = sourcePathFromMatch(match);
      if (!allowedFiles.has(filePath)) {
        failures.push(`${match} uses ${target.label}`);
      }
    }
  }

  return failures;
}

function main() {
  let failures;
  try {
    failures = collectCanonicalMemoryArchitectureViolations();
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
    return;
  }

  finishCheck(
    label,
    failures,
    'Production source uses only the canonical structured memory architecture.',
  );
}

if (require.main === module) {
  main();
}

module.exports = { collectCanonicalMemoryArchitectureViolations };
