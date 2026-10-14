import type { RequestFrame, RequiredRequestInformation } from './requestFrame';
import { requestDecisionIsPolicyReachable } from './requestDecisionPolicy';
import {
  REQUEST_UNDERSTANDING_PROJECTION_VERSION,
  type RequestUnderstandingBoundedList,
  type RequestUnderstandingConflict,
  type RequestUnderstandingEffectAuthorization,
  type RequestUnderstandingField,
  type RequestUnderstandingFieldStatus,
  type RequestUnderstandingProjection,
  type RequestUnderstandingRequiredInformation,
  type RequestUnderstandingRouting,
  type RequestUnderstandingSnapshot,
  type RequestUnderstandingUnknown,
} from '../../types/requestUnderstanding';

const MAX_REQUIRED_INFORMATION = 12;

const unknown = (reason: RequestUnderstandingUnknown['reason']): RequestUnderstandingUnknown => ({
  status: 'unknown',
  reason,
});

const conflict = (
  reason: RequestUnderstandingConflict['reason'],
): RequestUnderstandingConflict => ({ status: 'conflict', reason });

function boundedList<T>(
  values: ReadonlyArray<T>,
  maximum: number,
): RequestUnderstandingBoundedList<T> {
  return {
    items: values.slice(0, maximum),
    omittedCount: Math.max(0, values.length - maximum),
  };
}

function duplicateValue(values: ReadonlyArray<string>): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}

function projectRouting(
  frame: RequestFrame | undefined,
): RequestUnderstandingField<RequestUnderstandingRouting> {
  if (!frame) return unknown('request_state_unavailable');
  return {
    status: 'known',
    source: 'request_frame',
    value: {
      inputKind: frame.input.kind,
      attachmentCount: frame.input.attachmentCount,
      continuation: frame.continuation,
      decisionAction: frame.decision.action,
      decisionReason: frame.decision.reason,
    },
  };
}

const RESOLUTION_BY_AUTHORITY: Readonly<
  Record<
    RequiredRequestInformation['authority'],
    Exclude<RequiredRequestInformation['resolution'], 'unresolved'>
  >
> = {
  user: 'user_provided',
  memory: 'memory_supported',
  tool: 'tool_observed',
  policy: 'policy_granted',
};

function requiredInformationIsConsistent(entry: RequiredRequestInformation): boolean {
  return (
    entry.resolution === 'unresolved' ||
    entry.resolution === RESOLUTION_BY_AUTHORITY[entry.authority]
  );
}

function projectRequiredInformation(
  frame: RequestFrame | undefined,
): RequestUnderstandingField<
  RequestUnderstandingBoundedList<RequestUnderstandingRequiredInformation>
> {
  if (!frame) return unknown('request_state_unavailable');
  if (duplicateValue(frame.requiredInformation.map((entry) => entry.key))) {
    return conflict('duplicate_required_information_key');
  }
  if (frame.requiredInformation.some((entry) => !requiredInformationIsConsistent(entry))) {
    return conflict('authority_state_conflict');
  }
  return {
    status: 'known',
    source: 'request_frame',
    value: boundedList(
      frame.requiredInformation.map((entry) => ({ ...entry })),
      MAX_REQUIRED_INFORMATION,
    ),
  };
}

function requestDecisionStateConflicts(frame: RequestFrame | undefined): boolean {
  return frame !== undefined && !requestDecisionIsPolicyReachable(frame);
}

function projectEffectAuthorization(
  frame: RequestFrame | undefined,
  hasConflict: boolean,
): RequestUnderstandingEffectAuthorization {
  if (!frame) return unknown('request_state_unavailable');
  if (hasConflict) return unknown('state_conflict');
  return unknown('not_evaluated_per_effect');
}

export function projectRequestUnderstanding(params: {
  requestFrame?: RequestFrame;
}): RequestUnderstandingProjection {
  const requiredInformation = projectRequiredInformation(params.requestFrame);
  const decisionConflict = requestDecisionStateConflicts(params.requestFrame);
  const hasConflict = requiredInformation.status === 'conflict' || decisionConflict;
  return {
    version: REQUEST_UNDERSTANDING_PROJECTION_VERSION,
    integrity: hasConflict ? 'conflict' : 'valid',
    routing: projectRouting(params.requestFrame),
    registeredRequiredInformation: requiredInformation,
    effectAuthorization: projectEffectAuthorization(params.requestFrame, hasConflict),
  };
}

function summarizeList<T>(field: RequestUnderstandingField<RequestUnderstandingBoundedList<T>>): {
  status: RequestUnderstandingFieldStatus;
  count: number;
  omittedCount: number;
} {
  return field.status === 'known'
    ? {
        status: 'known',
        count: field.value.items.length,
        omittedCount: field.value.omittedCount,
      }
    : { status: field.status, count: 0, omittedCount: 0 };
}

