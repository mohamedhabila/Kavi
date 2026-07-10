import type { E2ERedactedHash } from '../../src/acceptance/e2eAgent/e2eTraceRedaction';
import type { E2ERedactedPromptCacheTrace } from '../../src/acceptance/e2eAgent/e2eTraceUsage';
import type { UsageTokenBuckets } from '../../src/types/usage';

export type PublicE2ERunMetadata = {
  gitSha: string;
  provider: string;
  providerId?: string;
  hostedFamily: string;
  model: string;
  modelIdentitySource: 'provider-model-id' | 'explicit-public-id';
  modelLocatorSha256: string;
  modelVersion?: string;
  endpointSha256: string;
  temperature?: number;
  seed?: number;
  scenarioManifestVersion: string;
  promptCacheMode: string;
  nativeToolFixtureVersion: string;
  collectMode: boolean;
};

export type PublicE2EUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  eventCount: number;
  tokenBuckets?: UsageTokenBuckets;
  promptCache?: E2ERedactedPromptCacheTrace;
};

export type PublicE2ELoopToolCall = {
  name?: string;
  nameHash: E2ERedactedHash;
  argumentsFingerprintHash: E2ERedactedHash;
  count: number;
  noNewEvidence: boolean;
};

export type PublicE2EScenarioEntry = {
  suite: string;
  fixtureId: string;
  passed: boolean;
  attemptCount: number;
  durationMs: number;
  completed: boolean;
  userTurnCount: number;
  toolCallCount: number;
  turnCount: number;
  graphStatus: string | null;
  usage: PublicE2EUsage;
  tokenBuckets: UsageTokenBuckets;
  cache: Readonly<Record<string, number | boolean>>;
  loopDiagnostics: {
    repeatedToolCalls: PublicE2ELoopToolCall[];
    repeatedCatalogAfterActivationCount: number;
    repeatedHoldReasons: Array<{ reasonHash: E2ERedactedHash; count: number }>;
    passing: boolean;
  };
  benchmarkFamilies: string[];
  assessmentDimensions: string[];
  rubricPassed?: number;
  rubricTotal?: number;
  failedRubrics?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  rubricAudit: Readonly<Record<string, unknown>>;
  detailHash?: E2ERedactedHash;
  errorCount: number;
  errorHashes: E2ERedactedHash[];
  traceArtifact?: {
    referenceBase: 'retention_root';
    relativePath: string;
    retentionReason: 'failed' | 'sampled_pass';
  };
};

export type PublicE2ERunReport = {
  schemaVersion: 'e2e-run-report-v2';
  generatedAt: string;
  maxScenarioRetries: number;
  runMetadata: PublicE2ERunMetadata;
  scenarios: PublicE2EScenarioEntry[];
  totals: Readonly<Record<string, number>>;
  cache: Readonly<Record<string, unknown>>;
  graderAudit: Readonly<Record<string, unknown>>;
  assessment: Readonly<Record<string, unknown>>;
  reliability: Readonly<Record<string, unknown>>;
  readiness: Readonly<Record<string, unknown>>;
  readinessDashboard: Readonly<Record<string, unknown>>;
  metricsPassing: boolean;
};

export const RUN_REPORT_SCHEMA_VERSION: 'e2e-run-report-v2';

export function projectPublicRunReport(value: unknown): PublicE2ERunReport;
