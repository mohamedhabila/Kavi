import { executeBuiltinMemoryTool } from '../../engine/tools/toolBuiltinMemoryExecution';
import { createConversationFileContext } from '../../engine/tools/toolWorkspaceFiles';
import { getFactById } from '../../services/memory/facts/queries';
import type { MemoryFact } from '../../services/memory/facts/types';
import type { MemoryRememberArgs } from '../../services/memory/memoryTools';
import { isCanonicalSelfMemorySubject } from '../../services/memory/memorySubjectIdentity';
import {
  validateE2EOracleEvidenceDeclaration,
  type E2EOracleFactDeclaration,
  type E2EOracleEvidenceDeclaration,
} from './e2ePairedConditions';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { AuthorizedToolEffectExecutionClaim } from '../../services/executionJournal/authorizedToolEffectExecutionClaim';
import { requireExactMemoryProvenanceId } from '../../services/memory/memoryProvenanceIdentity';
import { generateId } from '../../utils/id';
import type { ToolRuntimeOutcome } from '../../types/toolRuntimeOutcome';

type OracleUserEvidence = Readonly<{
  messageId: string;
  text: string;
}>;

type OracleMemoryToolExecutor = (params: {
  name: 'memory_remember';
  args: MemoryRememberArgs;
  conversationId: string;
  workspaceConversationId: string;
  userEvidence: OracleUserEvidence;
  executionClaim: AuthorizedToolEffectExecutionClaim;
}) => Promise<ToolRuntimeOutcome | null>;

type OraclePersistedFactReader = (factId: string) => MemoryFact | null | undefined;

function buildIsolatedOracleFact(
  fact: Readonly<E2EOracleFactDeclaration>,
  userEvidence: OracleUserEvidence,
): MemoryRememberArgs {
  const selfSubject = isCanonicalSelfMemorySubject(fact.subject);
  return {
    semanticEvidence: {
      version: 1,
      subject_ref: selfSubject ? { kind: 'self' } : { kind: 'named', label: fact.subject },
      subject_type: selfSubject ? 'self' : (fact.subjectType ?? 'concept'),
      predicate: fact.predicate,
      value: fact.value,
      scope: 'conversation',
      importance: fact.importance ?? 0.5,
      confidence: fact.confidence ?? 0.9,
      source_message_id: userEvidence.messageId,
      operation: 'record',
      assertion_class: 'current_direct',
      evidence_quote: userEvidence.text,
      sensitivity: 'normal',
      subject_quote: selfSubject ? '⟦self⟧' : fact.subject,
      predicate_quote: fact.predicate,
      value_quote: fact.value,
    },
    ...(fact.pinned !== undefined ? { pinned: fact.pinned } : {}),
  };
}

const executeProductMemoryTool: OracleMemoryToolExecutor = async (params) =>
  executeBuiltinMemoryTool({
    ...params,
    conversationFileContext: createConversationFileContext(params.workspaceConversationId),
    context: {
      memoryConversationId: params.workspaceConversationId,
      currentUserMessage: {
        id: params.userEvidence.messageId,
        text: params.userEvidence.text,
      },
    },
    authorizedEffectExecutionClaim: params.executionClaim,
  });

function buildOracleUserEvidence(
  fact: Readonly<E2EOracleFactDeclaration>,
  index: number,
): OracleUserEvidence {
  const canonical = stableStringify({
    index,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
  });
  return {
    messageId: `e2e-oracle-evidence-${stableHash(canonical).slice('sha256:'.length)}`,
    text: `${isCanonicalSelfMemorySubject(fact.subject) ? '⟦self⟧' : fact.subject}\n${fact.predicate}\n${fact.value}`,
  };
}

function buildOracleExecutionClaim(
  userEvidence: OracleUserEvidence,
  index: number,
  seedRunId: string,
  baseClaimedAt: number,
): AuthorizedToolEffectExecutionClaim {
  const claimedAt = baseClaimedAt + index;
  const executionDigest = stableHash(
    stableStringify({ domain: 'e2e-oracle-seed-run-v1', seedRunId }),
  ).slice('sha256:'.length);
  const toolCallDigest = stableHash(
    stableStringify({
      domain: 'e2e-oracle-seed-tool-call-v1',
      index,
      messageId: userEvidence.messageId,
      seedRunId,
      text: userEvidence.text,
    }),
  ).slice('sha256:'.length);
  return Object.freeze({
    executionRunId: `e2e-oracle-execution-${executionDigest}`,
    toolCallId: `e2e-oracle-tool-call-${toolCallDigest}`,
    claimedAt,
  });
}

