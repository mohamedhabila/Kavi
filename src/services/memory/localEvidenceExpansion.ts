import { normalizeFactKind, type MemoryFactKind } from './facts/types';
import { ensureFactSchema } from './schema';
import {
  listLocalEpisodeNeighborhood,
  listLocalFactNeighborhood,
  listLocalRunNeighborhood,
  type LocalEvidenceEdgeRow,
  type LocalRunFactRow,
} from './localEvidenceExpansionQueries';
import { boundLocalEvidenceText, compactLocalEvidenceStatement } from './localEvidenceText';
import {
  LOCAL_EVIDENCE_EXPANSION_LIMITS,
  type ExpandedLocalEvidenceItem,
  type ExpandLocalEvidenceInput,
  type LocalEvidenceExpansionDiagnostics,
  type LocalEvidenceExpansionResult,
  type LocalEvidenceSource,
} from './localEvidenceExpansionTypes';

type SelectedSource = {
  kind: LocalEvidenceSource['kind'];
  id: string;
  sourceIndex: number;
};

type ClosedEvidenceRole = ExpandedLocalEvidenceItem['provenance']['actor']['role'];

const IDENTIFIER_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function requireScopeId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  if (
    normalized.length > LOCAL_EVIDENCE_EXPANSION_LIMITS.identifierChars ||
    IDENTIFIER_CONTROL_CHARACTERS.test(normalized)
  ) {
    throw new Error(`${label} is not a valid bounded identifier.`);
  }
  return normalized;
}

function boundedIdentifier(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized &&
    normalized.length <= LOCAL_EVIDENCE_EXPANSION_LIMITS.identifierChars &&
    !IDENTIFIER_CONTROL_CHARACTERS.test(normalized)
    ? normalized
    : null;
}

function normalizedSource(value: unknown): Omit<SelectedSource, 'sourceIndex'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.kind === 'fact') {
    const id = boundedIdentifier(source.factId);
    return id ? { kind: 'fact', id } : null;
  }
  if (source.kind === 'episode') {
    const id = boundedIdentifier(source.episodeId);
    return id ? { kind: 'episode', id } : null;
  }
  if (source.kind === 'run') {
    const id = boundedIdentifier(source.sourceRunId);
    return id ? { kind: 'run', id } : null;
  }
  return null;
}

function normalizeSources(
  sources: ReadonlyArray<unknown>,
  diagnostics: LocalEvidenceExpansionDiagnostics,
): SelectedSource[] {
  const selected: SelectedSource[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const normalized = normalizedSource(source);
    if (!normalized) {
      diagnostics.rejectedSourceCount += 1;
      continue;
    }
    const key = `${normalized.kind}:${normalized.id}`;
    if (seen.has(key)) {
      diagnostics.duplicateSourceCount += 1;
      continue;
    }
    seen.add(key);
    if (selected.length >= LOCAL_EVIDENCE_EXPANSION_LIMITS.selectedSources) {
      diagnostics.sourceLimitDroppedCount += 1;
      continue;
    }
    selected.push({ ...normalized, sourceIndex: selected.length });
  }
  diagnostics.acceptedSourceCount = selected.length;
  return selected;
}

function safeOrderNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

function runOrder(row: LocalRunFactRow): { stateIndex: number | null; sequence: number | null } {
  try {
    const attributes = JSON.parse(row.attributes) as unknown;
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
      return { stateIndex: null, sequence: null };
    }
    const record = attributes as Record<string, unknown>;
    return {
      stateIndex: safeOrderNumber(record.stateIndex),
      sequence: safeOrderNumber(record.sequence),
    };
  } catch {
    return { stateIndex: null, sequence: null };
  }
}

function runKindOrder(kind: MemoryFactKind): number {
  if (kind === 'evidence_span') return 0;
  if (kind === 'agent_run') return 2;
  return 1;
}

function sortRunRows(rows: LocalRunFactRow[]): LocalRunFactRow[] {
  return [...rows].sort((left, right) => {
    const kindDelta =
      runKindOrder(normalizeFactKind(left.memoryKind)) -
      runKindOrder(normalizeFactKind(right.memoryKind));
    if (kindDelta !== 0) return kindDelta;
    const leftOrder = runOrder(left);
    const rightOrder = runOrder(right);
    const stateDelta =
      (leftOrder.stateIndex ?? Number.MAX_SAFE_INTEGER) -
      (rightOrder.stateIndex ?? Number.MAX_SAFE_INTEGER);
    if (stateDelta !== 0) return stateDelta;
    const sequenceDelta =
      (leftOrder.sequence ?? Number.MAX_SAFE_INTEGER) -
      (rightOrder.sequence ?? Number.MAX_SAFE_INTEGER);
    if (sequenceDelta !== 0) return sequenceDelta;
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.factId.localeCompare(right.factId);
  });
}

