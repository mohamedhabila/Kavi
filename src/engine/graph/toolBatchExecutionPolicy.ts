import type { ToolDefinition } from '../../types/tool';
import type { AgentGoal } from '../goals/types';
import { resolveOrderedGoalCapabilities } from '../goals/toolSurface';
import {
  inferToolCapabilityDescriptor,
  type ToolCapabilityDescriptor,
  type ToolCapability,
} from '../tools/capabilityRegistry';
import { normalizeToolName } from '../tools/toolNameNormalization';
import { workflowProductionSatisfiesConsumption } from '../tools/toolWorkflowContracts';

const PARALLEL_SAFE_CAPABILITIES = new Set<ToolCapability>([
  'discover',
  'read',
  'monitor',
  'wait',
  'verify',
  'compute',
]);

const MUTATION_CAPABILITIES = new Set<ToolCapability>([
  'write',
  'commit',
  'push',
  'deploy',
  'coordinate',
]);

export function isParallelizableToolName(name: string): boolean {
  if (!name) {
    return false;
  }

  const descriptor = inferToolCapabilityDescriptor({
    name,
    description: name,
  });
  return isParallelizableToolDescriptor(descriptor);
}

function isParallelizableToolDescriptor(descriptor: ToolCapabilityDescriptor): boolean {
  if (descriptor.category === 'other') {
    return false;
  }
  if (descriptor.source !== 'built-in' && !descriptor.riskHints.includes('read_only')) {
    return false;
  }

  const capabilities = new Set(descriptor.capabilities);
  const hasMutationCapability = Array.from(MUTATION_CAPABILITIES).some((capability) =>
    capabilities.has(capability),
  );
  const hasSideEffects = descriptor.sideEffects.some((sideEffect) => sideEffect !== 'none');

  return (
    !hasMutationCapability &&
    !hasSideEffects &&
    Array.from(capabilities).some((capability) => PARALLEL_SAFE_CAPABILITIES.has(capability))
  );
}

function buildDescriptorByToolName(
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description' | 'contract'>> | undefined,
): Map<string, ToolCapabilityDescriptor> {
  const descriptors = new Map<string, ToolCapabilityDescriptor>();
  for (const tool of tools ?? []) {
    const normalizedName = normalizeToolName(tool.name);
    if (!normalizedName) {
      continue;
    }
    descriptors.set(normalizedName, inferToolCapabilityDescriptor(tool));
  }
  return descriptors;
}

function resolveToolCallDescriptor(
  toolCall: { name: string },
  descriptorByName: ReadonlyMap<string, ToolCapabilityDescriptor>,
): ToolCapabilityDescriptor {
  const normalizedName = normalizeToolName(toolCall.name);
  return (
    descriptorByName.get(normalizedName) ??
    inferToolCapabilityDescriptor({
      name: toolCall.name,
      description: toolCall.name,
    })
  );
}

function producerSatisfiesPermissionRequirement(
  producer: ToolCapabilityDescriptor,
  permission: string,
): boolean {
  return producer.produces.some(
    (production) =>
      production.kind === 'permission_state' &&
      (!production.field || production.field === permission),
  );
}

function hasProducerConsumerDependency(
  producer: ToolCapabilityDescriptor,
  consumer: ToolCapabilityDescriptor,
): boolean {
  if (producer.name === consumer.name) {
    return false;
  }
  if (producer.precedes.includes(consumer.name)) {
    return true;
  }
  if (
    consumer.consumes.some((consumption) =>
      producer.produces.some((production) =>
        workflowProductionSatisfiesConsumption(production, consumption),
      ),
    )
  ) {
    return true;
  }
  return consumer.requiresPermissionEvidence.some((permission) =>
    producerSatisfiesPermissionRequirement(producer, permission),
  );
}

function hasWorkflowDependencyBetweenToolCalls(
  toolCalls: ReadonlyArray<{ name: string }>,
  descriptorByName: ReadonlyMap<string, ToolCapabilityDescriptor>,
): boolean {
  const descriptors = toolCalls.map((toolCall) =>
    resolveToolCallDescriptor(toolCall, descriptorByName),
  );

  for (let leftIndex = 0; leftIndex < descriptors.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < descriptors.length; rightIndex += 1) {
      const left = descriptors[leftIndex]!;
      const right = descriptors[rightIndex]!;
      if (
        hasProducerConsumerDependency(left, right) ||
        hasProducerConsumerDependency(right, left)
      ) {
        return true;
      }
    }
  }

  return false;
}

export function shouldExecuteToolBatchInParallel(
  toolCalls: ReadonlyArray<{ name: string }>,
  goals?: ReadonlyArray<AgentGoal>,
  tools?: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description' | 'contract'>>,
): boolean {
  if (toolCalls.length <= 1) {
    return false;
  }

  const activeGoals = (goals ?? []).filter((goal) => goal.status === 'active');
  const orderedCapabilities = resolveOrderedGoalCapabilities(
    activeGoals.flatMap((goal) => goal.requiredCapabilities ?? []),
  );
  if (orderedCapabilities.length >= 2) {
    return false;
  }

  const descriptorByName = buildDescriptorByToolName(tools);
  if (hasWorkflowDependencyBetweenToolCalls(toolCalls, descriptorByName)) {
    return false;
  }

  return toolCalls.every((toolCall) =>
    isParallelizableToolDescriptor(resolveToolCallDescriptor(toolCall, descriptorByName)),
  );
}
