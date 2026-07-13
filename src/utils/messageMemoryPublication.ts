import type {
  MessageMemoryPublication,
  MessageMemoryPublicationDisposition,
} from '../types/message';

const TERMINAL_DISPOSITIONS = new Set<MessageMemoryPublicationDisposition>([
  'enqueued',
  'opt_out',
  'ephemeral_thread',
  'withdrawn',
]);

export type TerminalMessageMemoryPublication = MessageMemoryPublication & {
  readonly disposition: Exclude<MessageMemoryPublicationDisposition, null>;
};

export type MessageMemoryPublicationTransitionResult =
  | Readonly<{
      applied: true;
      changed: boolean;
      publication: MessageMemoryPublication;
    }>
  | Readonly<{
      applied: false;
      changed: false;
      current: MessageMemoryPublication | undefined;
      requested: MessageMemoryPublication;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isDisposition(value: unknown): value is MessageMemoryPublicationDisposition {
  return value === null || TERMINAL_DISPOSITIONS.has(value as MessageMemoryPublicationDisposition);
}

/**
 * Decodes persisted publication state and deliberately returns only contract-owned fields.
 * Invalid or incomplete values are not interpreted as an open publication obligation.
 */
export function normalizeMessageMemoryPublication(
  value: unknown,
): MessageMemoryPublication | undefined {
  if (
    !isRecord(value) ||
    !hasOwn(value, 'version') ||
    !hasOwn(value, 'disposition') ||
    value.version !== 1 ||
    !isDisposition(value.disposition)
  ) {
    return undefined;
  }

  return {
    version: 1,
    disposition: value.disposition,
  };
}

export function isMessageMemoryPublication(value: unknown): value is MessageMemoryPublication {
  return normalizeMessageMemoryPublication(value) !== undefined;
}

export function areMessageMemoryPublicationsEqual(
  left: MessageMemoryPublication | undefined,
  right: MessageMemoryPublication | undefined,
): boolean {
  return left?.version === right?.version && left?.disposition === right?.disposition;
}

/** Missing state is historical/unspecified and must never be treated as an open obligation. */
export function isOpenMessageMemoryPublication(
  publication: MessageMemoryPublication | undefined,
): boolean {
  return publication?.disposition === null;
}

export function isTerminalMessageMemoryPublication(
  publication: MessageMemoryPublication | undefined,
): publication is TerminalMessageMemoryPublication {
  return publication !== undefined && TERMINAL_DISPOSITIONS.has(publication.disposition);
}

/**
 * Resolves the only legal compare-and-set transitions for a message publication receipt.
 * Identical replay is successful but unchanged so retries remain idempotent.
 */
export function resolveMessageMemoryPublicationTransition(
  current: MessageMemoryPublication | undefined,
  requested: MessageMemoryPublication,
): MessageMemoryPublicationTransitionResult {
  if (areMessageMemoryPublicationsEqual(current, requested)) {
    return { applied: true, changed: false, publication: requested };
  }

  const canApply =
    current === undefined ||
    (isOpenMessageMemoryPublication(current) && isTerminalMessageMemoryPublication(requested)) ||
    (current.disposition === 'enqueued' && requested.disposition === 'withdrawn');

  if (canApply) {
    return { applied: true, changed: true, publication: requested };
  }

  return { applied: false, changed: false, current, requested };
}
