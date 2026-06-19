const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const DEFAULT_MAX_LINES = 700;
const CODE_OR_DOC_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|md)$/;
const CODE_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

const DEFAULT_EXCEPTIONS = [
  /^package-lock\.json$/,
  /^ios\/Podfile\.lock$/,
  /^THIRD_PARTY_NOTICES\.md$/,
  /^src\/i18n\/locales\//,
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isException(filePath, exceptions = DEFAULT_EXCEPTIONS) {
  const normalized = normalizePath(filePath);
  return exceptions.some((rule) => rule.test(normalized));
}

function isApplicableFile(filePath) {
  return CODE_OR_DOC_EXTENSIONS.test(filePath);
}

function countPhysicalLines(content) {
  if (!content) {
    return 0;
  }
  return content.split('\n').length - (content.endsWith('\n') ? 1 : 0);
}

function isPassThroughBarrel(filePath, content) {
  if (!CODE_EXTENSIONS.test(filePath)) {
    return false;
  }

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const statements = sourceFile.statements.filter((statement) => !ts.isImportDeclaration(statement));

  if (statements.length === 0) {
    return false;
  }

  return statements.every((statement) => ts.isExportDeclaration(statement));
}

function findMaintainabilityFailures(entries, options = {}) {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const exceptions = options.exceptions ?? DEFAULT_EXCEPTIONS;
  const failures = [];

  for (const entry of entries) {
    const filePath = normalizePath(entry.filePath);
    if (!isApplicableFile(filePath) || isException(filePath, exceptions)) {
      continue;
    }

    const lines = countPhysicalLines(entry.content);
    if (lines > maxLines) {
      failures.push({
        type: 'line-count',
        filePath,
        lines,
        maxLines,
        message: `${filePath} has ${lines} physical lines, above the ${maxLines}-line limit`,
      });
    }

    if (isPassThroughBarrel(filePath, entry.content)) {
      failures.push({
        type: 'barrel-file',
        filePath,
        message: `${filePath} is a pass-through barrel file; import the owning module directly`,
      });
    }
  }

  return failures;
}

function listGitVisibleFiles(projectRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  return output
    .split('\n')
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

function collectProjectEntries(projectRoot) {
  return listGitVisibleFiles(projectRoot)
    .map((filePath) => normalizePath(filePath))
    .filter((filePath) => isApplicableFile(filePath))
    .filter((filePath) => fs.existsSync(path.join(projectRoot, filePath)))
    .map((filePath) => ({
      filePath,
      content: fs.readFileSync(path.join(projectRoot, filePath), 'utf8'),
    }));
}

function runMaintainabilityCli(projectRoot = path.resolve(__dirname, '../..')) {
  const failures = findMaintainabilityFailures(collectProjectEntries(projectRoot));

  if (failures.length > 0) {
    console.error('[check-maintainability] Maintainability guardrails failed:');
    for (const failure of failures) {
      console.error(`- ${failure.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[check-maintainability] Contribution-scale file limits and no-barrel guardrails passed.');
}

module.exports = {
  DEFAULT_EXCEPTIONS,
  DEFAULT_MAX_LINES,
  collectProjectEntries,
  countPhysicalLines,
  findMaintainabilityFailures,
  isPassThroughBarrel,
  runMaintainabilityCli,
};
