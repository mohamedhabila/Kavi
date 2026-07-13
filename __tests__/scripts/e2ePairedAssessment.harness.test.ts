import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';

const projectRoot = resolve(__dirname, '../..');

describe('paired E2E assessment harness', () => {
  it('rejects an oversized run ID before starting the provider-backed Jest collector', () => {
    const fakeBin = mkdtempSync(join(tmpdir(), 'kavi-paired-fake-bin-'));
    const marker = join(fakeBin, 'npx-called');
    const fakeNpx = join(fakeBin, process.platform === 'win32' ? 'npx.cmd' : 'npx');
    try {
      writeFileSync(
        fakeNpx,
        process.platform === 'win32'
          ? `@echo called>${marker}\r\n@exit /b 73\r\n`
          : `#!/bin/sh\nprintf called > "$E2E_FAKE_NPX_MARKER"\nexit 73\n`,
        'utf8',
      );
      chmodSync(fakeNpx, 0o755);

      const result = spawnSync(process.execPath, ['./scripts/e2e-paired-assessment.js'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          PATH: fakeBin,
          E2E_FAKE_NPX_MARKER: marker,
          E2E_PAIRED_RUN_ID: `r${'x'.repeat(128)}`,
          E2E_PAIRED_SCENARIO_ID: 'paired-causal-global-preference',
          E2E_PAIRED_SEED: '42003',
          RUN_E2E_AGENT_EVAL: '1',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('bounded path-free identifier');
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
