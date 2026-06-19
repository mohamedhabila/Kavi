import type { ToolDefinition } from '../../../types/tool';

export type ToolContract = NonNullable<ToolDefinition['contract']>;
export type NativeRiskLevel = NonNullable<ToolContract['riskLevel']>;

export const RECOVERABLE_PLATFORM_ERRORS = [
  'platform_unavailable',
  'permission_denied',
  'permission_blocked',
  'user_cancelled',
  'validation_error',
  'transient_native_error',
] as const;

export const RECOVERABLE_EXTERNAL_ERRORS = [
  'platform_unavailable',
  'external_app_unavailable',
  'user_cancelled',
  'validation_error',
  'transient_native_error',
] as const;

export const RECOVERABLE_DEVICE_READ_ERRORS = [
  'platform_unavailable',
  'permission_denied',
  'permission_blocked',
  'transient_native_error',
] as const;

export const NO_PERMISSION_PREREQUISITES: string[] = [];

export function nativeContract(
  patch: Partial<ToolContract> &
    Pick<ToolContract, 'category' | 'capabilities' | 'resourceKinds' | 'sideEffects'> & {
      riskLevel: NativeRiskLevel;
      permissionPrerequisites: string[];
      recoverableErrors: string[];
    },
): ToolContract {
  return {
    category: 'native',
    capabilities: [],
    resourceKinds: ['unknown'],
    sideEffects: ['none'],
    riskHints: [],
    prerequisites: [],
    providesEvidence: [],
    workflowStages: [],
    ...patch,
    riskLevel: patch.riskLevel,
    permissionPrerequisites: patch.permissionPrerequisites,
    recoverableErrors: patch.recoverableErrors,
  };
}
