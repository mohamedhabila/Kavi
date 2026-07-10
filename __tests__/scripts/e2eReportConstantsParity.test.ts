import {
  E2E_BENCHMARK_MANIFEST_VERSION,
  E2E_BENCHMARK_SOURCE_REFRESH_DATE,
} from '../../src/acceptance/e2eAgent/e2eBenchmarkManifest';
import { E2E_READINESS_DASHBOARD_VERSION } from '../../src/acceptance/e2eAgent/e2eReadinessDashboard';
import {
  E2E_NATIVE_TOOL_FIXTURE_VERSION,
  E2E_SCENARIO_MANIFEST_VERSION,
} from '../../src/acceptance/e2eAgent/thresholds';

const reportConstants = require('../../scripts/e2eReport/constants') as {
  BENCHMARK_MANIFEST_VERSION: string;
  BENCHMARK_SOURCE_REFRESH_DATE: string;
  NATIVE_TOOL_FIXTURE_VERSION: string;
  READINESS_DASHBOARD_VERSION: string;
  SCENARIO_MANIFEST_VERSION: string;
};

it('keeps TypeScript and report-harness evaluation contracts on identical versions', () => {
  expect(reportConstants).toMatchObject({
    BENCHMARK_MANIFEST_VERSION: E2E_BENCHMARK_MANIFEST_VERSION,
    BENCHMARK_SOURCE_REFRESH_DATE: E2E_BENCHMARK_SOURCE_REFRESH_DATE,
    NATIVE_TOOL_FIXTURE_VERSION: E2E_NATIVE_TOOL_FIXTURE_VERSION,
    READINESS_DASHBOARD_VERSION: E2E_READINESS_DASHBOARD_VERSION,
    SCENARIO_MANIFEST_VERSION: E2E_SCENARIO_MANIFEST_VERSION,
  });
});