export function summarizeRequestUnderstanding(
  projection: RequestUnderstandingProjection,
): RequestUnderstandingSnapshot {
  const requiredInformation = summarizeList(projection.registeredRequiredInformation);
  const unresolvedCount =
    projection.registeredRequiredInformation.status === 'known'
      ? projection.registeredRequiredInformation.value.items.filter(
          (entry) => entry.resolution === 'unresolved',
        ).length
      : 0;
  const routing =
    projection.routing.status === 'known'
      ? { status: 'known' as const, ...projection.routing.value }
      : { status: projection.routing.status };
  return {
    version: projection.version,
    integrity: projection.integrity,
    routing,
    registeredRequiredInformation: {
      ...requiredInformation,
      unresolvedCount,
    },
    effectAuthorization: { status: projection.effectAuthorization.status },
  };
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : undefined;
}

const FIELD_STATUSES = new Set<RequestUnderstandingFieldStatus>(['known', 'unknown', 'conflict']);
const INPUT_KINDS = new Set<RequestUnderstandingRouting['inputKind']>([
  'empty',
  'text',
  'attachments',
  'text_and_attachments',
]);
const CONTINUATIONS = new Set<RequestUnderstandingRouting['continuation']>([
  'new',
  'resume',
  'resume_waiting_async',
  'resume_waiting_user',
]);
const DECISION_ACTIONS = new Set<RequestUnderstandingRouting['decisionAction']>(['act', 'clarify']);
const DECISION_REASONS = new Set<RequestUnderstandingRouting['decisionReason']>([
  'actionable_input',
  'requirements_resolved',
  'missing_input',
  'required_information_missing',
  'information_lookup_required',
]);

function normalizeListSnapshot(
  value: unknown,
): { status: RequestUnderstandingFieldStatus; count: number; omittedCount: number } | undefined {
  const record = recordValue(value);
  if (!record || !FIELD_STATUSES.has(record.status as RequestUnderstandingFieldStatus)) {
    return undefined;
  }
  const count = nonNegativeInteger(record.count);
  const omittedCount = nonNegativeInteger(record.omittedCount);
  if (count === undefined || omittedCount === undefined) return undefined;
  if (record.status !== 'known' && (count !== 0 || omittedCount !== 0)) return undefined;
  return {
    status: record.status as RequestUnderstandingFieldStatus,
    count,
    omittedCount,
  };
}

function normalizeRoutingSnapshot(
  value: unknown,
): RequestUnderstandingSnapshot['routing'] | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  if (record.status === 'unknown' || record.status === 'conflict') {
    return { status: record.status };
  }
  const attachmentCount = nonNegativeInteger(record.attachmentCount);
  if (
    record.status !== 'known' ||
    !INPUT_KINDS.has(record.inputKind as RequestUnderstandingRouting['inputKind']) ||
    attachmentCount === undefined ||
    !CONTINUATIONS.has(record.continuation as RequestUnderstandingRouting['continuation']) ||
    !DECISION_ACTIONS.has(record.decisionAction as RequestUnderstandingRouting['decisionAction']) ||
    !DECISION_REASONS.has(record.decisionReason as RequestUnderstandingRouting['decisionReason'])
  ) {
    return undefined;
  }
  return {
    status: 'known',
    inputKind: record.inputKind as RequestUnderstandingRouting['inputKind'],
    attachmentCount,
    continuation: record.continuation as RequestUnderstandingRouting['continuation'],
    decisionAction: record.decisionAction as RequestUnderstandingRouting['decisionAction'],
    decisionReason: record.decisionReason as RequestUnderstandingRouting['decisionReason'],
  };
}

export function normalizeRequestUnderstandingSnapshot(
  value: unknown,
): RequestUnderstandingSnapshot | undefined {
  const record = recordValue(value);
  if (
    !record ||
    record.version !== REQUEST_UNDERSTANDING_PROJECTION_VERSION ||
    (record.integrity !== 'valid' && record.integrity !== 'conflict')
  ) {
    return undefined;
  }
  const routing = normalizeRoutingSnapshot(record.routing);
  const registeredRequiredInformation = normalizeListSnapshot(record.registeredRequiredInformation);
  const registeredRecord = recordValue(record.registeredRequiredInformation);
  const unresolvedCount = nonNegativeInteger(registeredRecord?.unresolvedCount);
  const effectAuthorization = recordValue(record.effectAuthorization);
  if (
    !routing ||
    !registeredRequiredInformation ||
    unresolvedCount === undefined ||
    effectAuthorization?.status !== 'unknown'
  ) {
    return undefined;
  }
  if (unresolvedCount > registeredRequiredInformation.count) return undefined;
  const fieldStatuses = [routing.status, registeredRequiredInformation.status];
  if (record.integrity === 'valid' && fieldStatuses.includes('conflict')) return undefined;
  return {
    version: REQUEST_UNDERSTANDING_PROJECTION_VERSION,
    integrity: record.integrity,
    routing,
    registeredRequiredInformation: {
      ...registeredRequiredInformation,
      unresolvedCount,
    },
    effectAuthorization: { status: effectAuthorization.status },
  };
}

export function areRequestUnderstandingSnapshotsEqual(
  left: RequestUnderstandingSnapshot | undefined,
  right: RequestUnderstandingSnapshot | undefined,
): boolean {
  return (
    JSON.stringify(normalizeRequestUnderstandingSnapshot(left) ?? null) ===
    JSON.stringify(normalizeRequestUnderstandingSnapshot(right) ?? null)
  );
}
