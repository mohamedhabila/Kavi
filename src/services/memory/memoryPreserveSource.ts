import { sha256HexUtf8 } from '../../utils/sha256';
import type { AuthorizedToolEffectExecutionClaim } from '../executionJournal/authorizedToolEffectExecutionClaim';
import { runMemoryTransaction } from './access/transaction';
import { upsertEntity } from './entities';
import { addFactEvidence } from './episodes/mutations';
import { MEMORY_FACT_CONTRIBUTION_LIMITS } from './factContributionCodec';
import type { MemoryFactSensitivity } from './facts/applicabilityProvenance';
import { recordFactWithContribution } from './facts/mutations';
import {
  isExactMemoryRememberExecutionClaim,
  isExactMemoryRememberRequestEvidence,
} from './memoryRememberExecutionAuthority';
import type { MemoryRememberRequestEvidence } from './memoryRememberPersistence';
import {
  classifyMemoryFactSensitivity,
  providerMemorySensitivityDeclaration,
} from './memorySensitivityPolicy';
import { isExactMemoryProvenanceId } from './memoryProvenanceIdentity';
import { canWriteLongTermMemory } from './policy';
import {
  PRESERVED_SOURCE_RECORD_VERSION,
  type PreservedSourceRecordV1,
} from './preservedSourceRecord';
import { ensureFactSchema } from './schema';

export { PRESERVED_SOURCE_RECORD_VERSION } from './preservedSourceRecord';
export const PRESERVED_SOURCE_TEXT_MAX_BYTES = 12 * 1024;
const PRESERVED_SOURCE_TITLE_MAX_CODE_POINTS = 120;
const PRESERVED_SOURCE_FACT_PRODUCER_ID = 'memory_preserve_source_v1';
const PRESERVED_SOURCE_PREDICATE = 'preserved_source';

type DeclaredSensitivity = 'normal' | 'personal' | 'sensitive' | 'restricted';

export interface MemoryPreserveSourceArgs {
  title: string;
  sensitivity: DeclaredSensitivity;
  pinned?: boolean;
}

export interface MemoryPreserveSourceExecutionContext {
  sourceRunId: string | null;
  requestEvidence: MemoryRememberRequestEvidence;
  executionClaim: AuthorizedToolEffectExecutionClaim;
}

export interface MemoryPreserveSourceError {
  status: 'rejected' | 'failed_unknown';
  ok: false;
  code:
    | 'invalid_args'
    | 'memory_disabled'
    | 'grounding_required'
    | 'permission_denied'
    | 'internal';
  error: string;
}

export interface MemoryPreserveSourceResult {
  ok: true;
  status: 'created' | 'duplicate';
  fact: {
    id: string;
    title: string;
    predicate: typeof PRESERVED_SOURCE_PREDICATE;
    scope: 'global';
    sensitivity: MemoryFactSensitivity;
    pinned: boolean;
    contentSha256: string;
    sourceByteLength: number;
  };
}

function error(
  code: MemoryPreserveSourceError['code'],
  message: string,
): MemoryPreserveSourceError {
  return {
    status: code === 'internal' ? 'failed_unknown' : 'rejected',
    ok: false,
    code,
    error: message,
  };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactTitle(value: unknown): string | null {
  if (typeof value !== 'string' || value !== value.trim() || value.length === 0) return null;
  return Array.from(value).length <= PRESERVED_SOURCE_TITLE_MAX_CODE_POINTS ? value : null;
}

function hasExactArgs(value: unknown): value is MemoryPreserveSourceArgs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const args = value as Record<string, unknown>;
  const allowed = new Set(['pinned', 'sensitivity', 'title']);
  return (
    Object.keys(args).every((key) => allowed.has(key)) &&
    exactTitle(args.title) !== null &&
    ['normal', 'personal', 'sensitive', 'restricted'].includes(String(args.sensitivity)) &&
    (args.pinned === undefined || typeof args.pinned === 'boolean')
  );
}

function producerEventId(claim: AuthorizedToolEffectExecutionClaim): string {
  return `memory_preserve_source_event_v1_${sha256HexUtf8(
    JSON.stringify(['memory-preserve-source-event-v1', claim.executionRunId, claim.toolCallId]),
  )}`;
}

