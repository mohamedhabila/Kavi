#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { fail, findRipgrepLines, finishCheck } = require('./lib/ripgrepCheck');

const label = 'check-canonical-memory-architecture';
const defaultProjectRoot = path.resolve(__dirname, '..');
const retiredArtifactCleanupPath = 'src/services/memory/retiredMemoryArtifacts.ts';
const memoryServiceRoot = 'src/services/memory/';

// These modules own the low-level fact primitives themselves. Every product and
// acceptance writer must use a contribution-backed mutation boundary.
const bareFactMutationAllowedFiles = new Set([
  'src/services/memory/facts/mutations.ts',
  'src/services/memory/facts/exactReplacement.ts',
]);

const productionSourceRoots = [
  'src',
  'android/app/src/main/java',
  'ios/Kavi',
  'ios/LocalPackages/KaviDurableExecutionCore',
];

const bannedFiles = [
  'src/services/memory/store.ts',
  'src/services/memory/blocks.ts',
  'src/services/memory/ranking/chunkIndex.ts',
  'src/services/memory/productExperienceObservationSchema.ts',
  'src/services/memory/productExperienceObservationStore.ts',
  'src/services/memory/verifiedToolEffectExperience.ts',
  'src/services/memory/verifiedToolEffectExperienceLearning.ts',
];

const bannedPatterns = [
  {
    label: 'retired provider-editable raw memory table',
    pattern: String.raw`\bmemory_blocks\b`,
    allowedMatch: ({ filePath, content }) =>
      filePath === 'src/services/memory/schema.ts' &&
      content === 'DROP TABLE IF EXISTS memory_blocks;',
  },
  {
    label: 'retired provider-editable raw memory API',
    pattern: String.raw`\b(?:memory_block|memory_block_read|memory_block_edit|ensureDefaultBlocks|DEFAULT_MEMORY_BLOCKS|executeMemoryBlockRead|executeMemoryBlockEdit)\b`,
  },
  {
    label: 'retired product-experience table',
    pattern: String.raw`\bmemory_product_experience_observations\b`,
    allowedMatch: ({ filePath, content }) =>
      filePath === retiredArtifactCleanupPath &&
      content ===
        "database.execSync('DROP TABLE IF EXISTS memory_product_experience_observations;');",
  },
  {
    label: 'retired single-effect experience API',
    pattern: String.raw`\b(?:recordVerifiedToolEffectExperience|readVerifiedToolEffectExperienceLearnings|recordProductExperienceObservation)\b`,
  },
  {
    label: 'retired chunk table',
    pattern: String.raw`\bmemory_chunks\b`,
    allowedMatch: ({ filePath, content }) =>
      filePath === retiredArtifactCleanupPath &&
      content === "database.execSync('DROP TABLE IF EXISTS memory_chunks');",
  },
  {
    label: 'retired Markdown memory directories',
    pattern: String.raw`['"](?:global-memory|conversation-memory)['"]`,
    allowedMatch: ({ filePath, content }) =>
      filePath === retiredArtifactCleanupPath &&
      content ===
        "const RETIRED_MEMORY_DIRECTORY_NAMES = ['global-memory', 'conversation-memory'] as const;",
  },
  {
    label: 'retired Markdown memory file',
    pattern: String.raw`(?i:memory\.md)`,
  },
  {
    label: 'file-backed memory persistence dependency',
    pattern: String.raw`['"](?:expo-file-system(?:/legacy)?|@react-native-async-storage/async-storage|react-native-fs|node:fs|fs)['"]`,
    includeMatch: ({ filePath }) => filePath.startsWith(memoryServiceRoot),
    allowedMatch: ({ filePath, content }) =>
      filePath === retiredArtifactCleanupPath &&
      content === "import { Directory, Paths } from 'expo-file-system';",
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
    label: 'bare fact mutation outside approved low-level modules',
    pattern: String.raw`\b(?:recordFact|recordFactWithApplicability|replaceCurrentFact|replaceCurrentFactWithApplicability)\s*(?:\(|,|\})`,
    allowedMatch: ({ filePath }) => bareFactMutationAllowedFiles.has(filePath),
  },
  {
    label: 'retired projection-only fact mutation API',
    pattern: String.raw`\b(?:invalidateFact|setFactPinned|setMemoryFactReviewState|setMemoryFactSensitivity|updateFactApplicabilityColumn)\b`,
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

function parseSourceMatch(match) {
  const filePath = sourcePathFromMatch(match);
  const lineSeparatorIndex = match.indexOf(':', filePath.length + 1);
  return {
    filePath,
    content: lineSeparatorIndex === -1 ? '' : match.slice(lineSeparatorIndex + 1).trim(),
  };
}

function collectCanonicalMemoryArchitectureViolations(projectRoot = defaultProjectRoot) {
  const failures = [];
  const scanRoots = productionSourceRoots.filter((sourceRoot) =>
    fs.existsSync(path.join(projectRoot, sourceRoot)),
  );

  for (const filePath of bannedFiles) {
    if (fs.existsSync(path.join(projectRoot, filePath))) {
      failures.push(`${filePath} restores a retired memory implementation`);
    }
  }

  for (const target of bannedPatterns) {
    const matches = findRipgrepLines(projectRoot, target.pattern, scanRoots, {
      errorMessage: `Unable to scan for ${target.label}. Install ripgrep (rg) and retry.`,
    });
    for (const match of matches) {
      const parsedMatch = parseSourceMatch(match);
      if (target.includeMatch && !target.includeMatch(parsedMatch)) {
        continue;
      }
      if (!target.allowedMatch?.(parsedMatch)) {
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
