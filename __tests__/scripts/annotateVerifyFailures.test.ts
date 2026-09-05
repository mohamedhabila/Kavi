// ---------------------------------------------------------------------------
// Tests — scripts/ci/annotate-verify-failures.js
// ---------------------------------------------------------------------------

const {
  collectFailures,
  renderAnnotations,
} = require('../../scripts/ci/annotate-verify-failures.js') as {
  collectFailures: (logText: string) => { suites: string[]; tests: string[] };
  renderAnnotations: (failures: { suites: string[]; tests: string[] }) => string[];
};

describe('annotate-verify-failures', () => {
  it('collects failing suites and tests from a Jest log and ignores console blocks', () => {
    const log = [
      'PASS __tests__/a.test.ts',
      'FAIL __tests__/screens/GatewayScreen.test.tsx',
      '  ● GatewayScreen › shows an alert when listing nodes fails',
      '  ● Console',
      '    console.error',
      'FAIL __tests__/screens/GatewayScreen.test.tsx',
      '  ● GatewayScreen › shows an alert when listing nodes fails',
      'Tests:       1 failed, 10 passed, 11 total',
    ].join('\n');

    expect(collectFailures(log)).toEqual({
      suites: ['__tests__/screens/GatewayScreen.test.tsx'],
      tests: ['GatewayScreen › shows an alert when listing nodes fails'],
    });
  });

  it('renders one error annotation per failure and escapes annotation syntax', () => {
    const output = renderAnnotations({
      suites: ['__tests__/x.test.ts'],
      tests: ['x › handles 100% of cases'],
    });

    expect(output).toEqual([
      '::error title=Jest failure::suite: __tests__/x.test.ts',
      '::error title=Jest failure::test: x › handles 100%25 of cases',
    ]);
  });

  it('caps annotations at ten and announces the truncation', () => {
    const tests = Array.from({ length: 14 }, (_, index) => `suite › case ${index}`);
    const output = renderAnnotations({ suites: [], tests });

    expect(output).toHaveLength(11);
    expect(output[10]).toContain('::warning title=Jest failures truncated::4 more');
  });

  it('points at the earlier verify stages when no Jest failure is present', () => {
    const output = renderAnnotations(collectFailures('npm ERR! Lifecycle script `lint` failed'));

    expect(output).toHaveLength(1);
    expect(output[0]).toContain('earlier verify stage');
  });
});