function closedRole(value: unknown): ClosedEvidenceRole {
  return value === 'user' || value === 'assistant' || value === 'tool' || value === 'system'
    ? value
    : 'unknown';
}

function actor(
  role: unknown,
  sourceActorId: unknown,
): ExpandedLocalEvidenceItem['provenance']['actor'] {
  return { role: closedRole(role), sourceActorId: boundedIdentifier(sourceActorId) };
}

function validOptionalIdentifier(value: unknown): boolean {
  return value === null || boundedIdentifier(value) !== null;
}

function conflictMarker(
  lastConflictedAt: number | null,
  asOf: number,
): ExpandedLocalEvidenceItem['conflict'] {
  const observed = lastConflictedAt !== null && lastConflictedAt <= asOf;
  return {
    state: observed ? 'observed' : 'none',
    lastConflictedAt: observed ? lastConflictedAt : null,
  };
}

function edgeItem(
  row: LocalEvidenceEdgeRow,
  source: SelectedSource,
  neighborhood: number,
  asOf: number,
): ExpandedLocalEvidenceItem | null {
  const evidenceId = boundedIdentifier(row.evidenceId);
  const factId = boundedIdentifier(row.factId);
  if (
    !evidenceId ||
    !factId ||
    !validOptionalIdentifier(row.episodeId) ||
    !validOptionalIdentifier(row.messageId) ||
    !validOptionalIdentifier(row.sourceRunId)
  ) {
    return null;
  }
  const factKind = normalizeFactKind(row.memoryKind);
  const predicate = boundLocalEvidenceText(
    row.predicate,
    LOCAL_EVIDENCE_EXPANSION_LIMITS.predicateChars,
  );
  const statement =
    source.kind === 'episode'
      ? compactLocalEvidenceStatement(
          factKind,
          row.objectText,
          LOCAL_EVIDENCE_EXPANSION_LIMITS.statementChars,
        )
      : { value: null, truncated: false };
  const quote = boundLocalEvidenceText(row.quote, LOCAL_EVIDENCE_EXPANSION_LIMITS.quoteChars);
  const episodeSummary = boundLocalEvidenceText(
    source.kind === 'fact' ? row.episodeSummary : null,
    LOCAL_EVIDENCE_EXPANSION_LIMITS.episodeSummaryChars,
  );
  if (!quote.value && !episodeSummary.value && !statement.value) return null;
  return {
    kind: source.kind === 'fact' ? 'fact_evidence' : 'episode_fact',
    source: { kind: source.kind, id: source.id },
    order: {
      source: source.sourceIndex,
      neighborhood,
      observedAt: row.evidenceCreatedAt,
      stateIndex: null,
      sequence: null,
    },
    provenance: {
      evidenceId,
      factId,
      episodeId: boundedIdentifier(row.episodeId),
      messageId: boundedIdentifier(row.messageId),
      sourceRunId: boundedIdentifier(row.sourceRunId),
      actor: actor(row.role, row.sourceActorId),
    },
    factKind,
    predicate: predicate.value ?? '',
    statement: statement.value,
    quote: quote.value,
    episodeSummary: episodeSummary.value,
    conflict: conflictMarker(row.lastConflictedAt, asOf),
    truncated:
      predicate.truncated || statement.truncated || quote.truncated || episodeSummary.truncated,
  };
}

function runItem(
  row: LocalRunFactRow,
  source: SelectedSource,
  neighborhood: number,
  asOf: number,
): ExpandedLocalEvidenceItem | null {
  const factId = boundedIdentifier(row.factId);
  const sourceRunId = boundedIdentifier(row.sourceRunId);
  if (!factId || !sourceRunId) return null;
  const factKind = normalizeFactKind(row.memoryKind);
  const predicate = boundLocalEvidenceText(
    row.predicate,
    LOCAL_EVIDENCE_EXPANSION_LIMITS.predicateChars,
  );
  const statement = compactLocalEvidenceStatement(
    factKind,
    row.objectText,
    LOCAL_EVIDENCE_EXPANSION_LIMITS.statementChars,
  );
  if (!statement.value) return null;
  const order = runOrder(row);
  return {
    kind: 'run_fact',
    source: { kind: source.kind, id: source.id },
    order: {
      source: source.sourceIndex,
      neighborhood,
      observedAt: row.createdAt,
      stateIndex: order.stateIndex,
      sequence: order.sequence,
    },
    provenance: {
      evidenceId: null,
      factId,
      episodeId: null,
      messageId: null,
      sourceRunId,
      actor: actor(null, row.sourceActorId),
    },
    factKind,
    predicate: predicate.value ?? '',
    statement: statement.value,
    quote: null,
    episodeSummary: null,
    conflict: conflictMarker(row.lastConflictedAt, asOf),
    truncated: predicate.truncated || statement.truncated,
  };
}

