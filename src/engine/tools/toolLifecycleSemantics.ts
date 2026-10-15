import {
  inferToolCapabilityDescriptor,
  type ToolCapabilityDescriptor,
  type ToolWorkflowStage,
} from './capabilityRegistry';
import { findLiveRuntimeExternalToolDeclaration } from './liveRuntimeExternalToolDeclaration';
import { normalizeToolName } from './toolNameNormalization';

const PRODUCER_WORKFLOW_STAGES = new Set<ToolWorkflowStage>([
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'continue_external_execution',
  'guarded_resource_creation',
]);

/**
 * What a tool does, by name: a connected integration's or loaded skill's live declaration
 * carries its contract (a trusted read-only MCP tool inspects, it does not mutate); any other
 * name resolves to its built-in contract.
 */
export function descriptorForToolName(toolName: string): ToolCapabilityDescriptor {
  const normalizedName = normalizeToolName(toolName);
  return inferToolCapabilityDescriptor(
    findLiveRuntimeExternalToolDeclaration(normalizedName) ?? {
      name: normalizedName,
      description: normalizedName,
    },
  );
}

export function descriptorContinuesExternalExecution(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return descriptor.workflowStages.includes('continue_external_execution');
}

export function descriptorStartsExternalExecution(descriptor: ToolCapabilityDescriptor): boolean {
  if (descriptor.workflowStages.includes('start_external_execution')) {
    return true;
  }

  return (
    descriptor.sideEffects.includes('external_run') &&
    !descriptorContinuesExternalExecution(descriptor)
  );
}

export function descriptorIsPassiveAsyncObserver(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptor.capabilities.some(
      (capability) => capability === 'monitor' || capability === 'wait' || capability === 'verify',
    ) &&
    descriptor.workflowStages.some(
      (stage) => stage === 'monitor_external_execution' || stage === 'await_external_execution',
    )
  );
}

export function descriptorHasProducerEffect(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.some(
      (sideEffect) =>
        sideEffect !== 'none' &&
        (sideEffect !== 'external_run' || !descriptorContinuesExternalExecution(descriptor)),
    ) ||
    descriptor.workflowStages.some((stage) => PRODUCER_WORKFLOW_STAGES.has(stage)) ||
    descriptor.capabilities.some(
      (capability) =>
        capability === 'write' ||
        capability === 'commit' ||
        capability === 'push' ||
        capability === 'deploy' ||
        capability === 'compute',
    )
  );
}

export function descriptorHasInspectionEffect(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptor.workflowStages.some(
      (stage) => stage === 'discover_resource' || stage === 'inspect_resource',
    ) &&
    descriptor.capabilities.some((capability) => capability === 'discover' || capability === 'read')
  );
}
