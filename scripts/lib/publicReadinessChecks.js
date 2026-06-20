const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '../..');

const SECRET_PATTERNS = [
  { id: 'openai-project-key', regex: /sk-proj-[A-Za-z0-9_-]{20,}/g },
  { id: 'openai-secret-key', regex: /sk-[A-Za-z0-9]{20,}/g },
  { id: 'github-classic-token', regex: /ghp_[A-Za-z0-9]{20,}/g },
  { id: 'github-fine-grained-token', regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  {
    id: 'authorization-bearer-token',
    regex: /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  },
  {
    id: 'private-key-block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]{32,}-----END [A-Z ]*PRIVATE KEY-----/g,
    multiline: true,
  },
];

const LEGACY_BENCHMARK_CLAIM_TOKEN = ['so', 'ta'].join('');
const LEGACY_BENCHMARK_CLAIM_REGEX = new RegExp(
  `\\b(?:${LEGACY_BENCHMARK_CLAIM_TOKEN}|state[- ]?of[- ]?the[- ]?art)\\b`,
  'gi',
);
const LEGACY_PROJECT_BRAND_TOKEN = ['Open', 'Claw'].join('');
const LEGACY_PROJECT_BRAND_REGEX = new RegExp(`\\b${LEGACY_PROJECT_BRAND_TOKEN}\\b`, 'gi');
const PRIVATE_SOURCE_REFERENCE_REGEX = new RegExp(
  `\\b(?:${['open', 'claw-source'].join('')}|${['open', 'code'].join('')})\\b`,
  'gi',
);
const phrase = (parts) => parts.join(' ');
const INTERNAL_BENCHMARK_FAMILY_TOKEN = ['internal', 'pa'].join('-');
const INTERNAL_BENCHMARK_FAMILY_REGEX = new RegExp(
  `\\b${INTERNAL_BENCHMARK_FAMILY_TOKEN}\\b`,
  'gi',
);
const INTERNAL_FAST_SUITE_REGEX = new RegExp(
  `\\b${phrase(['internal', 'fast'])}\\b`,
  'gi',
);
const INTERNAL_PROGRESS_DIARY_TERMS = [
  phrase(['investigation', 'update']),
  phrase(['implementation', 'handoff']),
  phrase(['experiment', 'log']),
  phrase(['roadmap', 'phase']),
  phrase(['research', 'spike']),
  `${phrase(['progress', 'update'])}\\s+-\\s+\\d{4}`,
];
const INTERNAL_PROGRESS_DIARY_REGEX = new RegExp(
  `\\b(?:${INTERNAL_PROGRESS_DIARY_TERMS.join('|')})\\b`,
  'gi',
);

const PUBLIC_LANGUAGE_PATTERNS = [
  { id: 'legacy-benchmark-claim', regex: LEGACY_BENCHMARK_CLAIM_REGEX },
  { id: 'legacy-project-brand', regex: LEGACY_PROJECT_BRAND_REGEX },
  { id: 'internal-benchmark-family', regex: INTERNAL_BENCHMARK_FAMILY_REGEX },
  { id: 'internal-fast-suite', regex: INTERNAL_FAST_SUITE_REGEX },
  { id: 'internal-progress-diary', regex: INTERNAL_PROGRESS_DIARY_REGEX },
  { id: 'private-absolute-path', regex: /\/Users\/mohamedhabila/gi },
  { id: 'private-source-reference', regex: PRIVATE_SOURCE_REFERENCE_REGEX },
  { id: 'private-convex-deployment', regex: /\bwry-manatee-359\b/gi },
  { id: 'private-gateway-host', regex: /\bgateway\.kavi\.dev\b/gi },
  { id: 'private-kavi-hub-host', regex: /\bhub\.kavi\.dev\b/gi },
];

const DEFAULT_CONFIG = {
  privatePaths: ['.private'],
  absentLocalPaths: [
    '.env.local',
    'ios/.xcode.env.local',
    'android/keystore.properties',
    'android/app/kavi-upload-key.jks',
    'release-artifacts',
    '.artifacts',
    '.tmp',
    'coverage',
    'dist',
  ],
  ignoredPaths: [
    '.private/',
    '.artifacts/',
    '.tmp/',
    'coverage/',
    'dist/',
    'release-artifacts/',
    '.env',
    '.env.local',
    '.env.production.local',
    'ios/.xcode.env.local',
    'android/keystore.properties',
    'android/app/kavi-upload-key.jks',
  ],
  exportIgnorePaths: [
    '.private',
    '.artifacts',
    '.tmp',
    'coverage',
    'dist',
    'release-artifacts',
    '.expo',
    '.env.local',
    '.env.production.local',
    'ios/.xcode.env.local',
    'android/keystore.properties',
    'android/app/kavi-upload-key.jks',
  ],
  blockedTrackedPathRules: [
    {
      id: 'private-working-material',
      regex: /^\.private(?:\/|$)/,
      message: 'private working material must not be tracked',
    },
    {
      id: 'generated-doc-baseline',
      regex: /^docs\/baselines(?:\/|$)/,
      message: 'generated docs/baselines artifacts must not be tracked',
    },
    {
      id: 'generated-output',
      regex: /^(?:release-artifacts|\.artifacts|\.tmp|coverage|dist)(?:\/|$)/,
      message: 'generated output must not be tracked',
    },
    {
      id: 'signing-or-release-artifact',
      regex: /(^|\/)[^/]+\.(?:jks|p8|p12|key|mobileprovision|apk|aab|ipa|app)$/i,
      message: 'signing or native release artifacts must not be tracked',
    },
  ],
  publicDocAllowlist: new Set([
    'docs/dynamic-code-execution.md',
    'docs/feature-matrix.md',
    'docs/privacy-and-permissions.md',
    'docs/privacy-policy.md',
    'docs/release.md',
    'docs/setup/development.md',
    'docs/testing.md',
  ]),
  plannedDocCleanupPaths: new Set(),
  excludedContentPaths: new Set(['package-lock.json']),
  publicLanguageAllowlist: [
    {
      id: 'public-readiness-checker-fixtures',
      pathRegex: /^(?:scripts\/lib\/publicReadinessChecks\.js|__tests__\/scripts\/publicReadinessChecks\.test\.ts)$/,
      status: 'permanent',
      reason: 'the public readiness checker and its tests intentionally contain blocked terms as patterns and fixtures',
    },
  ],
};

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}

