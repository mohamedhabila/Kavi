import type { AuthorizedEpisodeOrigin } from './episodes/accessPolicyTypes';
import type { MemoryFactKind } from './facts/types';

export const LOCAL_EVIDENCE_EXPANSION_LIMITS = Object.freeze({
  selectedSources: 12,
  candidatesPerSource: 32,
  evidencePerSource: 6,
  evidenceItems: 24,
  promptChars: 3_200,
  identifierChars: 160,
  predicateChars: 96,
  statementChars: 360,
  quoteChars: 320,
  episodeSummaryChars: 240,
});

export type LocalEvidenceSource =
  | { kind: 'fact'; factId: string }
  | { kind: 'episode'; episodeId: string }
  | { kind: 'run'; sourceRunId: string };

export interface LocalEvidenceExpansionScope {
  memoryConversationId: string;
  sourceThreadId: string;
}

type CurrentThreadLocalEvidenceSource = Exclude<LocalEvidenceSource, { kind: 'episode' }> &
  LocalEvidenceExpansionScope & {
    lane: 'current_thread';
    authorizedOrigin: null;
  };

export type ScopedLocalEvidenceSource =
  | CurrentThreadLocalEvidenceSource
  | (Extract<LocalEvidenceSource, { kind: 'episode' }> &
      LocalEvidenceExpansionScope & {
        lane: 'current_thread' | 'cross_thread';
        authorizedOrigin: AuthorizedEpisodeOrigin;
        policyExpiresAt: number | null;
        accessDecision: Readonly<{ authorized: true; reason: 'eligible' }>;
        relevanceScore: number;
      });

export interface ExpandLocalEvidenceInput {
  currentScope: import('./memoryScopeIdentity').MemoryAccessScopeIdentity;
  selectedSources: ReadonlyArray<ScopedLocalEvidenceSource>;
  /** Bi-temporal read boundary. Defaults to the current wall clock. */
  asOf?: number;
  /** May reduce, but never increase, the frozen expansion prompt budget. */
  promptBudgetChars?: number;
}

export interface ExpandedLocalEvidenceItem {
  kind: 'fact_evidence' | 'episode_fact' | 'run_fact';
  source: {
    kind: LocalEvidenceSource['kind'];
    id: string;
  };
  order: {
    source: number;
    neighborhood: number;
    observedAt: number;
    stateIndex: number | null;
    sequence: number | null;
  };
  provenance: {
    evidenceId: string | null;
    factId: string;
    episodeId: string | null;
    messageId: string | null;
    sourceRunId: string | null;
    actor: {
      role: 'user' | 'assistant' | 'tool' | 'system' | 'unknown';
      sourceActorId: string | null;
    };
  };
  factKind: MemoryFactKind;
  predicate: string;
  statement: string | null;
  quote: string | null;
  episodeSummary: string | null;
  conflict: {
    state: 'none' | 'observed';
    lastConflictedAt: number | null;
  };
  truncated: boolean;
}

/** Counts and timings only. It is safe to attach this object to diagnostics. */
export interface LocalEvidenceExpansionDiagnostics {
  requestedSourceCount: number;
  acceptedSourceCount: number;
  rejectedSourceCount: number;
  duplicateSourceCount: number;
  sourceLimitDroppedCount: number;
  sourceWithEvidenceCount: number;
  candidateCount: number;
  rejectedCandidateCount: number;
  sourceCandidateCapHitCount: number;
  sourceEvidenceCapDroppedCount: number;
  globalCapacityDroppedCount: number;
  promptBudgetDroppedCount: number;
  emittedEvidenceCount: number;
  queryCount: number;
  promptChars: number;
  durationMs: number;
}

export interface LocalEvidenceExpansionResult {
  evidence: ExpandedLocalEvidenceItem[];
  /** Exact JSON rendering of `evidence`; its length is bounded by `promptChars`. */
  promptPayload: string;
  diagnostics: LocalEvidenceExpansionDiagnostics;
}
