import { spawnSync } from 'child_process';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');

function runVerifyStrictE2e(env: NodeJS.ProcessEnv) {
  return spawnSync('node', ['./scripts/verify-strict-e2e.js'], {
    cwd: projectRoot,
    env,
    encoding: 'utf8',
  });
}

describe('verify-strict-e2e harness', () => {
  it('fails fast when RUN_E2E_AGENT_EVAL is not enabled', () => {
    const result = runVerifyStrictE2e({
      ...process.env,
      RUN_E2E_AGENT_EVAL: '',
      GEMINI_API_KEY: '',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toContain('RUN_E2E_AGENT_EVAL=1');
  });

  it('fails fast when GEMINI_API_KEY is missing', () => {
    const result = runVerifyStrictE2e({
      ...process.env,
      RUN_E2E_AGENT_EVAL: '1',
      GEMINI_API_KEY: '',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toContain('GEMINI_API_KEY');
  });
});