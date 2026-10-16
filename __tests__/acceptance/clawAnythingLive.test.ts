// ---------------------------------------------------------------------------
// Claw-Anything — one benchmark task through Kavi (opt-in, live)
// ---------------------------------------------------------------------------
// Gated: RUN_CLAW_ANYTHING=1, CLAW_ANYTHING_SPEC=<task spec JSON written by
// benchmarks/claw_anything/kavi_agent.py>, CLAW_ANYTHING_DISPATCH_TOKEN (the adapter's
// dispatcher token) and the selected E2E provider's credentials. Run with TZ=UTC: the
// task's day is a UTC date. The record is written to the spec's outPath.
// ---------------------------------------------------------------------------

jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});
jest.mock('expo-notifications', () =>
  require('../../src/acceptance/e2eAgent/e2eNativeNotificationsModule').createE2ENotificationsModule(),
);

import fs from 'fs';

import { runClawAnythingTask } from '../../src/acceptance/clawAnything/clawAnythingRun';
import {
  clawAnythingTaskNow,
  parseClawAnythingTaskSpec,
} from '../../src/acceptance/clawAnything/clawAnythingSpec';
import { httpClawAnythingDispatch } from '../../src/acceptance/clawAnything/clawAnythingToolServer';
import { teardownE2EMemorySandbox } from '../../src/acceptance/e2eAgent/sandboxMemory';
import { resetE2EWorkspaceSandbox } from '../../src/acceptance/e2eAgent/sandboxWorkspace';
import { shouldRunE2EAgentEval } from '../../src/acceptance/e2eAgent/providerConfig';
import { mcpManager } from '../../src/services/mcp/manager';
import { installClockOffset } from '../helpers/clockOffset';

const SPEC_PATH = process.env.CLAW_ANYTHING_SPEC?.trim() ?? '';
const enabled =
  process.env.RUN_CLAW_ANYTHING === '1' && SPEC_PATH.length > 0 && shouldRunE2EAgentEval();
const describeLive = enabled ? describe : describe.skip;
/** Provider catalog discovery and teardown, beyond the task's own time limit. */
const SETUP_MARGIN_MS = 120_000;

describeLive('Claw-Anything task (live)', () => {
  // A skipped describe still runs its body, so nothing is read unless the run is opted in.
  const spec = enabled
    ? parseClawAnythingTaskSpec(JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8')))
    : null;

  afterAll(() => {
    mcpManager.disconnectAll();
    resetE2EWorkspaceSandbox();
    teardownE2EMemorySandbox();
  });

  it(
    `runs ${spec?.taskId ?? 'the task'}`,
    async () => {
      if (!spec) throw new Error('No task spec.');
      const token = process.env.CLAW_ANYTHING_DISPATCH_TOKEN?.trim();
      if (!token) throw new Error('CLAW_ANYTHING_DISPATCH_TOKEN is not set.');
      const restoreClock = installClockOffset(clawAnythingTaskNow(spec) - Date.now());
      try {
        const record = await runClawAnythingTask(
          spec,
          httpClawAnythingDispatch(spec.dispatchUrl, token),
        );
        fs.writeFileSync(spec.outPath, JSON.stringify(record));
      } finally {
        restoreClock();
      }
    },
    (spec?.timeoutSeconds ?? 60) * 1_000 + SETUP_MARGIN_MS,
  );
});
