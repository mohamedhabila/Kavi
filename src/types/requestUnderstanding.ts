export const REQUEST_UNDERSTANDING_PROJECTION_VERSION = 3 as const;

export type RequestUnderstandingUnknownReason =
  | 'request_state_unavailable'
  | 'not_evaluated_per_effect'
  | 'state_conflict';

export type RequestUnderstandingConflictReason =
  | 'duplicate_required_information_key'
  | 'authority_state_conflict';

export type RequestUnderstandingUnknown = Readonly<{
  status: 'unknown';
  reason: RequestUnderstandingUnknownReason;
}>;

export type RequestUnderstandingConflict = Readonly<{
  status: 'conflict';
  reason: RequestUnderstandingConflictReason;
}>;

export type RequestUnderstandingKnown<T> = Readonly<{
  status: 'known';
  source: 'request_frame';
  value: T;
}>;

export type RequestUnderstandingField<T> =
  | RequestUnderstandingKnown<T>
  | RequestUnderstandingUnknown
  | RequestUnderstandingConflict;

export type RequestUnderstandingRouting = Readonly<{
  mode: 'chitchat' | 'agentic';
  inputKind: 'empty' | 'text' | 'attachments' | 'text_and_attachments';
  attachmentCount: number;
  continuation: 'new' | 'resume' | 'resume_waiting_async' | 'resume_waiting_user';
  decisionAction: 'act' | 'clarify' | 'wait' | 'decline' | 'consent';
  decisionReason:
    | 'actionable_input'
    | 'requirements_resolved'
    | 'missing_input'
    | 'required_information_missing'
    | 'information_lookup_required'
    | 'waiting_for_async'
    | 'permission_missing'
    | 'policy_information_unavailable'
    | 'prohibited'
    | 'authorization_required';
}>;

export type RequestUnderstandingRequiredInformation = Readonly<{
  key: string;
  authority: 'user' | 'memory' | 'tool' | 'policy';
  requiredFor: 'understanding' | 'execution' | 'authorization';
  resolution:
    | 'unresolved'
    | 'user_provided'
    | 'memory_supported'
    | 'tool_observed'
    | 'policy_granted';
}>;

export type RequestUnderstandingBoundedList<T> = Readonly<{
  items: ReadonlyArray<T>;
  omittedCount: number;
}>;

export type RequestUnderstandingEffectAuthorization =
  | Readonly<{
      status: 'required';
      reason: 'authorization_required' | 'permission_missing';
      source: 'request_frame';
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'prohibited' | 'policy_information_unavailable';
      source: 'request_frame';
    }>
  | RequestUnderstandingUnknown;

export interface RequestUnderstandingProjection {
  version: typeof REQUEST_UNDERSTANDING_PROJECTION_VERSION;
  integrity: 'valid' | 'conflict';
  routing: RequestUnderstandingField<RequestUnderstandingRouting>;
  registeredRequiredInformation: RequestUnderstandingField<
    RequestUnderstandingBoundedList<RequestUnderstandingRequiredInformation>
  >;
  /** Authority is unknown until code has made an explicit consent or deny decision. */
  effectAuthorization: RequestUnderstandingEffectAuthorization;
}

export type RequestUnderstandingFieldStatus = 'known' | 'unknown' | 'conflict';

export interface RequestUnderstandingSnapshot {
  version: typeof REQUEST_UNDERSTANDING_PROJECTION_VERSION;
  integrity: RequestUnderstandingProjection['integrity'];
  routing:
    | Readonly<{
        status: 'known';
        mode: RequestUnderstandingRouting['mode'];
        inputKind: RequestUnderstandingRouting['inputKind'];
        attachmentCount: number;
        continuation: RequestUnderstandingRouting['continuation'];
        decisionAction: RequestUnderstandingRouting['decisionAction'];
        decisionReason: RequestUnderstandingRouting['decisionReason'];
      }>
    | Readonly<{ status: 'unknown' | 'conflict' }>;
  registeredRequiredInformation: Readonly<{
    status: RequestUnderstandingFieldStatus;
    count: number;
    omittedCount: number;
    unresolvedCount: number;
  }>;
  effectAuthorization: Readonly<{
    status: 'required' | 'unavailable' | 'unknown';
  }>;
}
