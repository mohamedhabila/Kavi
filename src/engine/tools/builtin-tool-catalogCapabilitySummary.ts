import type { ToolDefinition } from '../../types/tool';
import { inferToolCapabilityDescriptor } from './capabilityRegistry';
import type { ToolCatalogCapabilitySummary } from './builtin-tool-catalogTypes';

export function buildCapabilitySummary(
  tool: Pick<ToolDefinition, 'name' | 'description' | 'contract'>,
): ToolCatalogCapabilitySummary {
  const descriptor = inferToolCapabilityDescriptor(tool);
  return {
    capabilities: descriptor.capabilities,
    resourceKinds: descriptor.resourceKinds,
    sideEffects: descriptor.sideEffects,
    providesEvidence: descriptor.providesEvidence,
    workflowStages: descriptor.workflowStages,
    produces: descriptor.produces,
    consumes: descriptor.consumes,
    precedes: descriptor.precedes,
    requiresPermissionEvidence: descriptor.requiresPermissionEvidence,
  };
}
