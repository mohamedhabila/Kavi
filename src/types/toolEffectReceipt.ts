export const TOOL_EFFECT_TRANSPORT_STATES = ['returned', 'rejected', 'threw'] as const;
export type ToolEffectTransportState = (typeof TOOL_EFFECT_TRANSPORT_STATES)[number];

export const TOOL_EFFECT_STATES = [
  'none',
  'accepted',
  'handed_off',
  'pending',
  'applied',
  'cancelled',
  'failed',
  'unknown',
] as const;
export type ToolEffectState = (typeof TOOL_EFFECT_STATES)[number];

export const TOOL_EFFECT_VERIFICATION_STATES = [
  'not_applicable',
  'unverified',
  'acknowledged',
  'verified',
] as const;
export type ToolEffectVerificationState = (typeof TOOL_EFFECT_VERIFICATION_STATES)[number];

export const TOOL_EFFECT_KINDS = [
  'unknown',
  'observation.read',
  'compute.execute',
  'artifact.write',
  'communication.draft_handoff',
  'communication.send',
  'communication.call_handoff',
  'navigation.open',
  'share.handoff',
  'contact.create',
  'contact.update',
  'calendar.create',
  'calendar.update',
  'clipboard.write',
  'notification.schedule',
  'notification.cancel',
  'media.capture',
  'workflow.start',
  'workflow.mutate',
  'remote.mutate',
] as const;
export type ToolEffectKind = (typeof TOOL_EFFECT_KINDS)[number];

export type ToolEffectDigest = `sha256:${string}`;

export interface ToolEffectResourceRef {
  readonly kind: string;
  readonly id: string;
}

export interface ToolEffectOperationHandle {
  readonly kind: string;
  readonly id: string;
}

export interface ToolEffectReceipt {
  readonly version: 1;
  readonly receiptId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly runId?: string;
  readonly transportState: ToolEffectTransportState;
  readonly effectKind: ToolEffectKind;
  readonly effectState: ToolEffectState;
  readonly verificationState: ToolEffectVerificationState;
  readonly requestDigest: ToolEffectDigest;
  readonly resultDigest: ToolEffectDigest;
  readonly resource?: ToolEffectResourceRef;
  readonly operationHandle?: ToolEffectOperationHandle;
  readonly recordedAt: number;
}

export interface ToolEffectResultOutcome {
  readonly effectKind?: ToolEffectKind;
  readonly effectState: ToolEffectState;
  readonly verificationState: ToolEffectVerificationState;
}

export interface ToolEffectIdentitySelector {
  readonly kind: string;
  readonly source: 'arguments' | 'result';
  readonly path: readonly string[];
}

export interface ToolEffectResultContract {
  readonly statusPath: readonly string[];
  readonly outcomes: Readonly<Record<string, ToolEffectResultOutcome>>;
  readonly resource?: ToolEffectIdentitySelector;
  readonly operationHandle?: ToolEffectIdentitySelector;
}
