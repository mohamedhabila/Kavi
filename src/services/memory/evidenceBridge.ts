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

import type { AgentRunEvidenceEntry } from '../../types';
import { recordFact, type RecordFactResult } from './facts';
import { upsertEntity, type EntityType } from './entities';
import { ensureFactSchema } from './schema';

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
  /** Optional now override (testing). */
  now?: number;
}

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
    return merged.length > 200 ? `${merged.slice(0, 199).trimEnd()}\u2026` : merged;
  }
  const value = (title || content || '').trim();
  return value.length > 200 ? `${value.slice(0, 199).trimEnd()}\u2026` : value;
}

/**
 * Bridge a list of evidence entries to bi-temporal facts.
 * Entries that fail validation are reported in `skipped` — never thrown.
 * Re-running with the same entries is a no-op (recordFact dedupes on hash).
 */
export function bridgeEvidenceToFacts(
  entries: ReadonlyArray<AgentRunEvidenceEntry>,
  options: EvidenceBridgeOptions = {},
): BridgeEvidenceResult {
  ensureFactSchema();

  const subjectName = options.subjectName?.trim() || options.defaultSubject?.name?.trim() || '';
  const subjectType: EntityType =
    options.subjectType ?? options.defaultSubject?.type ?? 'project';

  const bridged: RecordFactResult[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  if (!subjectName) {
    return {
      bridged,
      skipped: entries.map((e) => ({ id: e.id, reason: 'missing subject' })),
    };
  }

  let subjectId: string | null = null;

  for (const entry of entries) {
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

    if (subjectId === null) {
      subjectId = upsertEntity({
        name: subjectName,
        type: subjectType,
        now: options.now,
      }).id;
    }

    try {
      const result = recordFact({
        subjectId,
        predicate: buildPredicate(entry),
        objectText,
        confidence,
        ...(options.sourceRunId ? { sourceRunId: options.sourceRunId } : {}),
        now: options.now,
      });
      bridged.push(result);
    } catch (e) {
      skipped.push({
        id: entry.id,
        reason: e instanceof Error ? e.message : 'recordFact failed',
      });
    }
  }

  return { bridged, skipped };
}
