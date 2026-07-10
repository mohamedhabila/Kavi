export const REQUEST_FRAME_VERSION = 1 as const;

export type RequestMode = 'chitchat' | 'agentic';
export type RequestInputKind = 'empty' | 'text' | 'attachments' | 'text_and_attachments';
export type RequestContinuation = 'new' | 'resume' | 'resume_waiting_async';
export type RequestDecisionAction = 'act' | 'clarify' | 'wait' | 'decline' | 'consent';
export type RequestDecisionReason =
  | 'actionable_input'
  | 'requirements_resolved'
  | 'missing_input'
  | 'punctuation_only'
  | 'required_information_missing'
  | 'waiting_for_async'
  | 'permission_missing'
  | 'prohibited'
  | 'authorization_required';

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
  mode: RequestMode;
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
