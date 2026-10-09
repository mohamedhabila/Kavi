// ---------------------------------------------------------------------------
// Kavi — memory_remember tool executor
// ---------------------------------------------------------------------------
// Records one fact the user stated, bound to exact code-owned evidence: a user message
// of the current turn or a successful read this run observed.
// ---------------------------------------------------------------------------

import type { AuthorizedToolEffectExecutionClaim } from '../executionJournal/authorizedToolEffectExecutionClaim';
import { serializeMemoryFact } from './memoryFactSerialization';
import {
  isExactMemoryRememberExecutionClaim,
  isExactMemoryRememberRequestEvidence,
  listMemoryRememberUserStatements,
} from './memoryRememberExecutionAuthority';
import {
  persistMemoryRemember,
  type MemoryRememberRequestEvidence,
} from './memoryRememberPersistence';
import { bindMemoryRememberSemanticEvidence } from './memoryRememberSemanticEvidence';
import type { MemoryRememberResult, MemorySupersessionReceipt } from './memoryToolResultTypes';
import { memoryToolError as err, type MemoryToolError } from './memoryToolError';
import {
  buildPredicateIdentityCorrection,
  findUserSuppliedPredicateIdentity,
} from './predicateIdentityPreservation';
import { canWriteLongTermMemory } from './policy';
import { ensureFactSchema } from './schema';

function serializeSupersessionReceipt(fact: {
  id: string;
  invalidAt: number | null;
}): MemorySupersessionReceipt {
  if (!Number.isFinite(fact.invalidAt)) throw new Error('memory_supersession_receipt_invalid');
  return { id: fact.id, invalidAt: fact.invalidAt! };
}

export interface MemoryRememberArgs {
  semanticEvidence: unknown;
  pinned?: boolean;
}

export interface MemoryRememberExecutionContext {
  /** Code-owned persona identity; never accepted from provider tool arguments. */
  personaId?: string;
  /** Code-owned producer run identity; never accepted from provider tool arguments. */
  sourceRunId: string | null;
  /** Exact code-owned request evidence; never accepted from provider tool arguments. */
  requestEvidence: MemoryRememberRequestEvidence;
  /** Opaque current-run authorities for exact successful code-owned read results. */
  toolObservedEvidence?: ReadonlyArray<
    import('./toolObservedMemoryEvidence').ToolObservedMemoryEvidenceCapability
  >;
  /** Persisted effect authority; never accepted from provider tool arguments. */
  executionClaim: AuthorizedToolEffectExecutionClaim;
}

function memoryRememberGroundingError(reason: string): string {
  switch (reason) {
    case 'session_identity_unavailable':
      return 'session_identity_unavailable: memory_remember scope=session requires an active user task identity. Keep the exact subject unchanged and retry with the durability scope the user intended; use global when the user requested durable memory without a narrower context.';
    case 'persona_identity_unavailable':
      return 'persona_identity_unavailable: memory_remember scope=persona requires an active persona identity. Keep the exact subject unchanged and use global unless the user intentionally limited the fact to one persona.';
    case 'project_identity_unavailable':
      return 'project_identity_unavailable: memory_remember scope=project requires an active project identity. Keep the exact subject unchanged and choose a scope supported by the current context.';
    case 'conversation_identity_unavailable':
      return 'conversation_identity_unavailable: memory_remember scope=conversation requires the current conversation identity. Keep the exact subject unchanged and retry only after the conversation scope is available.';
    case 'operation_mismatch':
      return 'operation_mismatch: memory_remember operation does not match the current fact state for this exact subject, predicate, and scope. Use record for no current fact and replace_current for exactly one current fact.';
    case 'no_compatible_current_fact':
      return 'no_compatible_current_fact: memory_remember found current state under a different scope. Do not create a conflicting duplicate; recall the exact fact state and preserve its intended scope before retrying.';
    case 'ambiguous_current_fact':
      return 'ambiguous_current_fact: memory_remember found more than one compatible current fact. Resolve the stored conflict before changing it.';
    default:
      return `memory_remember could not bind this write to exact current-user evidence (${reason}).`;
  }
}

