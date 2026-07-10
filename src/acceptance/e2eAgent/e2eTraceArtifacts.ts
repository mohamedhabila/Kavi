import {
  writeRetainedScenarioTraceArtifact,
  writeTraceArtifactIndex,
  type E2ERunReportScenarioTraceArtifact,
  type E2ETraceArtifactIndexEntry,
  type E2ETraceRetentionReason,
} from './e2eTraceArtifactFiles';
import {
  projectPublicRunReport,
  type PublicE2ERunReport,
  type PublicE2EScenarioEntry,
} from '../../../scripts/e2eReport/publicRunReport';
import { projectPublicRedactedTrace } from '../../../scripts/e2eReport/publicTraceSchema';
import type { E2EScenarioTraceSummary } from './e2eTraceSummary';

export { buildE2EScenarioTraceSummary } from './e2eTraceSummary';
export type {
  E2ERedactedHash,
  E2ERedactedHashCount,
  E2ERedactedValueFingerprint,
} from './e2eTraceRedaction';
export type {
  E2ERedactedGoalTrace,
  E2ERedactedGraphAuditEvent,
  E2ERedactedGraphAuditType,
  E2ERedactedGraphSnapshotTrace,
} from './e2eTraceGraphSnapshots';
export type {
  E2ERedactedStatusFieldTrace,
  E2ERedactedToolCallTrace,
  E2ERedactedToolCatalogResultTrace,
  E2ERedactedToolResultTrace,
  E2ERedactedUpdateGoalsResultTrace,
} from './e2eTraceToolResults';
export type {
  E2ERedactedPromptCacheEvent,
  E2ERedactedPromptCacheReasonCount,
  E2ERedactedPromptCacheTrace,
  E2ERedactedUsageTrace,
} from './e2eTraceUsage';
export type { E2ERedactedTurnTrace, E2EScenarioTraceSummary } from './e2eTraceSummary';
export type {
  E2ERunReportScenarioTraceArtifact,
  E2ETraceRetentionReason,
} from './e2eTraceArtifactFiles';

type TraceableScenarioEntry = {
  fixtureId: string;
  passed: boolean;
  trace?: E2EScenarioTraceSummary;
  traceArtifact?: E2ERunReportScenarioTraceArtifact;
};

type TraceableReport<TScenario extends TraceableScenarioEntry> = {
  schemaVersion: 'e2e-run-report-v2';
  generatedAt: string;
  runMetadata: {
    gitSha: string;
    provider: string;
    hostedFamily: string;
    model: string;
    endpointSha256: string;
  };
  scenarios: TScenario[];
};

function shouldRetainScenarioTrace(
  scenario: TraceableScenarioEntry,
  trace: E2EScenarioTraceSummary | null,
  sampledPassAlreadyRetained: boolean,
): E2ETraceRetentionReason | null {
  if (!trace) {
    return null;
  }
  if (!scenario.passed) {
    return 'failed';
  }
  return sampledPassAlreadyRetained ? null : 'sampled_pass';
}

export function writeE2ERedactedTraceArtifacts<
  TScenario extends TraceableScenarioEntry,
  TReport extends TraceableReport<TScenario>,
>(report: TReport, runDir: string, retentionRunId: string): PublicE2ERunReport {
  const publicReport = projectPublicRunReport(report);
  const traceIndex: E2ETraceArtifactIndexEntry[] = [];
  let sampledPassRetained = false;
  const scenarios = publicReport.scenarios.map((publicScenario, index) => {
    const sourceScenario = report.scenarios[index];
    const trace = projectPublicRedactedTrace(sourceScenario?.trace);
    const retentionReason = sourceScenario
      ? shouldRetainScenarioTrace(sourceScenario, trace, sampledPassRetained)
      : null;
    if (!retentionReason || !trace) {
      return publicScenario;
    }
    if (retentionReason === 'sampled_pass') {
      sampledPassRetained = true;
    }

    const { traceArtifact, indexEntry } = writeRetainedScenarioTraceArtifact({
      runDir,
      retentionRunId,
      generatedAt: publicReport.generatedAt,
      runMetadata: publicReport.runMetadata,
      fixtureId: publicScenario.fixtureId,
      retentionReason,
      trace,
    });
    traceIndex.push(indexEntry);

    return {
      ...publicScenario,
      traceArtifact,
    } satisfies PublicE2EScenarioEntry;
  });

  writeTraceArtifactIndex({
    runDir,
    generatedAt: publicReport.generatedAt,
    traces: traceIndex,
  });

  return { ...publicReport, scenarios };
}
