// ---------------------------------------------------------------------------
// Kavi — Evidence-to-Fact bridge
// ---------------------------------------------------------------------------
// Workflow evidence entries (kind=fact / decision / verified-source) often
// hold durable assertions that should outlive the agent run. This bridge
// converts a small, well-defined subset of evidence into bi-temporal facts.
//
// Conservative by design:
//   • Only kinds 'fact' and 'decision' are bridged (others are run-scoped).
//   • Evidence with status='candidate' is bridged at low confidence (0.5).
//   • Evidence with status='verified' is bridged at high confidence (0.85).
//   • Evidence with status='open' or 'resolved' is NOT bridged (signal-poor).
//   • The fact subject is the workflow run by default; callers may override.
//   • dedupeKey, when present, becomes the predicate; otherwise a synthetic
//     `evidence_<kind>` predicate is used so the same entry never bridges
//     twice (recordFact hashes by content).
// ---------------------------------------------------------------------------

import type { AgentRunEvidenceEntry, AgentRunEvidenceRecorder } from '../../types/agentRun';
import { runMemoryTransaction } from './access/transaction';
import { addFactEvidence } from './episodes/mutations';
import { recordFactWithContribution } from './facts/mutations';
import type { MemoryFactScope, RecordFactResult } from './facts/types';
import { requireFactMutationTimestamp } from './facts/mutationValidation';
import { upsertEntity, type EntityType } from './entities';
import { ensureFactSchema } from './schema';
import type { MemoryFactContributionSourceAlias } from './factContributionCodec';
import {
  buildGraphEvidenceFactProducerEventId,
  GRAPH_EVIDENCE_FACT_PRODUCER_ID,
} from './evidenceBridgeContributionIdentity';
import { requireExactMemoryProvenanceId } from './memoryProvenanceIdentity';

export interface EvidenceBridgeOptions {
  /**
   * Subject entity for the bridged facts. Defaults to the agent run id (passed
   * as `defaultSubject`). When neither is provided the bridge is a no-op.
   */
  subjectName?: string;
  subjectType?: EntityType;
  /** Used when subjectName is not provided. */
  defaultSubject?: { name: string; type?: EntityType };
  /** Run id for traceability — written to RecordFact.sourceRunId. */
  sourceRunId?: string;
  /** Stable closed-turn id used to make repeated ingestion idempotent. */
  sourceTurnId: string;
  /** Exact source scope of the closed product turn, independent from fact scope. */
  memoryConversationId: string;
  sourceThreadId: string;
  taskId: string | null;
  originConversationId?: string;
  originThreadId?: string;
  originTaskId?: string;
  scope: MemoryFactScope;
  /** Code-owned closed-turn clock; replay must reuse this exact value. */
  now: number;
}

export type GraphGoalEvidenceBridgeOptions = EvidenceBridgeOptions;

const MAX_GRAPH_EVIDENCE_BRIDGE_ENTRIES = 64;
const MAX_BRIDGED_OBJECT_TEXT_CHARS = 3200;

const DEFAULT_BRIDGED_KINDS: ReadonlySet<AgentRunEvidenceEntry['kind']> = new Set([
  'fact',
  'decision',
]);

const STATUS_CONFIDENCE: Record<AgentRunEvidenceEntry['status'], number | null> = {
  verified: 0.85,
  candidate: 0.5,
  open: null,
  resolved: null,
};

export interface BridgeEvidenceResult {
  bridged: RecordFactResult[];
  skipped: Array<{ id: string; reason: string }>;
}

function buildPredicate(entry: AgentRunEvidenceEntry): string {
  const dedupe = entry.dedupeKey?.trim();
  if (dedupe) return dedupe.slice(0, 80);
  return `evidence_${entry.kind}`;
}

function buildObjectText(entry: AgentRunEvidenceEntry): string {
  const title = entry.title?.trim();
  const content = entry.content?.trim();
  if (title && content && title !== content) {
    const merged = `${title}: ${content}`;
    return merged.length > MAX_BRIDGED_OBJECT_TEXT_CHARS
      ? `${merged.slice(0, MAX_BRIDGED_OBJECT_TEXT_CHARS - 1).trimEnd()}\u2026`
      : merged;
  }
  const value = (title || content || '').trim();
  return value.length > MAX_BRIDGED_OBJECT_TEXT_CHARS
    ? `${value.slice(0, MAX_BRIDGED_OBJECT_TEXT_CHARS - 1).trimEnd()}\u2026`
    : value;
}

/**
 * Bridge a list of evidence entries to bi-temporal facts.
 * Policy-ineligible entries are reported in `skipped`. Source-integrity or
 * persistence failures throw so the owning turn transaction can roll back.
 * Exact source replays reuse both the fact and its immutable contribution.
 */
