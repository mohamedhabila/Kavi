import { executeBuiltinMemoryTool } from '../../engine/tools/toolBuiltinMemoryExecution';
import { createConversationFileContext } from '../../engine/tools/toolWorkspaceFiles';
import { getFactById } from '../../services/memory/facts/queries';
import type { MemoryFact } from '../../services/memory/facts/types';
import type { MemoryRememberArgs } from '../../services/memory/memoryTools';
import { isCanonicalSelfMemorySubject } from '../../services/memory/memorySubjectIdentity';
import {
  validateE2EOracleEvidenceDeclaration,
  type E2EOracleEvidenceDeclaration,
} from './e2ePairedConditions';
import { stableHash, stableStringify } from './e2eTraceRedaction';
import type { AuthorizedToolEffectExecutionClaim } from '../../services/executionJournal/authorizedToolEffectExecutionClaim';
import { requireExactMemoryProvenanceId } from '../../services/memory/memoryProvenanceIdentity';
import { generateId } from '../../utils/id';

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
}) => Promise<string | null>;

type OraclePersistedFactReader = (factId: string) => MemoryFact | null | undefined;

function buildIsolatedOracleFact(fact: Readonly<MemoryRememberArgs>): MemoryRememberArgs {
  return {
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
    ...(fact.subjectType !== undefined ? { subjectType: fact.subjectType } : {}),
    ...(fact.confidence !== undefined ? { confidence: fact.confidence } : {}),
    ...(fact.pinned !== undefined ? { pinned: fact.pinned } : {}),
    ...(fact.importance !== undefined ? { importance: fact.importance } : {}),
    scope: 'conversation',
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
  fact: Readonly<MemoryRememberArgs>,
  index: number,
): OracleUserEvidence {
  const predicateUnits = Array.from(
    fact.predicate.normalize('NFKC').matchAll(/[\p{L}\p{M}\p{N}]+/gu),
    (match) => match[0],
  );
  if (predicateUnits.length === 0)
    throw new Error(`Oracle memory_remember fact ${index} has no predicate units.`);
  const predicateLabel = predicateUnits.join(' ');
  const predicateHead = predicateUnits.at(-1)!;
  const canonical = stableStringify({
    index,
    subject: fact.subject,
    predicate: fact.predicate,
    value: fact.value,
  });
  return {
    messageId: `e2e-oracle-evidence-${stableHash(canonical).slice('sha256:'.length)}`,
    text: isCanonicalSelfMemorySubject(fact.subject)
      ? `My ${predicateLabel} is ${fact.value}.`
      : `${fact.subject} ${predicateHead} is ${fact.value}.`,
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
  rawResult: string | null,
  identity: { conversationId: string; workspaceConversationId: string },
  userEvidence: OracleUserEvidence,
  index: number,
): string {
  if (rawResult === null) {
    throw new Error(`Oracle memory_remember fact ${index} was not handled by the product tool.`);
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(rawResult) as unknown;
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
  expected: Readonly<MemoryRememberArgs>,
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
    fact.factClass !== 'subjective_user' ||
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
    const executionClaim = buildOracleExecutionClaim(
      userEvidence,
      index,
      seedRunId,
      baseClaimedAt,
    );
    const rawResult = await executeTool({
      name: 'memory_remember',
      args: buildIsolatedOracleFact(fact),
      userEvidence,
      executionClaim,
      ...identity,
    });
    const factId = validateSeedResult(rawResult, identity, userEvidence, index);
    validatePersistedSeed(readPersistedFact(factId), fact, identity, userEvidence, index);
    seededFactIds.push(factId);
  }
  return { seededFactCount: input.declaration.facts.length, seededFactIds };
}
