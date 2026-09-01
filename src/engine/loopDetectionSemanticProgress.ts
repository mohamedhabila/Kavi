import type { ToolMessageOutcomeStatus } from './toolExecution/toolMessageOutcome';
import {
  descriptorForToolName,
  descriptorHasInspectionEffect,
} from './tools/toolLifecycleSemantics';
import {
  hashResult,
  hashToolCall,
  normalizeToolNameKey,
  simpleLoopDetectionHash,
} from './loopDetectionKeys';

export type IterationToolProgressRecord = Readonly<{
  name: string;
  arguments: string;
  status: ToolMessageOutcomeStatus;
  result?: string;
}>;

type InformationToolCallRecord = IterationToolProgressRecord &
  Readonly<{
    argsHash?: string;
    resultHash?: string;
  }>;

function isInformationInspectionTool(toolName: string): boolean {
  return descriptorHasInspectionEffect(descriptorForToolName(toolName));
}

export function isDistinctInformationOnlyToolMultiset(multisetKey: string | undefined): boolean {
  const toolNames = (multisetKey ?? '').split('|').filter(Boolean);
  return toolNames.length > 0 && toolNames.every(isInformationInspectionTool);
}

/**
 * Whether a window of repeated tool calls did distinct work rather than spinning.
 *
 * Goal state is the graph's measure of progress, and it is deliberately unchanged while a
 * model debugs: isolating a wrong number produces no artifact and closes no goal. Tool
 * names are no better a measure, because iterating on one problem means calling one tool.
 * What separates iteration from a loop is whether each call asked something new and got
 * something new back — every argument distinct and every result distinct across the whole
 * window. The moment a result repeats, the window stops qualifying and detection resumes.
 *
 * Traced live on an Android emulator. The model ran a Monte Carlo NPV in `python`, read
 * ~-4400M where ~+130M was expected, said "let me debug the calculation", then "there's a
 * discrepancy between the vectorized and manual NPV, let me isolate the bug" — three
 * different programs, three different outputs, a real defect correctly diagnosed. The run
 * was killed `loop_detected` on the third call.
 *
 * The gate was `isInformationInspectionTool`, so only reads could ever demonstrate
 * progress; a compute tool had no way to show it had done anything, no matter what it
 * computed. Distinct-in, distinct-out is what the check always meant, and it is a property
 * of the call, not of the tool's category — so it is asked of every tool.
 */
export function isCompletedDistinctProgressWindow(
  params: {
    history: ReadonlyArray<InformationToolCallRecord>;
    multisetKey: string | undefined;
    count: number | undefined;
  },
  defaultCount: number,
): boolean {
  const toolNames = (params.multisetKey ?? '').split('|').filter(Boolean);
  if (toolNames.length === 0) {
    return false;
  }

  const count = params.count ?? defaultCount;
  const recent = params.history.slice(-count);
  if (
    recent.length !== count ||
    recent.some((entry) => entry.status !== 'completed' || entry.result === undefined)
  ) {
    return false;
  }

  const argumentFingerprints = recent.map(
    (entry) => entry.argsHash ?? hashToolCall(entry.name, entry.arguments),
  );
  const resultFingerprints = recent.map((entry) => entry.resultHash ?? hashResult(entry.result));
  return (
    new Set(argumentFingerprints).size === recent.length &&
    new Set(resultFingerprints).size === recent.length
  );
}

export function countTrailingIdenticalInformationResults(params: {
  history: ReadonlyArray<InformationToolCallRecord>;
  multisetKey: string | undefined;
}): number | undefined {
  const toolNames = (params.multisetKey ?? '').split('|').filter(Boolean);
  if (toolNames.length !== 1 || !isInformationInspectionTool(toolNames[0]!)) {
    return undefined;
  }

  const expectedToolName = toolNames[0]!;
  const latest = params.history[params.history.length - 1];
  if (
    !latest ||
    latest.status !== 'completed' ||
    normalizeToolNameKey(latest.name) !== expectedToolName
  ) {
    return undefined;
  }
  const latestResult = latest.resultHash ?? hashResult(latest.result);
  if (!latestResult) return undefined;

  let count = 0;
  for (let index = params.history.length - 1; index >= 0; index -= 1) {
    const entry = params.history[index];
    if (
      entry.status !== 'completed' ||
      normalizeToolNameKey(entry.name) !== expectedToolName ||
      (entry.resultHash ?? hashResult(entry.result)) !== latestResult
    ) {
      break;
    }
    count += 1;
  }
  return count;
}

/**
 * Captures useful information gathered by one model iteration. Tool names alone cannot describe
 * progress: paginated reads intentionally repeat the same tool while advancing through new input.
 * Failed calls and mutating tools are excluded so argument churn cannot masquerade as evidence.
 */
export function buildIterationSemanticProgressFingerprint(
  records: ReadonlyArray<IterationToolProgressRecord>,
): string {
  const completedInspectionRecords = records
    .filter(
      (record) =>
        record.status === 'completed' &&
        record.result !== undefined &&
        isInformationInspectionTool(normalizeToolNameKey(record.name)),
    )
    .map((record) => {
      const toolName = normalizeToolNameKey(record.name);
      return `${hashToolCall(toolName, record.arguments)}:${hashResult(record.result)}`;
    })
    .sort();

  return completedInspectionRecords.length > 0
    ? simpleLoopDetectionHash(completedInspectionRecords.join('|'))
    : '';
}
