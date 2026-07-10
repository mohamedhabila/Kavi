import type { MemoryFact } from './facts/types';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { isExactMemoryScopeId } from './memoryScopeIdentity';

export type ExperienceViewKind =
  | 'procedure'
  | 'precondition'
  | 'outcome'
  | 'artifact'
  | 'decision'
  | 'failure'
  | 'gotcha';

export interface ExperienceEvidenceLink {
  factId: string;
  contentHash: string;
  sourceRunId: string;
  sourceTurnId: string | null;
  sourceMessageId: string | null;
  sourceAuthority: string;
}

export interface ExperienceApplicability {
  conversationId: string;
  threadId: string;
  taskId: string | null;
  domain: string | null;
  environment: string | null;
  generalization: 'single_run';
}

interface ExperienceViewBase {
  kind: ExperienceViewKind;
  evidence: ExperienceEvidenceLink;
  applicability: ExperienceApplicability;
  confidence: number;
}

export interface ExperienceProcedureStep {
  sequence: number;
  action: string | null;
  toolName: string | null;
  status: string | null;
  url: string | null;
}

export type ExperienceView =
  | (ExperienceViewBase & { kind: 'procedure'; steps: ReadonlyArray<ExperienceProcedureStep> })
  | (ExperienceViewBase & { kind: 'precondition'; values: ReadonlyArray<string> })
  | (ExperienceViewBase & { kind: 'outcome'; status: string | null; value: string | null })
  | (ExperienceViewBase & { kind: 'artifact'; values: ReadonlyArray<string> })
  | (ExperienceViewBase & { kind: 'decision'; values: ReadonlyArray<string> })
  | (ExperienceViewBase & { kind: 'failure'; status: string; detail: string | null })
  | (ExperienceViewBase & { kind: 'gotcha'; values: ReadonlyArray<string> });

type JsonRecord = Record<string, unknown>;

const MAX_RECORD_CHARS = 10_000;
const MAX_LIST_ITEMS = 12;
const MAX_STEP_ITEMS = 12;
const MAX_VALUE_CHARS = 800;
const MAX_STATUS_CHARS = 120;
const FAILED_STATUS = new Set([
  'cancelled',
  'canceled',
  'error',
  'failed',
  'failure',
  'incomplete',
]);

function boundedText(value: unknown, maxChars = MAX_VALUE_CHARS): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 1).trimEnd()}…`;
}

function boundedStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values: string[] = [];
  const seen = new Set<string>();
  for (const entry of value.slice(0, MAX_LIST_ITEMS)) {
    const text = boundedText(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    values.push(text);
  }
  return values;
}

function parseCompactRecord(value: string): JsonRecord {
  if (value.length > MAX_RECORD_CHARS) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

function procedureSteps(value: unknown): ExperienceProcedureStep[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_STEP_ITEMS).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as JsonRecord;
    const action = boundedText(record.action);
    const toolName = boundedText(record.toolName ?? record.tool_name, 160);
    const status = boundedText(record.status, MAX_STATUS_CHARS);
    const url = boundedText(record.url, 400);
    if (!action && !toolName && !status && !url) return [];
    return [{ sequence: index, action, toolName, status, url }];
  });
}

function exactOptionalProvenanceId(value: string | null): string | null | undefined {
  return value === null ? null : isExactMemoryProvenanceId(value) ? value : undefined;
}

function exactOptionalScopeId(value: string | null): string | null | undefined {
  return value === null ? null : isExactMemoryScopeId(value) ? value : undefined;
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function commonViewState(fact: MemoryFact, record: JsonRecord) {
  const sourceTurnId = exactOptionalProvenanceId(fact.sourceTurnId);
  const sourceMessageId = exactOptionalProvenanceId(fact.sourceMessageId);
  const taskId = exactOptionalScopeId(fact.originTaskId);
  if (
    !isExactMemoryProvenanceId(fact.id) ||
    !isExactMemoryProvenanceId(fact.contentHash) ||
    !isExactMemoryProvenanceId(fact.sourceRunId) ||
    !isExactMemoryScopeId(fact.originConversationId) ||
    !isExactMemoryScopeId(fact.originThreadId) ||
    sourceTurnId === undefined ||
    sourceMessageId === undefined ||
    taskId === undefined
  ) {
    return null;
  }
  return {
    evidence: {
      factId: fact.id,
      contentHash: fact.contentHash,
      sourceRunId: fact.sourceRunId,
      sourceTurnId,
      sourceMessageId,
      sourceAuthority: fact.sourceAuthority,
    },
    applicability: {
      conversationId: fact.originConversationId,
      threadId: fact.originThreadId,
      taskId,
      domain: boundedText(record.domain, 160),
      environment: boundedText(record.environment, 240),
      generalization: 'single_run' as const,
    },
    confidence: clampConfidence(fact.confidence),
  };
}

/**
 * Project one compact agent-run fact into bounded typed views. Views retain an
 * exact link to the raw fact and stay single-run scoped until a later learning
 * stage has independent corroborating evidence.
 */
export function projectAgentRunExperienceViews(fact: MemoryFact): ExperienceView[] {
  if (fact.memoryKind !== 'agent_run') return [];
  const record = { ...parseCompactRecord(fact.objectText), ...fact.attributes };
  const common = commonViewState(fact, record);
  if (!common) return [];

  const views: ExperienceView[] = [];
  const steps = procedureSteps(record.evidenceSlices);
  if (steps.length > 0) views.push({ ...common, kind: 'procedure', steps });

  const preconditions = boundedStringList(record.preconditions);
  if (preconditions.length > 0) {
    views.push({ ...common, kind: 'precondition', values: preconditions });
  }

  const status = boundedText(record.status, MAX_STATUS_CHARS);
  const outcome = boundedText(record.outcome);
  if (status || outcome) views.push({ ...common, kind: 'outcome', status, value: outcome });

  const artifacts = boundedStringList(record.artifacts);
  if (artifacts.length > 0) views.push({ ...common, kind: 'artifact', values: artifacts });

  const decisions = boundedStringList(record.decisions);
  if (decisions.length > 0) views.push({ ...common, kind: 'decision', values: decisions });

  if (status && FAILED_STATUS.has(status.toLocaleLowerCase())) {
    views.push({
      ...common,
      kind: 'failure',
      status,
      detail: outcome,
      confidence: Math.min(common.confidence, 0.5),
    });
  }

  const gotchas = Array.from(
    new Set([...boundedStringList(record.gotchas), ...boundedStringList(record.risks)]),
  ).slice(0, MAX_LIST_ITEMS);
  if (gotchas.length > 0) views.push({ ...common, kind: 'gotcha', values: gotchas });
  return views;
}
