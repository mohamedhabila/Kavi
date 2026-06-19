import type { SubAgentStatus } from '../../types/subAgent';
import { normalizeFinalizationOutputText, truncateFinalizationText } from './finalizationText';

const MAX_DIRECT_DELIVERABLE_CHARS = 6_000;

const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'succeeded',
  'success',
  'ok',
  'finished',
  'resolved',
  'passed',
  'done',
]);

const OUTPUT_KEYS = ['output', 'content', 'text', 'answer', 'result', 'final'];
const COLLECTION_KEYS = ['sessions', 'items', 'results', 'outputs', 'entries'];

export interface AgentRunTerminalDeliverable {
  sourceName: string;
  output: string;
}

function normalizeStatus(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() || undefined : undefined;
}

function isTerminalStatus(value: unknown): boolean {
  const normalized = normalizeStatus(value);
  return normalized ? TERMINAL_STATUSES.has(normalized) : false;
}

function isCompletedSubAgentStatus(status: SubAgentStatus): boolean {
  return status === 'completed';
}

function normalizeDeliverableOutput(value: unknown): string | undefined {
  return typeof value === 'string'
    ? normalizeFinalizationOutputText(value, MAX_DIRECT_DELIVERABLE_CHARS)
    : undefined;
}

function normalizeSourceName(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  return fallback;
}

function pushDeliverable(
  deliverables: AgentRunTerminalDeliverable[],
  sourceName: string,
  output: string | undefined,
): void {
  if (!output) {
    return;
  }

  const key = `${sourceName.trim().toLowerCase()}:${output}`;
  if (
    deliverables.some(
      (deliverable) =>
        `${deliverable.sourceName.trim().toLowerCase()}:${deliverable.output}` === key,
    )
  ) {
    return;
  }

  deliverables.push({
    sourceName: sourceName.trim() || 'tool',
    output,
  });
}

function collectFromRecord(
  value: Record<string, unknown>,
  fallbackSourceName: string,
  deliverables: AgentRunTerminalDeliverable[],
  depth: number,
): void {
  if (depth > 4) {
    return;
  }

  const hasTerminalStatus =
    isTerminalStatus(value.status) ||
    value.hasOutput === true ||
    value.completed === true ||
    value.done === true;
  const recordSourceName = normalizeSourceName(
    value.name ?? value.title ?? value.sessionId ?? value.id ?? value.sourceName,
    fallbackSourceName,
  );

  if (hasTerminalStatus) {
    for (const key of OUTPUT_KEYS) {
      pushDeliverable(deliverables, recordSourceName, normalizeDeliverableOutput(value[key]));
    }
  }

  for (const key of COLLECTION_KEYS) {
    const collection = value[key];
    if (!Array.isArray(collection)) {
      continue;
    }

    for (const item of collection) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        collectFromRecord(
          item as Record<string, unknown>,
          recordSourceName,
          deliverables,
          depth + 1,
        );
      } else {
        pushDeliverable(deliverables, recordSourceName, normalizeDeliverableOutput(item));
      }
    }
  }
}

export function collectTerminalDeliverablesFromToolResult(
  result: string | undefined,
  sourceName: string,
): AgentRunTerminalDeliverable[] {
  const normalizedResult = normalizeFinalizationOutputText(result, MAX_DIRECT_DELIVERABLE_CHARS);
  if (!normalizedResult) {
    return [];
  }

  try {
    const parsed = JSON.parse(normalizedResult) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }

    const deliverables: AgentRunTerminalDeliverable[] = [];
    collectFromRecord(parsed as Record<string, unknown>, sourceName, deliverables, 0);
    return deliverables;
  } catch {
    return [];
  }
}

export function collectTerminalDeliverableFromSubAgent(params: {
  status: SubAgentStatus;
  output?: string;
  sourceName: string;
}): AgentRunTerminalDeliverable | undefined {
  if (!isCompletedSubAgentStatus(params.status)) {
    return undefined;
  }

  const output = normalizeDeliverableOutput(params.output);
  return output ? { sourceName: params.sourceName, output } : undefined;
}

export function selectSingleTerminalDeliverableOutput(
  deliverables: ReadonlyArray<AgentRunTerminalDeliverable>,
): string | undefined {
  const uniqueOutputs = Array.from(
    new Set(
      deliverables
        .map((deliverable) =>
          normalizeFinalizationOutputText(deliverable.output, MAX_DIRECT_DELIVERABLE_CHARS),
        )
        .filter((output): output is string => Boolean(output)),
    ),
  );

  if (uniqueOutputs.length !== 1) {
    return undefined;
  }

  return truncateFinalizationText(uniqueOutputs[0], MAX_DIRECT_DELIVERABLE_CHARS);
}
