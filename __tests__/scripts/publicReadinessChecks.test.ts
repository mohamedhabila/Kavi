const { execFileSync } = require('child_process');
const { mkdtempSync, rmSync, writeFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const {
  DEFAULT_CONFIG,
  PUBLIC_LANGUAGE_PATTERNS,
  SECRET_PATTERNS,
  collectContentFindings,
  evaluatePublicHygiene,
  evaluateTrackedDocs,
  findBlockedTrackedPathFailures,
  splitAllowedFindings,
} = require('../../scripts/lib/publicReadinessChecks');

describe('public readiness checks', () => {
  it('flags tracked private/generated paths', () => {
    const failures = findBlockedTrackedPathFailures(
      [
        '.private/spike.md',
        'docs/baselines/e2e-agent-phase0-baseline.json',
        '.tmp/coverage/coverage-summary.json',
        'src/index.ts',
      ],
      DEFAULT_CONFIG,
    );

    expect(failures.map((failure: { id: string }) => failure.id)).toEqual([
      'private-working-material',
      'generated-doc-baseline',
      'generated-output',
    ]);
  });

  it('requires docs to be public allowlist entries or planned cleanup targets', () => {
    const result = evaluateTrackedDocs(
      [
        'docs/dynamic-code-execution.md',
        'docs/testing.md',
        'docs/release.md',
        'docs/private-surprise.md',
        'src/index.ts',
      ],
      DEFAULT_CONFIG,
    );

    expect(result.plannedCleanupDocs).toEqual([]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain('docs/private-surprise.md');
  });

  it('recognizes private workspace ignores in a clean checkout without local private directories', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'kavi-public-hygiene-'));
    try {
      execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
      writeFileSync(projectRoot + '/.gitignore', ['.private', '.private/', ''].join('\n'));

      const result = evaluatePublicHygiene({
        projectRoot,
        config: {
          ...DEFAULT_CONFIG,
          privatePaths: ['.private'],
          absentLocalPaths: [],
          ignoredPaths: ['.private', '.private/'],
          exportIgnorePaths: [],
          blockedTrackedPathRules: [],
          publicDocAllowlist: new Set(),
          plannedDocCleanupPaths: new Set(),
          excludedContentPaths: new Set(),
          publicLanguageAllowlist: [],
        },
      });

      expect(result.failures).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('detects high-confidence secrets without flagging short placeholders', () => {
    const findings = collectContentFindings(
      [
        {
          filePath: 'src/config.ts',
          content: [
            "const placeholder = 'ghp_test';",
            `const leaked = 'sk-proj-${'A'.repeat(32)}';`,
          ].join('\n'),
        },
      ],
      SECRET_PATTERNS,
    );

    expect(findings).toEqual([
      {
        filePath: 'src/config.ts',
        lineNumber: 2,
        patternId: 'openai-project-key',
      },
    ]);
  });

  it('keeps legacy benchmark and project residue blocked outside checker fixtures', () => {
    const legacyBenchmarkFamily = ['internal', 'pa'].join('-');
    const findings = collectContentFindings(
      [
        {
          filePath: 'src/acceptance/e2eAgent/e2eReadinessDashboard.ts',
          content: `const label = "${['SO', 'TA'].join('')} readiness";`,
        },
        {
          filePath: 'src/newFeature.ts',
          content: `${['Open', 'Claw'].join('')} should not appear here`,
        },
        {
          filePath: 'src/newBenchmark.ts',
          content: `family: "${legacyBenchmarkFamily}"`,
        },
      ],
      PUBLIC_LANGUAGE_PATTERNS,
    );
    const split = splitAllowedFindings(findings, DEFAULT_CONFIG.publicLanguageAllowlist);

    expect(split.allowedFindings).toEqual([]);
    expect(split.unexpectedFindings).toEqual([
      {
        filePath: 'src/acceptance/e2eAgent/e2eReadinessDashboard.ts',
        lineNumber: 1,
        patternId: 'legacy-benchmark-claim',
      },
      {
        filePath: 'src/newFeature.ts',
        lineNumber: 1,
        patternId: 'legacy-project-brand',
      },
      {
        filePath: 'src/newBenchmark.ts',
        lineNumber: 1,
        patternId: 'internal-benchmark-family',
      },
    ]);
  });

  it('does not allow private endpoint residue in ClawHub compatibility paths', () => {
    const privateConvexHost = ['wry', 'manatee', '359'].join('-');
    const privateHubHost = ['hub', 'kavi', 'dev'].join('.');
    const findings = collectContentFindings(
      [
        {
          filePath: 'src/services/clawhub/convexClient.ts',
          content: `const fallback = "https://${privateConvexHost}.convex.cloud";`,
        },
        {
          filePath: '__tests__/services/skills-manager.test.ts',
          content: `const fixtureUrl = "https://${privateHubHost}/example";`,
        },
      ],
      PUBLIC_LANGUAGE_PATTERNS,
    );
    const split = splitAllowedFindings(findings, DEFAULT_CONFIG.publicLanguageAllowlist);

    expect(split.allowedFindings).toEqual([]);
    expect(split.unexpectedFindings).toEqual([
      {
        filePath: 'src/services/clawhub/convexClient.ts',
        lineNumber: 1,
        patternId: 'private-convex-deployment',
      },
      {
        filePath: '__tests__/services/skills-manager.test.ts',
        lineNumber: 1,
        patternId: 'private-kavi-hub-host',
      },
    ]);
  });
});