export function bridgeEvidenceToFacts(
  entries: ReadonlyArray<AgentRunEvidenceEntry>,
  options: EvidenceBridgeOptions,
): BridgeEvidenceResult {
  ensureFactSchema();

  const subjectName = options.subjectName?.trim() || options.defaultSubject?.name?.trim() || '';
  const subjectType: EntityType = options.subjectType ?? options.defaultSubject?.type ?? 'project';
  const sourceTurnId = requireExactMemoryProvenanceId(
    options.sourceTurnId,
    'memory_graph_evidence_source_turn_id_invalid',
  );
  const sourceRunId =
    options.sourceRunId === undefined
      ? null
      : requireExactMemoryProvenanceId(
          options.sourceRunId,
          'memory_graph_evidence_source_run_id_invalid',
        );
  const now = requireFactMutationTimestamp(options.now, 'memory_graph_evidence_clock_invalid');

  const bridged: RecordFactResult[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  if (!subjectName) {
    return {
      bridged,
      skipped: entries.map((e) => ({ id: e.id, reason: 'missing subject' })),
    };
  }

  const bridgeable: Array<{
    entry: AgentRunEvidenceEntry;
    inputIndex: number;
    confidence: number;
    objectText: string;
  }> = [];
  for (const [inputIndex, entry] of entries.entries()) {
    if (!DEFAULT_BRIDGED_KINDS.has(entry.kind)) {
      skipped.push({ id: entry.id, reason: `kind=${entry.kind} not bridged` });
      continue;
    }
    const confidence = STATUS_CONFIDENCE[entry.status];
    if (confidence == null) {
      skipped.push({ id: entry.id, reason: `status=${entry.status} not bridged` });
      continue;
    }
    const objectText = buildObjectText(entry);
    if (!objectText) {
      skipped.push({ id: entry.id, reason: 'no title or content' });
      continue;
    }
    requireExactMemoryProvenanceId(entry.id, 'memory_graph_evidence_entry_id_invalid');
    bridgeable.push({ entry, inputIndex, confidence, objectText });
  }
  if (bridgeable.length === 0) return { bridged, skipped };

  return runMemoryTransaction(() => {
    const subjectId = upsertEntity({
      name: subjectName,
      type: subjectType,
      now,
    }).id;
    const sourceAliases: MemoryFactContributionSourceAlias[] = [
      { sourceKind: 'message', sourceId: sourceTurnId },
      { sourceKind: 'turn', sourceId: sourceTurnId },
      ...(sourceRunId ? [{ sourceKind: 'run' as const, sourceId: sourceRunId }] : []),
    ];
    for (const { entry, inputIndex, confidence, objectText } of bridgeable) {
      const recorded = recordFactWithContribution(
        {
          subjectId,
          predicate: buildPredicate(entry),
          objectText,
          confidence,
          scope: options.scope,
          ...(sourceRunId ? { sourceRunId } : {}),
          sourceMessageId: sourceTurnId,
          sourceTurnId,
          ...(options.originConversationId
            ? { originConversationId: options.originConversationId }
            : {}),
          ...(options.originThreadId ? { originThreadId: options.originThreadId } : {}),
          ...(options.originTaskId ? { originTaskId: options.originTaskId } : {}),
          now,
        },
        {
          factClass: 'workflow',
          sourceAuthority: 'assistant_inferred',
        },
        {
          memoryConversationId: options.memoryConversationId,
          sourceThreadId: options.sourceThreadId,
          taskId: options.taskId,
          producer: {
            producerId: GRAPH_EVIDENCE_FACT_PRODUCER_ID,
            producerEventId: buildGraphEvidenceFactProducerEventId({
              sourceTurnId,
              evidenceEntryId: entry.id,
              inputIndex,
            }),
          },
          sourceAliases,
        },
      );
      addFactEvidence({
        factId: recorded.fact.id,
        messageId: sourceTurnId,
        role: 'assistant',
        quote: objectText,
        now,
      });
      bridged.push(recorded);
    }
    return { bridged, skipped };
  });
}

function resolveGraphEvidenceRecorder(prefix: string): AgentRunEvidenceRecorder {
  if (prefix === 'python') return 'python';
  if (prefix === 'worker') return 'worker';
  return 'tool';
}

export function mapGraphGoalEvidenceToEntries(
  evidenceStrings: ReadonlyArray<string>,
  now: number = Date.now(),
): AgentRunEvidenceEntry[] {
  const unique = Array.from(
    new Set(evidenceStrings.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  ).slice(0, MAX_GRAPH_EVIDENCE_BRIDGE_ENTRIES);

  return unique.map((evidence, index) => {
    const colonIndex = evidence.indexOf(':');
    const prefix = colonIndex > 0 ? evidence.slice(0, colonIndex) : 'graph';
    const recorder = resolveGraphEvidenceRecorder(prefix);
    return {
      id: `graph-evidence-${index}`,
      kind: 'fact',
      status: 'verified',
      recorder,
      title: prefix,
      content: evidence,
      dedupeKey: evidence.length > 120 ? evidence.slice(0, 120) : evidence,
      createdAt: now,
      updatedAt: now,
      tags: ['graph', 'goal-evidence'],
    };
  });
}

export function bridgeGraphGoalEvidence(
  evidenceStrings: ReadonlyArray<string>,
  options: GraphGoalEvidenceBridgeOptions,
): BridgeEvidenceResult {
  requireExactMemoryProvenanceId(
    options.sourceTurnId,
    'memory_graph_evidence_source_turn_id_invalid',
  );
  const entries = mapGraphGoalEvidenceToEntries(evidenceStrings, options.now);
  if (entries.length === 0) {
    return { bridged: [], skipped: [] };
  }
  return bridgeEvidenceToFacts(entries, options);
}
