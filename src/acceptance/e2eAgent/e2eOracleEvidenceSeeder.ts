import { executeBuiltinMemoryTool } from '../../engine/tools/toolBuiltinMemoryExecution';
import { createConversationFileContext } from '../../engine/tools/toolWorkspaceFiles';
import { getFactById } from '../../services/memory/facts/queries';
import type { MemoryFact } from '../../services/memory/facts/types';
import type { MemoryRememberArgs } from '../../services/memory/memoryTools';
import {
  validateE2EOracleEvidenceDeclaration,
  type E2EOracleEvidenceDeclaration,
} from './e2ePairedConditions';
import { stableStringify } from './e2eTraceRedaction';

type OracleMemoryToolExecutor = (params: {
  name: 'memory_remember';
  args: MemoryRememberArgs;
  conversationId: string;
  workspaceConversationId: string;
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
  });

function validateSeedResult(
  rawResult: string | null,
  identity: { conversationId: string; workspaceConversationId: string },
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
    fact.sourceMessageId !== null
  ) {
    throw new Error(`Oracle memory_remember fact ${index} escaped its isolated runtime scope.`);
  }
  return fact.id;
}

function validatePersistedSeed(
  fact: MemoryFact | null | undefined,
  identity: { conversationId: string; workspaceConversationId: string },
  index: number,
): void {
  if (
    !fact ||
    fact.scope !== 'conversation' ||
    fact.originConversationId !== identity.workspaceConversationId ||
    fact.originThreadId !== identity.conversationId ||
    fact.originTaskId !== null ||
    fact.sourceMessageId !== null ||
    fact.sourceRunId !== null ||
    fact.sourceTurnId !== null ||
    fact.sourceSummary !== null
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
}): Promise<{ seededFactCount: number }> {
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
  for (const [index, fact] of input.declaration.facts.entries()) {
    const rawResult = await executeTool({
      name: 'memory_remember',
      args: buildIsolatedOracleFact(fact),
      ...identity,
    });
    const factId = validateSeedResult(rawResult, identity, index);
    validatePersistedSeed(readPersistedFact(factId), identity, index);
  }
  return { seededFactCount: input.declaration.facts.length };
}
