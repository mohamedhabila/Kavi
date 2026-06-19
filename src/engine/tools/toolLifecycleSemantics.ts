import {
  inferToolCapabilityDescriptor,
  type ToolCapability,
  type ToolCapabilityDescriptor,
  type ToolWorkflowStage,
} from './capabilityRegistry';
import { normalizeToolCategoryFamily } from '../toolCategoryNormalization';
import { normalizeToolName } from './toolNameNormalization';

const PRODUCER_WORKFLOW_STAGES = new Set<ToolWorkflowStage>([
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'continue_external_execution',
  'guarded_resource_creation',
]);

const OBSERVER_WORKFLOW_STAGES = new Set<ToolWorkflowStage>([
  'monitor_external_execution',
  'await_external_execution',
  'verify_evidence',
]);

export function descriptorForToolName(toolName: string): ToolCapabilityDescriptor {
  const normalizedName = normalizeToolName(toolName);
  return inferToolCapabilityDescriptor({
    name: normalizedName,
    description: normalizedName,
  });
}

export function descriptorFamily(descriptor: ToolCapabilityDescriptor): string {
  return normalizeToolCategoryFamily(descriptor.category) ?? descriptor.category;
}

export function descriptorContinuesExternalExecution(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return descriptor.workflowStages.includes('continue_external_execution');
}

export function descriptorStartsExternalExecution(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  if (descriptor.workflowStages.includes('start_external_execution')) {
    return true;
  }

  return (
    descriptor.sideEffects.includes('external_run') &&
    !descriptorContinuesExternalExecution(descriptor)
  );
}

export function descriptorProducesExternalExecutionEvidence(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    descriptorStartsExternalExecution(descriptor) &&
    descriptor.providesEvidence.includes('external_run')
  );
}

export function descriptorPassivelyObservesExternalExecution(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptor.workflowStages.some(
      (stage) => stage === 'monitor_external_execution' || stage === 'await_external_execution',
    )
  );
}

export function capabilitiesForToolNames(toolNames: ReadonlyArray<string>): ToolCapability[] {
  return Array.from(
    new Set(toolNames.flatMap((toolName) => descriptorForToolName(toolName).capabilities)),
  );
}

export function descriptorHasLocalArtifactProducerEffect(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    descriptor.sideEffects.includes('local_artifact') &&
    descriptor.capabilities.some((capability) => capability === 'write')
  );
}

export function descriptorIsPassiveAsyncObserver(
  descriptor: ToolCapabilityDescriptor,
): boolean {
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

export function descriptorHasObserverEffect(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.workflowStages.some((stage) => OBSERVER_WORKFLOW_STAGES.has(stage)) ||
    descriptor.capabilities.some(
      (capability) => capability === 'monitor' || capability === 'wait' || capability === 'verify',
    )
  );
}

export function descriptorHasInspectionEffect(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptor.workflowStages.some(
      (stage) => stage === 'discover_resource' || stage === 'inspect_resource',
    ) &&
    descriptor.capabilities.some((capability) => capability === 'discover' || capability === 'read')
  );
}
