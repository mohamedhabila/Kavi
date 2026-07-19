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

export const TOOL_EXECUTION_STATES = [
  'completed',
  'failed',
  'timed_out',
  'cancelled',
  'unknown',
] as const;
export type ToolExecutionState = (typeof TOOL_EXECUTION_STATES)[number];

export const TOOL_EFFECT_KINDS = [
  'unknown',
  'observation.read',
  'compute.execute',
  'artifact.write',
  'artifact.delete',
  'memory.write',
  'memory.update',
  'memory.delete',
  'communication.draft_handoff',
  'communication.draft_save',
  'communication.send',
  'communication.call_handoff',
  'navigation.open',
  'external.open',
  'share.handoff',
  'contact.create',
  'contact.update',
  'contact.access_update',
  'calendar.create',
  'calendar.update',
  'clipboard.write',
  'notification.send',
  'notification.schedule',
  'notification.cancel',
  'media.capture',
  'device.haptic',
  'workflow.start',
  'workflow.mutate',
  'remote.mutate',
] as const;
export type ToolEffectKind = (typeof TOOL_EFFECT_KINDS)[number];

export type ToolEffectDigest = `sha256:${string}`;

export interface CodeOwnedToolContractIdentity {
  readonly kind: 'code_owned';
  readonly version: 1;
  readonly toolName: string;
  readonly schemaDigest: ToolEffectDigest;
  readonly capabilityContractDigest: ToolEffectDigest;
  readonly workflowContractDigest: ToolEffectDigest;
  readonly effectContractDigest: ToolEffectDigest;
  readonly executionPolicyDigest: ToolEffectDigest;
}

export type RuntimeExternalToolSource = 'mcp' | 'skill';
export type RuntimeExternalToolEffectClass = 'none' | 'potentially_effectful' | 'unknown';

/**
 * Content-free evidence for the exact dynamic declaration and runtime target
 * selected by product code. Effect-free authority is recorded only when the
 * app explicitly trusts the integration's standard effect annotations; this
 * still does not certify provider outcomes or procedure reuse.
 */
export interface RuntimeExternalToolContractIdentity {
  readonly kind: 'runtime_external';
  readonly version: 2;
  readonly toolName: string;
  readonly source: RuntimeExternalToolSource;
  readonly namespace: string;
  readonly effectClass: RuntimeExternalToolEffectClass;
  readonly declarationDigest: ToolEffectDigest;
  readonly executionBindingDigest: ToolEffectDigest;
}

export type ToolContractIdentity =
  | CodeOwnedToolContractIdentity
  | RuntimeExternalToolContractIdentity;

export interface ToolEffectResourceRef {
  readonly kind: string;
  readonly id: string;
  readonly digest?: ToolEffectDigest;
}

export interface ToolEffectOperationHandle {
  readonly kind: string;
  readonly id: string;
}

export interface ToolEffectReceipt {
  readonly version: 2;
  readonly receiptId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly contractIdentity: ToolContractIdentity;
  readonly executionRunId: string;
  readonly dispatchRunId?: string;
  readonly transportState: ToolEffectTransportState;
  readonly executionState?: ToolExecutionState;
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
  readonly executionState?: ToolExecutionState;
  readonly effectState: ToolEffectState;
  readonly verificationState: ToolEffectVerificationState;
}

export interface ToolEffectIdentitySelector {
  readonly kind: string;
  readonly source: 'arguments' | 'result';
  readonly path: readonly string[];
}

export interface ToolEffectResourceSelector extends ToolEffectIdentitySelector {
  readonly digestPath?: readonly string[];
}

export interface ToolEffectResultContract {
  readonly statusPath: readonly string[];
  readonly outcomes: Readonly<Record<string, ToolEffectResultOutcome>>;
  readonly resource?: ToolEffectResourceSelector;
  readonly operationHandle?: ToolEffectIdentitySelector;
}
