export const REQUEST_FRAME_VERSION = 3 as const;

export type RequestInputKind = 'empty' | 'text' | 'attachments' | 'text_and_attachments';
export type RequestContinuation = 'new' | 'resume' | 'resume_waiting_async' | 'resume_waiting_user';
export type RequestDecisionAction = 'act' | 'clarify';
export type RequestDecisionReason =
  | 'actionable_input'
  | 'requirements_resolved'
  | 'missing_input'
  | 'required_information_missing'
  | 'information_lookup_required';

export type RequiredInformationAuthority = 'user' | 'memory' | 'tool' | 'policy';
export type RequiredInformationPurpose = 'understanding' | 'execution' | 'authorization';
export type RequiredInformationResolution =
  | 'unresolved'
  | 'user_provided'
  | 'memory_supported'
  | 'tool_observed'
  | 'policy_granted';

export interface RequiredRequestInformation {
  /** Stable code-owned key. User text is never copied into this control field. */
  key: string;
  authority: RequiredInformationAuthority;
  requiredFor: RequiredInformationPurpose;
  resolution: RequiredInformationResolution;
}

export interface RequestFrame {
  version: typeof REQUEST_FRAME_VERSION;
  input: Readonly<{
    kind: RequestInputKind;
    attachmentCount: number;
  }>;
  continuation: RequestContinuation;
  /** Populated only by code-owned understanding and policy stages. */
  requiredInformation: ReadonlyArray<RequiredRequestInformation>;
  decision: Readonly<{
    action: RequestDecisionAction;
    reason: RequestDecisionReason;
  }>;
}