export function executeMemoryPreserveSource(
  args: MemoryPreserveSourceArgs,
  context: MemoryPreserveSourceExecutionContext,
): MemoryPreserveSourceResult | MemoryPreserveSourceError {
  if (
    !context ||
    !isExactMemoryRememberExecutionClaim(context.executionClaim) ||
    !isExactMemoryRememberRequestEvidence(context.requestEvidence) ||
    (context.sourceRunId !== null && !isExactMemoryProvenanceId(context.sourceRunId))
  ) {
    return error('internal', 'memory_preserve_source execution authority invariant failed.');
  }
  if (!canWriteLongTermMemory()) {
    return error('memory_disabled', 'Long-term memory is disabled.');
  }
  if (!hasExactArgs(args)) {
    return error(
      'invalid_args',
      'memory_preserve_source requires only title, sensitivity, and optional pinned.',
    );
  }

  const title = exactTitle(args.title)!;
  const sourceText = context.requestEvidence.userMessageText;
  if (!sourceText.includes(title)) {
    return error(
      'grounding_required',
      'memory_preserve_source title must be copied exactly from the current user message.',
    );
  }
  const sourceBytes = utf8ByteLength(sourceText);
  if (sourceBytes === 0 || sourceBytes > PRESERVED_SOURCE_TEXT_MAX_BYTES) {
    return error(
      'invalid_args',
      `memory_preserve_source current user message must contain 1-${PRESERVED_SOURCE_TEXT_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  const record: PreservedSourceRecordV1 = {
    version: PRESERVED_SOURCE_RECORD_VERSION,
    title,
    content: sourceText,
    contentSha256: sha256HexUtf8(sourceText),
  };
  const objectText = JSON.stringify(record);
  if (utf8ByteLength(objectText) > MEMORY_FACT_CONTRIBUTION_LIMITS.textBytes) {
    return error(
      'invalid_args',
      `memory_preserve_source encoded source record must fit within ${MEMORY_FACT_CONTRIBUTION_LIMITS.textBytes} UTF-8 bytes.`,
    );
  }
  const sensitivityDeclaration = providerMemorySensitivityDeclaration(args.sensitivity);
  if (
    classifyMemoryFactSensitivity({
      declaredSensitivity: sensitivityDeclaration.sensitivity,
      subject: title,
      predicate: PRESERVED_SOURCE_PREDICATE,
      objectText,
    }) === 'restricted'
  ) {
    return error('permission_denied', 'Credentials and authentication secrets are not stored.');
  }

  try {
    ensureFactSchema();
    const now = context.executionClaim.claimedAt;
    const result = runMemoryTransaction(() => {
      const subject = upsertEntity({ name: title, type: 'thing', now });
      const recorded = recordFactWithContribution(
        {
          subjectId: subject.id,
          predicate: PRESERVED_SOURCE_PREDICATE,
          objectText,
          attributes: {
            preservedSource: {
              version: PRESERVED_SOURCE_RECORD_VERSION,
              contentSha256: record.contentSha256,
              sourceByteLength: sourceBytes,
            },
          },
          confidence: 1,
          sourceMessageId: context.requestEvidence.userMessageId,
          sourceRunId: context.sourceRunId,
          scope: 'global',
          originConversationId: null,
          originThreadId: null,
          originTaskId: null,
          sourceSummary: title,
          importance: 0.9,
          decayPolicy: args.pinned ? 'pinned' : 'slow',
          pinned: args.pinned ?? false,
          retrievability: 1,
          stability: 1,
          reviewState: 'verified',
          sensitivityFloor: sensitivityDeclaration.sensitivity,
          memoryKind: 'source',
          validAt: now,
          now,
        },
        {
          factClass: 'workflow',
          sourceAuthority: 'grounded_user',
        },
        {
          memoryConversationId: context.requestEvidence.memoryConversationId,
          sourceThreadId: context.requestEvidence.sourceThreadId,
          taskId: context.requestEvidence.taskId,
          producer: {
            producerId: PRESERVED_SOURCE_FACT_PRODUCER_ID,
            producerEventId: producerEventId(context.executionClaim),
          },
          sourceAliases: [
            {
              sourceKind: 'message',
              sourceId: context.requestEvidence.userMessageId,
            },
            ...(context.sourceRunId
              ? [{ sourceKind: 'run' as const, sourceId: context.sourceRunId }]
              : []),
          ],
        },
        sensitivityDeclaration,
      );
      addFactEvidence({
        factId: recorded.fact.id,
        messageId: context.requestEvidence.userMessageId,
        role: 'user',
        quote: title,
        now,
      });
      return recorded;
    });
    return {
      ok: true,
      status: result.status,
      fact: {
        id: result.fact.id,
        title,
        predicate: PRESERVED_SOURCE_PREDICATE,
        scope: 'global',
        sensitivity: result.fact.sensitivity,
        pinned: result.fact.pinned,
        contentSha256: record.contentSha256,
        sourceByteLength: sourceBytes,
      },
    };
  } catch (cause) {
    return error(
      'internal',
      cause instanceof Error ? cause.message : 'memory_preserve_source failed.',
    );
  }
}