function validateSeedResult(
  outcome: ToolRuntimeOutcome | null,
  identity: { conversationId: string; workspaceConversationId: string },
  userEvidence: OracleUserEvidence,
  index: number,
): string {
  if (outcome === null) {
    throw new Error(`Oracle memory_remember fact ${index} was not handled by the product tool.`);
  }
  if (outcome.status === 'failed') {
    throw new Error(`Oracle memory_remember fact ${index} failed at the product tool boundary.`);
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(outcome.content) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object');
    parsed = value as Record<string, unknown>;
  } catch {
    throw new Error(`Oracle memory_remember fact ${index} returned malformed JSON.`);
  }
  if (parsed.ok !== true || !parsed.fact || typeof parsed.fact !== 'object') {
    throw new Error(`Oracle memory_remember fact ${index} failed at the product tool boundary.`);
  }
  const fact = parsed.fact as Record<string, unknown>;
  if (
    typeof fact.id !== 'string' ||
    fact.scope !== 'conversation' ||
    fact.originConversationId !== identity.workspaceConversationId ||
    fact.originThreadId !== identity.conversationId ||
    fact.originTaskId !== null ||
    fact.sourceMessageId !== userEvidence.messageId
  ) {
    throw new Error(`Oracle memory_remember fact ${index} escaped its isolated runtime scope.`);
  }
  return fact.id;
}

function validatePersistedSeed(
  fact: MemoryFact | null | undefined,
  expected: Readonly<E2EOracleFactDeclaration>,
  identity: { conversationId: string; workspaceConversationId: string },
  userEvidence: OracleUserEvidence,
  index: number,
): void {
  if (
    !fact ||
    fact.scope !== 'conversation' ||
    fact.originConversationId !== identity.workspaceConversationId ||
    fact.originThreadId !== identity.conversationId ||
    fact.originTaskId !== null ||
    fact.sourceMessageId !== userEvidence.messageId ||
    fact.sourceRunId !== null ||
    fact.sourceTurnId !== null ||
    fact.sourceSummary !== null ||
    fact.predicate !== expected.predicate ||
    fact.objectText !== expected.value ||
    fact.factClass !==
      (isCanonicalSelfMemorySubject(expected.subject) ? 'subjective_user' : 'objective') ||
    fact.sourceAuthority !== 'grounded_user'
  ) {
    throw new Error(`Oracle memory_remember fact ${index} persisted untrusted provenance.`);
  }
}

export async function seedE2EOracleEvidence(input: {
  declaration: E2EOracleEvidenceDeclaration;
  conversationId: string;
  workspaceConversationId: string;
  executeTool?: OracleMemoryToolExecutor;
  readPersistedFact?: OraclePersistedFactReader;
  /** Code-owned seed clock. Tests may inject one deterministic base timestamp. */
  claimedAt?: number;
  /** One code-owned seed invocation identity. Tests may inject it for exact replay. */
  seedRunId?: string;
}): Promise<{ seededFactCount: number; seededFactIds: string[] }> {
  const canonicalDeclaration = validateE2EOracleEvidenceDeclaration(input.declaration);
  if (stableStringify(input.declaration) !== stableStringify(canonicalDeclaration)) {
    throw new Error('Oracle seeding requires a canonical memory_remember declaration.');
  }
  const identity = {
    conversationId: input.conversationId,
    workspaceConversationId: input.workspaceConversationId,
  };
  const executeTool = input.executeTool ?? executeProductMemoryTool;
  const readPersistedFact = input.readPersistedFact ?? getFactById;
  const seedRunId = requireExactMemoryProvenanceId(
    input.seedRunId ?? `e2e-oracle-seed-run-${generateId()}`,
    'e2e_oracle_seed_run_id_invalid',
  );
  const baseClaimedAt = input.claimedAt ?? Date.now();
  if (
    !Number.isSafeInteger(baseClaimedAt) ||
    baseClaimedAt < 0 ||
    baseClaimedAt + input.declaration.facts.length - 1 > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('Oracle seeding requires a valid code-owned seed timestamp.');
  }
  const seededFactIds: string[] = [];
  for (const [index, fact] of input.declaration.facts.entries()) {
    const userEvidence = buildOracleUserEvidence(fact, index);
    const executionClaim = buildOracleExecutionClaim(userEvidence, index, seedRunId, baseClaimedAt);
    const outcome = await executeTool({
      name: 'memory_remember',
      args: buildIsolatedOracleFact(fact, userEvidence),
      userEvidence,
      executionClaim,
      ...identity,
    });
    const factId = validateSeedResult(outcome, identity, userEvidence, index);
    validatePersistedSeed(readPersistedFact(factId), fact, identity, userEvidence, index);
    seededFactIds.push(factId);
  }
  return { seededFactCount: input.declaration.facts.length, seededFactIds };
}
