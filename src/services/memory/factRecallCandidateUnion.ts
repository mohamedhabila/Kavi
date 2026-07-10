import type { MemoryFact } from './facts/types';
import {
  RECALL_CANDIDATE_LIMITS,
  RECALL_CANDIDATE_REASON_CODES,
  type RecallCandidateProvenance,
  type RecallCandidateReasonCode,
} from './factRecallCandidateContract';

export interface RecallCandidateLaneEntry {
  fact: MemoryFact;
  semanticSimilarity?: number;
}

export interface RecallCandidateLane {
  reason: RecallCandidateReasonCode;
  entries: ReadonlyArray<RecallCandidateLaneEntry>;
}

export interface FusedRecallCandidate {
  fact: MemoryFact;
  provenance: RecallCandidateProvenance;
}

const LANE_WEIGHTS: Readonly<Record<RecallCandidateReasonCode, number>> = Object.freeze({
  pinned: 1.5,
  exact_quoted: 1.4,
  lexical: 1,
  entity: 1.1,
  temporal: 0.65,
  local_semantic: 1.05,
});

function laneLimit(reason: RecallCandidateReasonCode): number {
  if (reason === 'pinned') return RECALL_CANDIDATE_LIMITS.pinnedLane;
  if (reason === 'exact_quoted') return RECALL_CANDIDATE_LIMITS.exactQuotedLane;
  if (reason === 'entity') return RECALL_CANDIDATE_LIMITS.entityLane;
  if (reason === 'temporal') return RECALL_CANDIDATE_LIMITS.temporalLane;
  if (reason === 'local_semantic') return RECALL_CANDIDATE_LIMITS.localSemanticLane;
  return RECALL_CANDIDATE_LIMITS.maximumUnion;
}

export function recallCandidateDiversityKey(fact: MemoryFact): string {
  const sourceRunId = fact.sourceRunId?.trim();
  if (sourceRunId) return `run:${sourceRunId}`;
  const taskId = fact.originTaskId?.trim() || fact.taskId?.trim();
  if (taskId) return `task:${taskId}`;
  const turnId = fact.sourceTurnId?.trim();
  if (turnId) return `turn:${turnId}`;
  const conversationId = fact.originConversationId?.trim() || fact.originThreadId?.trim();
  if (conversationId) {
    return `conversation:${conversationId}:${fact.memoryKind}:${fact.subjectId}:${fact.predicate}`;
  }
  return `fact:${fact.memoryKind}:${fact.subjectId}:${fact.predicate}`;
}

function orderedReasons(
  reasons: ReadonlySet<RecallCandidateReasonCode>,
): RecallCandidateReasonCode[] {
  return RECALL_CANDIDATE_REASON_CODES.filter((reason) => reasons.has(reason));
}

export function fuseRecallCandidateLanes(
  lanes: ReadonlyArray<RecallCandidateLane>,
  requestedLimit: number,
): { candidates: FusedRecallCandidate[]; unionCount: number; diversifiedCount: number } {
  if (!Number.isFinite(requestedLimit) || requestedLimit < 0) {
    throw new RangeError('Recall candidate union limit must be a finite non-negative number.');
  }
  const limit = Math.min(Math.floor(requestedLimit), RECALL_CANDIDATE_LIMITS.maximumUnion);
  if (limit === 0) return { candidates: [], unionCount: 0, diversifiedCount: 0 };
  const seenReasons = new Set<RecallCandidateReasonCode>();
  for (const lane of lanes) {
    if (!RECALL_CANDIDATE_REASON_CODES.includes(lane.reason) || seenReasons.has(lane.reason)) {
      throw new Error('Recall candidate lanes must use unique closed reason codes.');
    }
    seenReasons.add(lane.reason);
  }
  const byId = new Map<
    string,
    {
      fact: MemoryFact;
      rawScore: number;
      reasons: Set<RecallCandidateReasonCode>;
      semanticSimilarity: number | null;
    }
  >();
  for (const lane of lanes) {
    const boundedEntries = lane.entries.slice(0, laneLimit(lane.reason));
    const seenLaneIds = new Set<string>();
    for (let rank = 0; rank < boundedEntries.length; rank += 1) {
      const entry = boundedEntries[rank];
      if (!entry || seenLaneIds.has(entry.fact.id)) continue;
      seenLaneIds.add(entry.fact.id);
      const current = byId.get(entry.fact.id) ?? {
        fact: entry.fact,
        rawScore: 0,
        reasons: new Set<RecallCandidateReasonCode>(),
        semanticSimilarity: null,
      };
      current.rawScore +=
        LANE_WEIGHTS[lane.reason] / (RECALL_CANDIDATE_LIMITS.reciprocalRankConstant + rank + 1);
      current.reasons.add(lane.reason);
      if (
        typeof entry.semanticSimilarity === 'number' &&
        Number.isFinite(entry.semanticSimilarity)
      ) {
        current.semanticSimilarity = Math.max(
          current.semanticSimilarity ?? -1,
          entry.semanticSimilarity,
        );
      }
      byId.set(entry.fact.id, current);
    }
  }

  const maxRawScore = Math.max(0, ...Array.from(byId.values(), (entry) => entry.rawScore));
  const ranked = Array.from(byId.values())
    .sort((left, right) => {
      if (right.rawScore !== left.rawScore) return right.rawScore - left.rawScore;
      if (right.fact.updatedAt !== left.fact.updatedAt) {
        return right.fact.updatedAt - left.fact.updatedAt;
      }
      return left.fact.id.localeCompare(right.fact.id);
    })
    .map<FusedRecallCandidate>((entry) => ({
      fact: entry.fact,
      provenance: {
        reasons: orderedReasons(entry.reasons),
        fusionScore: maxRawScore > 0 ? entry.rawScore / maxRawScore : 0,
        semanticSimilarity: entry.semanticSimilarity,
      },
    }));

  const selected: FusedRecallCandidate[] = [];
  const selectedIds = new Set<string>();
  const diversityKeys = new Set<string>();
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    const diversityKey = recallCandidateDiversityKey(candidate.fact);
    if (diversityKeys.has(diversityKey)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.fact.id);
    diversityKeys.add(diversityKey);
  }
  const diversifiedCount = selected.length;
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.fact.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.fact.id);
  }
  return { candidates: selected, unionCount: ranked.length, diversifiedCount };
}