function emptyDiagnostics(requestedSourceCount: number): LocalEvidenceExpansionDiagnostics {
  return {
    requestedSourceCount,
    acceptedSourceCount: 0,
    rejectedSourceCount: 0,
    duplicateSourceCount: 0,
    sourceLimitDroppedCount: 0,
    sourceWithEvidenceCount: 0,
    candidateCount: 0,
    rejectedCandidateCount: 0,
    sourceCandidateCapHitCount: 0,
    sourceEvidenceCapDroppedCount: 0,
    globalCapacityDroppedCount: 0,
    promptBudgetDroppedCount: 0,
    emittedEvidenceCount: 0,
    queryCount: 0,
    promptChars: 2,
    durationMs: 0,
  };
}

function promptBudget(input: ExpandLocalEvidenceInput): number {
  const requested = input.promptBudgetChars;
  if (requested === undefined || !Number.isFinite(requested)) {
    return LOCAL_EVIDENCE_EXPANSION_LIMITS.promptChars;
  }
  return Math.max(2, Math.min(Math.floor(requested), LOCAL_EVIDENCE_EXPANSION_LIMITS.promptChars));
}

export function expandLocalEvidence(input: ExpandLocalEvidenceInput): LocalEvidenceExpansionResult {
  const startedAt = Date.now();
  const memoryConversationId = requireScopeId(
    input?.scope?.memoryConversationId,
    'memoryConversationId',
  );
  const sourceThreadId = requireScopeId(input?.scope?.sourceThreadId, 'sourceThreadId');
  const asOf = input.asOf ?? Date.now();
  if (!Number.isFinite(asOf) || asOf < 0) throw new Error('asOf must be a finite timestamp.');
  const sourceInputs: ReadonlyArray<unknown> = Array.isArray(input.selectedSources)
    ? input.selectedSources
    : [];
  const diagnostics = emptyDiagnostics(sourceInputs.length);
  const selectedSources = normalizeSources(sourceInputs, diagnostics);
  const candidates: ExpandedLocalEvidenceItem[] = [];
  ensureFactSchema();

  for (const source of selectedSources) {
    diagnostics.queryCount += 1;
    const rows =
      source.kind === 'fact'
        ? listLocalFactNeighborhood({
            factId: source.id,
            memoryConversationId,
            sourceThreadId,
            asOf,
          })
        : source.kind === 'episode'
          ? listLocalEpisodeNeighborhood({
              episodeId: source.id,
              memoryConversationId,
              sourceThreadId,
              asOf,
            })
          : sortRunRows(
              listLocalRunNeighborhood({
                sourceRunId: source.id,
                memoryConversationId,
                sourceThreadId,
                asOf,
              }),
            );
    if (rows.length > LOCAL_EVIDENCE_EXPANSION_LIMITS.candidatesPerSource) {
      diagnostics.sourceCandidateCapHitCount += 1;
    }
    const boundedRows = rows.slice(0, LOCAL_EVIDENCE_EXPANSION_LIMITS.candidatesPerSource);
    const sourceCandidates = boundedRows
      .map((row, index) =>
        source.kind === 'run'
          ? runItem(row as LocalRunFactRow, source, index, asOf)
          : edgeItem(row as LocalEvidenceEdgeRow, source, index, asOf),
      )
      .filter((item): item is ExpandedLocalEvidenceItem => item !== null);
    diagnostics.rejectedCandidateCount += boundedRows.length - sourceCandidates.length;
    diagnostics.candidateCount += sourceCandidates.length;
    if (sourceCandidates.length > 0) diagnostics.sourceWithEvidenceCount += 1;
    if (sourceCandidates.length > LOCAL_EVIDENCE_EXPANSION_LIMITS.evidencePerSource) {
      diagnostics.sourceEvidenceCapDroppedCount +=
        sourceCandidates.length - LOCAL_EVIDENCE_EXPANSION_LIMITS.evidencePerSource;
    }
    candidates.push(
      ...sourceCandidates.slice(0, LOCAL_EVIDENCE_EXPANSION_LIMITS.evidencePerSource),
    );
  }

  const evidence: ExpandedLocalEvidenceItem[] = [];
  const maxPromptChars = promptBudget(input);
  for (const candidate of candidates) {
    if (evidence.length >= LOCAL_EVIDENCE_EXPANSION_LIMITS.evidenceItems) {
      diagnostics.globalCapacityDroppedCount += 1;
      continue;
    }
    const trial = JSON.stringify([...evidence, candidate]);
    if (trial.length > maxPromptChars) {
      diagnostics.promptBudgetDroppedCount += 1;
      continue;
    }
    evidence.push(candidate);
  }

  const promptPayload = JSON.stringify(evidence);
  diagnostics.emittedEvidenceCount = evidence.length;
  diagnostics.promptChars = promptPayload.length;
  diagnostics.durationMs = Math.max(0, Date.now() - startedAt);
  return { evidence, promptPayload, diagnostics };
}