function git(projectRoot, args, options = {}) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function hasGitCheckout(projectRoot = DEFAULT_PROJECT_ROOT) {
  return fs.existsSync(path.join(projectRoot, '.git'));
}

function listTrackedEntries(projectRoot, targetPath) {
  const output = git(projectRoot, ['ls-files', '--', targetPath]);
  return output
    .split(/\r?\n/)
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function listTrackedFiles(projectRoot) {
  const output = git(projectRoot, ['ls-files', '-z']);
  return output
    .split('\0')
    .map((entry) => normalizePath(entry.trim()))
    .filter(Boolean);
}

function isIgnored(projectRoot, targetPath) {
  try {
    git(projectRoot, ['check-ignore', '-q', targetPath], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function hasExportIgnore(projectRoot, targetPath) {
  const output = git(projectRoot, ['check-attr', 'export-ignore', '--', targetPath]);
  return output.trim().endsWith(': export-ignore: set');
}

function isTextBuffer(buffer) {
  return !buffer.includes(0);
}

function readTrackedTextFiles(projectRoot, trackedFiles, excludedContentPaths) {
  const textFiles = [];

  for (const filePath of trackedFiles) {
    if (excludedContentPaths.has(filePath)) {
      continue;
    }

    const absolutePath = path.join(projectRoot, filePath);
    let buffer;
    try {
      buffer = fs.readFileSync(absolutePath);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    if (!isTextBuffer(buffer)) {
      continue;
    }

    textFiles.push({
      filePath,
      content: buffer.toString('utf8'),
    });
  }

  return textFiles;
}

function cloneRegex(regex, forceGlobal) {
  const flags = new Set(regex.flags.split(''));
  if (forceGlobal) {
    flags.add('g');
  } else {
    flags.delete('g');
  }
  return new RegExp(regex.source, [...flags].join(''));
}

function lineNumberForIndex(content, index) {
  if (index <= 0) {
    return 1;
  }
  return content.slice(0, index).split('\n').length;
}

function collectContentFindings(textFiles, patterns) {
  const findings = [];

  for (const textFile of textFiles) {
    for (const pattern of patterns) {
      if (pattern.multiline) {
        const regex = cloneRegex(pattern.regex, true);
        let match;
        while ((match = regex.exec(textFile.content)) !== null) {
          findings.push({
            filePath: textFile.filePath,
            lineNumber: lineNumberForIndex(textFile.content, match.index),
            patternId: pattern.id,
          });
          if (match.index === regex.lastIndex) {
            regex.lastIndex += 1;
          }
        }
        continue;
      }

      const regex = cloneRegex(pattern.regex, false);
      const lines = textFile.content.split(/\r?\n/);
      lines.forEach((line, lineIndex) => {
        regex.lastIndex = 0;
        if (regex.test(line)) {
          findings.push({
            filePath: textFile.filePath,
            lineNumber: lineIndex + 1,
            patternId: pattern.id,
          });
        }
      });
    }
  }

  return findings;
}

function isAllowedFinding(finding, allowlist) {
  return allowlist.some((entry) => {
    if (!entry.pathRegex.test(finding.filePath)) {
      return false;
    }
    if (entry.patternIds && !entry.patternIds.includes(finding.patternId)) {
      return false;
    }
    return true;
  });
}

function splitAllowedFindings(findings, allowlist) {
  const allowedFindings = [];
  const unexpectedFindings = [];

  findings.forEach((finding) => {
    if (isAllowedFinding(finding, allowlist)) {
      allowedFindings.push(finding);
    } else {
      unexpectedFindings.push(finding);
    }
  });

  return { allowedFindings, unexpectedFindings };
}

function findBlockedTrackedPathFailures(trackedFiles, config = DEFAULT_CONFIG) {
  const failures = [];

  for (const filePath of trackedFiles) {
    for (const rule of config.blockedTrackedPathRules) {
      if (rule.regex.test(filePath)) {
        failures.push({
          id: rule.id,
          message: `${filePath}: ${rule.message}.`,
        });
      }
    }
  }

  return failures;
}

function evaluateTrackedDocs(trackedFiles, config = DEFAULT_CONFIG) {
  const failures = [];
  const plannedCleanupDocs = [];

  trackedFiles
    .filter((filePath) => filePath.startsWith('docs/'))
    .forEach((filePath) => {
      if (config.publicDocAllowlist.has(filePath)) {
        return;
      }
      if (config.plannedDocCleanupPaths.has(filePath)) {
        plannedCleanupDocs.push(filePath);
        return;
      }
      failures.push({
        id: 'unexpected-doc',
        message: `${filePath}: docs must be public allowlist entries or explicit cleanup targets.`,
      });
    });

  return { failures, plannedCleanupDocs };
}

function evaluatePublicHygiene(options = {}) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const config = options.config || DEFAULT_CONFIG;

  if (!hasGitCheckout(projectRoot)) {
    return { skipped: true, failures: [], plannedCleanupDocs: [], secretFindings: [] };
  }

  const failures = [];

  for (const privatePath of config.privatePaths) {
    const trackedEntries = listTrackedEntries(projectRoot, privatePath);
    if (trackedEntries.length > 0) {
      failures.push({
        id: 'tracked-private-path',
        message: `${privatePath} is tracked by git and must stay out of the public repository history.`,
      });
    }
    if (!isIgnored(projectRoot, privatePath)) {
      failures.push({
        id: 'unignored-private-path',
        message: `${privatePath} is not ignored by git. Add it to .gitignore before publishing.`,
      });
    }
  }

  for (const targetPath of config.absentLocalPaths) {
    if (fs.existsSync(path.join(projectRoot, targetPath))) {
      failures.push({
        id: 'local-artifact-present',
        message: `${targetPath} is present locally and must be removed before public release.`,
      });
    }
  }

  for (const targetPath of config.ignoredPaths) {
    if (!isIgnored(projectRoot, targetPath)) {
      failures.push({
        id: 'missing-ignore-rule',
        message: `${targetPath} is not ignored by git.`,
      });
    }
  }

  for (const targetPath of config.exportIgnorePaths) {
    if (!hasExportIgnore(projectRoot, targetPath)) {
      failures.push({
        id: 'missing-export-ignore-rule',
        message: `${targetPath} is not marked export-ignore in .gitattributes.`,
      });
    }
  }

  const trackedFiles = listTrackedFiles(projectRoot);
  failures.push(...findBlockedTrackedPathFailures(trackedFiles, config));

  const docResult = evaluateTrackedDocs(trackedFiles, config);
  failures.push(...docResult.failures);

  const textFiles = readTrackedTextFiles(projectRoot, trackedFiles, config.excludedContentPaths);
  const secretFindings = collectContentFindings(textFiles, SECRET_PATTERNS);
  secretFindings.forEach((finding) => {
    failures.push({
      id: 'tracked-secret-pattern',
      message: `${finding.filePath}:${finding.lineNumber}: high-confidence secret pattern ${finding.patternId} is tracked.`,
    });
  });

  return {
    skipped: false,
    failures,
    plannedCleanupDocs: docResult.plannedCleanupDocs,
    secretFindings,
  };
}

function evaluatePublicLanguage(options = {}) {
  const projectRoot = options.projectRoot || DEFAULT_PROJECT_ROOT;
  const config = options.config || DEFAULT_CONFIG;

  if (!hasGitCheckout(projectRoot)) {
    return { skipped: true, failures: [], allowedFindings: [], unexpectedFindings: [] };
  }

  const trackedFiles = listTrackedFiles(projectRoot);
  const textFiles = readTrackedTextFiles(projectRoot, trackedFiles, config.excludedContentPaths);
  const findings = collectContentFindings(textFiles, PUBLIC_LANGUAGE_PATTERNS);
  const { allowedFindings, unexpectedFindings } = splitAllowedFindings(
    findings,
    config.publicLanguageAllowlist,
  );
  const failures = unexpectedFindings.map((finding) => ({
    id: 'public-language-residue',
    message: `${finding.filePath}:${finding.lineNumber}: unexpected public-language residue ${finding.patternId}.`,
  }));

  return {
    skipped: false,
    failures,
    allowedFindings,
    unexpectedFindings,
  };
}

function printResult(prefix, result, successMessage, details = []) {
  if (result.skipped) {
    console.log(`${prefix} Skipping checks because no .git directory is present.`);
    return 0;
  }

  if (result.failures.length > 0) {
    result.failures.forEach((failure) => {
      console.error(`${prefix} ${failure.message}`);
    });
    return 1;
  }

  const suffix = details.filter(Boolean).join(' ');
  console.log(`${prefix} ${successMessage}${suffix ? ` ${suffix}` : ''}`);
  return 0;
}

function runPublicHygieneCli() {
  const result = evaluatePublicHygiene();
  const status = printResult(
    '[check-public-repo-state]',
    result,
    'Public hygiene guardrails passed.',
    [
      result.plannedCleanupDocs?.length
        ? `Planned doc cleanup entries still tracked: ${result.plannedCleanupDocs.length}.`
        : '',
    ],
  );
  process.exitCode = status;
}

function runPublicLanguageCli() {
  const result = evaluatePublicLanguage();
  const status = printResult(
    '[check-public-language]',
    result,
    'No unexpected public-language residue found.',
    [
      result.allowedFindings?.length
        ? `Allowed planned cleanup matches: ${result.allowedFindings.length}.`
        : '',
    ],
  );
  process.exitCode = status;
}

module.exports = {
  DEFAULT_CONFIG,
  PUBLIC_LANGUAGE_PATTERNS,
  SECRET_PATTERNS,
  collectContentFindings,
  evaluatePublicHygiene,
  evaluatePublicLanguage,
  evaluateTrackedDocs,
  findBlockedTrackedPathFailures,
  isAllowedFinding,
  normalizePath,
  runPublicHygieneCli,
  runPublicLanguageCli,
  splitAllowedFindings,
};