export function executeMemoryRemember(
  args: MemoryRememberArgs,
  context: MemoryRememberExecutionContext,
): MemoryRememberResult | MemoryToolError {
  if (
    !context ||
    !isExactMemoryRememberExecutionClaim(context.executionClaim) ||
    !isExactMemoryRememberRequestEvidence(context.requestEvidence)
  ) {
    return err('internal', 'memory_remember execution authority invariant failed.');
  }
  if (!canWriteLongTermMemory()) return err('memory_disabled', 'Long-term memory is disabled.');
  ensureFactSchema();
  if (
    !args ||
    typeof args !== 'object' ||
    Array.isArray(args) ||
    Object.keys(args).some((key) => key !== 'semanticEvidence' && key !== 'pinned') ||
    !Object.prototype.hasOwnProperty.call(args, 'semanticEvidence')
  ) {
    return err(
      'invalid_args',
      'memory_remember requires only semanticEvidence and optional pinned.',
    );
  }
  if (args.pinned !== undefined && typeof args.pinned !== 'boolean') {
    return err('invalid_args', 'pinned must be a boolean');
  }
  // Subject and value are already required to be copied exactly from the current user
  // message. The predicate — the name the fact is filed and later recalled under — had
  // no such grounding, so a caller could decorate an identifier the user wrote and store
  // the fact where that name would never find it. The write reported success and the
  // loss only surfaced at recall.
  const suppliedPredicate = (args.semanticEvidence as { predicate?: unknown } | undefined)
    ?.predicate;
  if (typeof suppliedPredicate === 'string') {
    const userSuppliedPredicateIdentity = findUserSuppliedPredicateIdentity({
      predicate: suppliedPredicate,
      userMessageText: listMemoryRememberUserStatements(context.requestEvidence)
        .map((statement) => statement.text)
        .join('\n'),
    });
    if (userSuppliedPredicateIdentity) {
      return err(
        'grounding_required',
        buildPredicateIdentityCorrection({
          predicate: suppliedPredicate,
          userSuppliedIdentity: userSuppliedPredicateIdentity,
        }),
      );
    }
  }

  const semantic = bindMemoryRememberSemanticEvidence(
    args.semanticEvidence,
    context.requestEvidence,
    context.toolObservedEvidence,
  );
  if (!semantic.valid) {
    switch (semantic.code) {
      case 'invalid_contract':
        return err(
          'invalid_args',
          `memory_remember semanticEvidence does not match the declared schema: ${semantic.violations.join('; ')}.`,
        );
      case 'value_not_grounded':
        return err(
          'grounding_required',
          'memory_remember semanticEvidence.value must be the smallest atomic exact substring copied from the current user message; include only the current semantic object and exclude assertion/correction wording and superseded alternatives.',
        );
      case 'subject_not_grounded':
        return err(
          'grounding_required',
          'memory_remember named-subject labels must be copied exactly from the current user message; use subject.kind=self for the current user.',
        );
      case 'evidence_span_limit_exceeded':
        return err(
          'grounding_required',
          'memory_remember subject and value are too far apart in the current user message; record one smaller exact fact.',
        );
      case 'non_current_assertion':
        return err(
          'grounding_required',
          'memory_remember accepts current_direct only from the current user message and quoted only from one verified current-run read result.',
        );
      case 'tool_observation_named_subject_required':
        return err(
          'grounding_required',
          'A tool-observed memory fact requires one exact named subject from the verified result; tool results cannot establish a self fact.',
        );
      case 'tool_observation_replace_forbidden':
        return err(
          'grounding_required',
          'A tool-observed memory fact may only record new evidence; it cannot replace a current fact.',
        );
      case 'tool_observation_not_grounded':
        return err(
          'grounding_required',
          'The named subject and value must both appear exactly in one verified current-run read result.',
        );
      case 'tool_observation_ambiguous':
        return err(
          'grounding_required',
          'More than one verified current-run read result contains this subject and value; narrow the evidence before remembering it.',
        );
    }
  }

  try {
    const persisted = persistMemoryRemember(
      {
        semanticEvidence: semantic.evidence,
        ...(args.pinned !== undefined ? { pinned: args.pinned } : {}),
      },
      context,
    );
    if (persisted.status === 'grounding_required') {
      return err('grounding_required', memoryRememberGroundingError(persisted.reason));
    }
    if (persisted.status === 'restricted_content') {
      return err('permission_denied', 'Credentials and authentication secrets are not stored.');
    }
    if (persisted.status === 'conflict') {
      return err(
        'conflict',
        `memory_remember current fact changed (${persisted.conflict}); retry.`,
      );
    }
    const result = persisted.result;
    return {
      ok: true,
      fact: serializeMemoryFact(result.fact),
      status: result.status,
      superseded: result.superseded.map(serializeSupersessionReceipt),
    };
  } catch (e) {
    return err('internal', e instanceof Error ? e.message : 'memory_remember failed');
  }
}
