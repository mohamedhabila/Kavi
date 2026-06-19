import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const { configureE2eReportEnv } = require('../../scripts/lib/harness');

describe('e2e harness report setup', () => {
  it('clears stale partial report entries before a new run starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kavi-e2e-harness-'));
    try {
      const reportPath = join(dir, 'report.json');
      const partialPath = `${reportPath}.partial.json`;
      writeFileSync(partialPath, '[{"fixtureId":"stale"}]', 'utf8');

      const env = {
        E2E_REPORT_PATH: reportPath,
        E2E_MAX_SCENARIO_RETRIES: '2',
      };
      const result = configureE2eReportEnv(dir, env);

      expect(result).toEqual({ reportPath, maxRetries: '2' });
      expect(env.E2E_REPORT_PARTIAL_PATH).toBe(partialPath);
      expect(existsSync(partialPath)).toBe(false);
      expect(() => readFileSync(partialPath, 'utf8')).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
