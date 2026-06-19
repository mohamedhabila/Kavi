import {
  writeRetainedScenarioTraceArtifact,
  writeTraceArtifactIndex,
  type E2ERunReportScenarioTraceArtifact,
  type E2ETraceArtifactIndexEntry,
  type E2ETraceRetentionReason,
} from './e2eTraceArtifactFiles';
import type { E2EScenarioTraceSummary } from './e2eTraceSummary';

export { buildE2EScenarioTraceSummary } from './e2eTraceSummary';
export type {
  E2ERedactedEvidencePrefixCount,
  E2ERedactedHash,
  E2ERedactedStructuralString,
  E2ERedactedValuePreview,
} from './e2eTraceRedaction';
export type {
  E2ERedactedGoalTrace,
  E2ERedactedGraphAuditEvent,
  E2ERedactedGraphSnapshotTrace,
} from './e2eTraceGraphSnapshots';
export type {
  E2ERedactedToolCallTrace,
  E2ERedactedToolCatalogResultTrace,
  E2ERedactedToolResultTrace,
  E2ERedactedUpdateGoalsResultTrace,
} from './e2eTraceToolResults';
export type {
  E2ERedactedPromptCacheEvent,
  E2ERedactedPromptCacheTrace,
  E2ERedactedUsageTrace,
} from './e2eTraceUsage';
export type {
  E2ERedactedTurnTrace,
  E2EScenarioTraceSummary,
} from './e2eTraceSummary';
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
  generatedAt: string;
  runMetadata: {
    gitSha: string;
    provider: string;
    model: string;
  };
  scenarios: TScenario[];
};

function shouldRetainScenarioTrace(
  scenario: TraceableScenarioEntry,
  sampledPassAlreadyRetained: boolean,
): E2ETraceRetentionReason | null {
  if (!scenario.trace) {
    return null;
  }
  if (!scenario.passed) {
    return 'failed';
  }
  return sampledPassAlreadyRetained ? null : 'sampled_pass';
}

function omitInlineTrace<TScenario extends TraceableScenarioEntry>(scenario: TScenario): TScenario {
  const { trace: _trace, ...scenarioWithoutTrace } = scenario;
  return scenarioWithoutTrace as TScenario;
}

export function writeE2ERedactedTraceArtifacts<
  TScenario extends TraceableScenarioEntry,
  TReport extends TraceableReport<TScenario>,
>(report: TReport, runDir: string): TReport {
  const traceIndex: E2ETraceArtifactIndexEntry[] = [];
  let sampledPassRetained = false;
  const scenarios = report.scenarios.map((scenario) => {
    const retentionReason = shouldRetainScenarioTrace(scenario, sampledPassRetained);
    if (!retentionReason || !scenario.trace) {
      return omitInlineTrace(scenario);
    }
    if (retentionReason === 'sampled_pass') {
      sampledPassRetained = true;
    }

    const { traceArtifact, indexEntry } = writeRetainedScenarioTraceArtifact({
      runDir,
      generatedAt: report.generatedAt,
      runMetadata: report.runMetadata,
      fixtureId: scenario.fixtureId,
      retentionReason,
      trace: scenario.trace,
    });
    traceIndex.push(indexEntry);

    return {
      ...omitInlineTrace(scenario),
      traceArtifact,
    };
  });

  writeTraceArtifactIndex({
    runDir,
    generatedAt: report.generatedAt,
    traces: traceIndex,
  });

  return {
    ...report,
    scenarios,
  } as TReport;
}
