import type { AgentRunRouteState, ToolDefinition } from '../../types';
import {
  buildToolCapabilityRegistry,
  descriptorSatisfiesRequirement,
  findToolDescriptorByName,
  inferToolCapabilityDescriptor,
  selectToolNamesForCapabilityRequirements,
  type ToolCapability,
  type ToolCapabilityDescriptor,
  type ToolEvidenceKind,
  type ToolCapabilityRequirement,
  type ToolWorkflowStage,
} from '../tools/capabilityRegistry';
import { normalizeToolName } from '../tools/toolNameNormalization';

export type WorkflowRouteId = 'capability-workflow';

export interface WorkflowRoutePhaseSpec {
  id: string;
  title: string;
  stage: ToolWorkflowStage;
  requiredCapabilities: ToolCapabilityRequirement[];
}

export interface WorkflowRouteActivation {
  routeId: WorkflowRouteId;
  title: string;
  phases: WorkflowRoutePhaseSpec[];
  requiredToolNames: string[];
  requiredWorkflowRequirementKeys: string[];
  workflowRequirementLabelsByKey: Record<string, string>;
  workflowRequirementToolNamesByKey: Record<string, string[]>;
  guidance: string;
}

export interface WorkflowRoutePlannerSignal {
  routeMode?: 'execution' | 'discovery' | 'research';
  requiredToolCategories?: ReadonlySet<string>;
  requiredCapabilities?: ReadonlySet<ToolCapability>;
  plannedToolNames?: ReadonlySet<string>;
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>;
}

export interface WorkflowRouteToolResult {
  toolName: string;
  result: string;
  status: 'completed' | 'failed';
  timestamp: number;
}

const STAGE_ORDER: ToolWorkflowStage[] = [
  'discover_resource',
  'inspect_resource',
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'monitor_external_execution',
  'await_external_execution',
  'verify_evidence',
  'guarded_resource_creation',
];

const STAGE_TITLES: Record<ToolWorkflowStage, string> = {
  discover_resource: 'Discover required resources',
  inspect_resource: 'Inspect current state',
  prepare_artifact: 'Prepare artifacts',
  persist_artifact: 'Persist artifacts',
  mutate_remote_state: 'Apply remote side effects',
  start_external_execution: 'Start external execution',
  monitor_external_execution: 'Monitor external execution',
  await_external_execution: 'Wait for external execution',
  verify_evidence: 'Verify evidence',
  guarded_resource_creation: 'Create resource only after resolution',
};

const SIDE_EFFECT_CAPABILITIES = new Set<ToolCapability>([
  'write',
  'commit',
  'push',
  'deploy',
  'monitor',
  'wait',
  'verify',
]);
const DIRECT_CATEGORY_CAPABILITIES = new Set<ToolCapability>([
  'discover',
  'read',
  'write',
  'commit',
  'push',
  'deploy',
  'coordinate',
  'compute',
]);
const PASSIVE_EXTERNAL_OBSERVATION_CAPABILITIES = new Set<ToolCapability>([
  'monitor',
  'wait',
  'verify',
]);

const NON_SPECIFIC_EVIDENCE_KINDS = new Set(['verification', 'blocker']);
const REQUIRED_OBSERVED_CAPABILITIES = new Set<ToolCapability>([
  'write',
  'commit',
  'push',
  'deploy',
]);
const EVIDENCE_REQUIRED_WORKFLOW_STAGES = new Set<ToolWorkflowStage>([
  'discover_resource',
  'inspect_resource',
  'prepare_artifact',
  'persist_artifact',
  'mutate_remote_state',
  'start_external_execution',
  'monitor_external_execution',
  'await_external_execution',
  'verify_evidence',
  'guarded_resource_creation',
]);
const MAX_UNCORRELATED_EXTERNAL_MONITOR_OBSERVATIONS = 3;
const MAX_REPEATED_UNCORRELATED_EXTERNAL_MONITOR_OBSERVATIONS = 2;
const MAX_PATH_LIKE_FACTS = 24;
const FAILED_TERMINAL_STATES = new Set([
  'failure',
  'failed',
  'error',
  'cancelled',
  'canceled',
  'timed_out',
  'timeout',
]);
const SUCCESSFUL_TERMINAL_STATES = new Set([
  'completed',
  'complete',
  'success',
  'succeeded',
  'passed',
]);

function uniqueStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter((value) => value.trim().length > 0)));
}

function normalizeCategory(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

function descriptorRequiresExecution(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.some((sideEffect) => sideEffect !== 'none') ||
    descriptor.capabilities.some((capability) => SIDE_EFFECT_CAPABILITIES.has(capability)) ||
    descriptor.providesEvidence.length > 0
  );
}

function descriptorNeedsResourceResolution(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptorRequiresExecution(descriptor) ||
    descriptor.workflowStages.some(
      (stage) => stage !== 'discover_resource' && stage !== 'inspect_resource',
    );
}

function addResourceResolutionRequirements(
  requirements: ToolCapabilityRequirement[],
  descriptor: ToolCapabilityDescriptor,
  availableDescriptors?: ReadonlyArray<ToolCapabilityDescriptor>,
): void {
  if (!descriptorNeedsResourceResolution(descriptor)) {
    return;
  }

  for (const resourceKind of descriptor.resourceKinds) {
    if (resourceKind === 'unknown') {
      continue;
    }
    const canDiscover =
      !availableDescriptors ||
      availableDescriptors.some(
        (candidate) =>
          candidate.category === descriptor.category &&
          candidate.resourceKinds.includes(resourceKind) &&
          candidate.capabilities.includes('discover') &&
          candidate.workflowStages.includes('discover_resource'),
      );
    const canRead =
      !availableDescriptors ||
      availableDescriptors.some(
        (candidate) =>
          candidate.category === descriptor.category &&
          candidate.resourceKinds.includes(resourceKind) &&
          candidate.capabilities.includes('read') &&
          candidate.workflowStages.includes('inspect_resource'),
      );
    if (canDiscover) {
      requirements.push({
        category: descriptor.category,
        capability: 'discover',
        resourceKind,
        workflowStage: 'discover_resource',
      });
    }
    if (canRead) {
      requirements.push({
        category: descriptor.category,
        capability: 'read',
        resourceKind,
        workflowStage: 'inspect_resource',
      });
    }
  }
}

function descriptorProvidesSpecificEvidence(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptor.providesEvidence.some(
    (evidenceKind) => !NON_SPECIFIC_EVIDENCE_KINDS.has(evidenceKind),
  );
}

function getSpecificEvidenceKinds(descriptor: ToolCapabilityDescriptor): ToolEvidenceKind[] {
  return descriptor.providesEvidence.filter(
    (evidenceKind) => !NON_SPECIFIC_EVIDENCE_KINDS.has(evidenceKind),
  );
}

function addDescriptorWorkflowRequirements(
  requirements: ToolCapabilityRequirement[],
  descriptor: ToolCapabilityDescriptor,
  options?: {
    capabilities?: ReadonlySet<ToolCapability>;
    stages?: ReadonlySet<ToolWorkflowStage>;
    requireSpecificEvidence?: boolean;
  },
): void {
  const capabilities = descriptor.capabilities.filter(
    (capability) =>
      SIDE_EFFECT_CAPABILITIES.has(capability) &&
      (!options?.capabilities || options.capabilities.has(capability)),
  );
  const stages = descriptor.workflowStages.filter(
    (stage) => !options?.stages || options.stages.has(stage),
  );
  const evidenceKinds = options?.requireSpecificEvidence
    ? getSpecificEvidenceKinds(descriptor)
    : [undefined];

  if (options?.requireSpecificEvidence && evidenceKinds.length === 0) {
    return;
  }

  for (const stage of stages) {
    for (const capability of capabilities) {
      for (const evidenceKind of evidenceKinds) {
        requirements.push({
          category: descriptor.category,
          capability,
          evidenceKind,
          workflowStage: stage,
        });
      }
    }
  }
}

function descriptorIsPassiveExternalEvidenceDescriptor(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptorProvidesSpecificEvidence(descriptor) &&
    descriptor.capabilities.some((capability) =>
      PASSIVE_EXTERNAL_OBSERVATION_CAPABILITIES.has(capability),
    ) &&
    descriptor.workflowStages.some(
      (stage) => stage === 'monitor_external_execution' || stage === 'await_external_execution',
    )
  );
}

function descriptorObservesWorkflowLikeExternalEvidence(
  descriptor: ToolCapabilityDescriptor,
): boolean {
  if (!descriptorIsPassiveExternalEvidenceDescriptor(descriptor)) {
    return false;
  }

  return [...descriptor.resourceKinds, ...descriptor.providesEvidence].some((value) =>
    String(value).toLowerCase().includes('workflow'),
  );
}

function descriptorCanProduceExternalExecution(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.includes('external_run') ||
    descriptor.workflowStages.includes('start_external_execution')
  );
}

function descriptorHasUnguardedRemoteMutation(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.includes('remote_mutation') &&
    !descriptor.workflowStages.includes('guarded_resource_creation')
  );
}

function addCategoryExecutionLifecycleRequirements(
  requirements: ToolCapabilityRequirement[],
  categories: ReadonlyArray<string>,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  plannedDescriptors: ReadonlyArray<ToolCapabilityDescriptor>,
  passiveMonitorCategories: ReadonlyArray<string> = categories,
): void {
  const registry = buildToolCapabilityRegistry(tools);

  for (const category of categories) {
    const descriptors = Array.from(registry.values()).filter(
      (descriptor) => normalizeCategory(descriptor.category) === category,
    );

    for (const descriptor of descriptors) {
      addResourceResolutionRequirements(requirements, descriptor, descriptors);
    }

    const hasLocalArtifactWriter = descriptors.some(
      (descriptor) =>
        descriptor.sideEffects.includes('local_artifact') &&
        descriptor.capabilities.includes('write'),
    );
    if (hasLocalArtifactWriter) {
      requirements.push({
        category,
        capability: 'write',
        resourceKind: 'conversation_workspace',
        workflowStage: 'prepare_artifact',
      });
      requirements.push({
        category,
        capability: 'write',
        resourceKind: 'conversation_workspace',
        workflowStage: 'persist_artifact',
      });
    }

    const remoteMutationDescriptors = descriptors.filter(
      (descriptor) =>
        descriptorHasUnguardedRemoteMutation(descriptor) &&
        descriptorProvidesSpecificEvidence(descriptor),
    );
    for (const descriptor of remoteMutationDescriptors) {
      addDescriptorWorkflowRequirements(requirements, descriptor, {
        stages: new Set(['persist_artifact', 'mutate_remote_state', 'verify_evidence']),
        requireSpecificEvidence: true,
      });
    }

    const externalEvidenceDescriptors = descriptors.filter(
      (descriptor) =>
        descriptorIsPassiveExternalEvidenceDescriptor(descriptor) &&
        shouldRequirePassiveExternalEvidenceDescriptor(
          category,
          descriptor,
          plannedDescriptors,
          descriptors,
          Array.from(registry.values()),
          passiveMonitorCategories,
        ),
    );
    for (const descriptor of externalEvidenceDescriptors) {
      addDescriptorWorkflowRequirements(requirements, descriptor, {
        capabilities: new Set(['monitor', 'wait', 'verify']),
        stages: new Set([
          'monitor_external_execution',
          'await_external_execution',
          'verify_evidence',
        ]),
        requireSpecificEvidence: true,
      });
    }
  }
}

function descriptorHasExecutionProducerSideEffect(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptor.sideEffects.some(
    (sideEffect) =>
      sideEffect === 'local_artifact' ||
      sideEffect === 'remote_mutation' ||
      sideEffect === 'external_run',
  );
}

function descriptorIsConversationScopedOnly(descriptor: ToolCapabilityDescriptor): boolean {
  return descriptor.resourceKinds.every(
    (resourceKind) => resourceKind === 'conversation_workspace' || resourceKind === 'unknown',
  );
}

function shouldRequirePassiveExternalEvidenceDescriptor(
  category: string,
  descriptor: ToolCapabilityDescriptor,
  plannedDescriptors: ReadonlyArray<ToolCapabilityDescriptor>,
  categoryDescriptors: ReadonlyArray<ToolCapabilityDescriptor>,
  availableDescriptors: ReadonlyArray<ToolCapabilityDescriptor>,
  requiredCategories: ReadonlyArray<string>,
): boolean {
  const plannedDescriptorNames = new Set(plannedDescriptors.map((candidate) => candidate.name));
  if (plannedDescriptorNames.has(descriptor.name)) {
    const currentCategoryHasRemoteMutation = categoryDescriptors.some(
      descriptorHasUnguardedRemoteMutation,
    );
    const currentCategoryHasExternalProducer = categoryDescriptors.some(
      (candidate) =>
        descriptorCanProduceExternalExecution(candidate) &&
        descriptorProvidesSpecificEvidence(candidate),
    );
    const requiredCategorySet = new Set(requiredCategories);
    const hasDedicatedExternalMonitor = availableDescriptors.some((candidate) => {
      const candidateCategory = normalizeCategory(candidate.category);
      if (
        !candidateCategory ||
        candidateCategory === category ||
        !requiredCategorySet.has(candidateCategory)
      ) {
        return false;
      }
      if (!descriptorObservesWorkflowLikeExternalEvidence(candidate)) {
        return false;
      }
      if (
        descriptorObservesWorkflowLikeExternalEvidence(descriptor) &&
        !descriptorObservesWorkflowLikeExternalEvidence(candidate)
      ) {
        return false;
      }
      const candidateCategoryDescriptors = availableDescriptors.filter(
        (available) => normalizeCategory(available.category) === candidateCategory,
      );
      const candidateCategoryHasRemoteMutation = candidateCategoryDescriptors.some(
        descriptorHasUnguardedRemoteMutation,
      );
      const candidateCategoryHasExternalProducer = candidateCategoryDescriptors.some(
        (available) =>
          descriptorCanProduceExternalExecution(available) &&
          descriptorProvidesSpecificEvidence(available),
      );
      return !candidateCategoryHasRemoteMutation || candidateCategoryHasExternalProducer;
    });
    if (
      requiredCategories.length > 1 &&
      currentCategoryHasRemoteMutation &&
      !currentCategoryHasExternalProducer &&
      hasDedicatedExternalMonitor
    ) {
      return false;
    }
    return true;
  }

  if (!descriptorIsConversationScopedOnly(descriptor)) {
    const hasPlannedSameCategoryProducer = plannedDescriptors.some(
      (plannedDescriptor) =>
        normalizeCategory(plannedDescriptor.category) === category &&
        descriptorCanProduceExternalExecution(plannedDescriptor) &&
        descriptorProvidesSpecificEvidence(plannedDescriptor),
    );
    if (hasPlannedSameCategoryProducer) {
      return true;
    }

    const hasSameCategoryExternalProducer = categoryDescriptors.some(
      (candidate) =>
        descriptorCanProduceExternalExecution(candidate) &&
        descriptorProvidesSpecificEvidence(candidate),
    );
    if (hasSameCategoryExternalProducer) {
      return true;
    }

    const hasSameCategoryRemoteMutation = categoryDescriptors.some(
      descriptorHasUnguardedRemoteMutation,
    );
    if (!hasSameCategoryRemoteMutation) {
      return true;
    }

    // A mutating family can still be the intended external monitor when it is
    // the only selected family. In mixed workflows, require an explicit planner
    // selection before treating that family's passive monitors as deployment
    // evidence, so "commit to repo" does not imply "monitor repo-hosted CI".
    return requiredCategories.length <= 1;
  }

  return plannedDescriptors.some(
    (plannedDescriptor) =>
      normalizeCategory(plannedDescriptor.category) === category &&
      descriptorHasExecutionProducerSideEffect(plannedDescriptor) &&
      descriptorProvidesSpecificEvidence(plannedDescriptor),
  );
}

function getPlannedToolDescriptors(signal: WorkflowRoutePlannerSignal): ToolCapabilityDescriptor[] {
  return Array.from(signal.plannedToolNames ?? [])
    .map((toolName) => findToolDescriptorByName(signal.tools, toolName))
    .filter((descriptor): descriptor is ToolCapabilityDescriptor => Boolean(descriptor));
}

function buildCapabilityRequirements(
  signal: WorkflowRoutePlannerSignal,
  plannedDescriptors: ToolCapabilityDescriptor[],
): ToolCapabilityRequirement[] {
  const requirements: ToolCapabilityRequirement[] = [];
  const requiredCategories = Array.from(signal.requiredToolCategories ?? [])
    .map(normalizeCategory)
    .filter((category): category is string => Boolean(category));
  const effectivePassiveMonitorCategories = uniqueStrings([
    ...requiredCategories,
    ...plannedDescriptors
      .map((descriptor) => normalizeCategory(descriptor.category))
      .filter((category): category is string => Boolean(category)),
  ]);
  const availableDescriptors = Array.from(buildToolCapabilityRegistry(signal.tools).values());

  for (const capability of signal.requiredCapabilities ?? []) {
    if (DIRECT_CATEGORY_CAPABILITIES.has(capability)) {
      if (requiredCategories.length > 0) {
        for (const category of requiredCategories) {
          requirements.push({ category, capability });
        }
      } else {
        requirements.push({ capability });
      }
    }
  }

  if (signal.routeMode === 'execution') {
    addCategoryExecutionLifecycleRequirements(
      requirements,
      requiredCategories,
      signal.tools,
      plannedDescriptors,
      effectivePassiveMonitorCategories,
    );
  }

  for (const descriptor of plannedDescriptors) {
    if (!descriptorRequiresExecution(descriptor)) {
      continue;
    }
    const plannedCategory = normalizeCategory(descriptor.category);
    if (plannedCategory && descriptorIsPassiveExternalEvidenceDescriptor(descriptor)) {
      const categoryDescriptors = availableDescriptors.filter(
        (candidate) => normalizeCategory(candidate.category) === plannedCategory,
      );
      if (
        !shouldRequirePassiveExternalEvidenceDescriptor(
          plannedCategory,
          descriptor,
          plannedDescriptors,
          categoryDescriptors,
          availableDescriptors,
          effectivePassiveMonitorCategories,
        )
      ) {
        continue;
      }
    }
    addResourceResolutionRequirements(requirements, descriptor, availableDescriptors);
    const plannedCategoryIsRequired =
      !!plannedCategory && requiredCategories.includes(plannedCategory);
    const descriptorContributesWorkflowStage = descriptor.workflowStages.length > 0;
    for (const capability of descriptor.capabilities) {
      if (
        SIDE_EFFECT_CAPABILITIES.has(capability) &&
        (plannedCategoryIsRequired || descriptorContributesWorkflowStage)
      ) {
        requirements.push({ category: descriptor.category, capability });
      }
    }
    for (const workflowStage of descriptor.workflowStages) {
      requirements.push({ category: descriptor.category, workflowStage });
    }
  }

  return requirements;
}

function dedupeRequirements(
  requirements: ReadonlyArray<ToolCapabilityRequirement>,
): ToolCapabilityRequirement[] {
  const seen = new Set<string>();
  const deduped: ToolCapabilityRequirement[] = [];
  for (const requirement of requirements) {
    const key = JSON.stringify({
      category: requirement.category,
      capability: requirement.capability,
      resourceKind: requirement.resourceKind,
      evidenceKind: requirement.evidenceKind,
      workflowStage: requirement.workflowStage,
    });
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(requirement);
  }
  return deduped;
}

function buildWorkflowPhasesFromDescriptors(
  descriptors: ReadonlyArray<ToolCapabilityDescriptor>,
  requirements: ReadonlyArray<ToolCapabilityRequirement>,
): WorkflowRoutePhaseSpec[] {
  const stages = new Set<ToolWorkflowStage>();
  for (const requirement of requirements) {
    if (requirement.workflowStage) {
      stages.add(requirement.workflowStage);
    }
  }
  for (const descriptor of descriptors) {
    for (const stage of descriptor.workflowStages) {
      stages.add(stage);
    }
  }

  return STAGE_ORDER
    .filter((stage) => stages.has(stage))
    .map((stage) => ({
      id: stage,
      title: STAGE_TITLES[stage],
      stage,
      requiredCapabilities: requirements.filter(
        (requirement) => requirement.workflowStage === stage,
      ),
    }));
}

function buildGenericWorkflowGuidance(params: {
  requiredCapabilities: ReadonlySet<ToolCapability>;
  requiredCategories: ReadonlySet<string>;
  requiredToolNames: string[];
}): string {
  const capabilities = Array.from(params.requiredCapabilities);
  const categories = Array.from(params.requiredCategories).filter(Boolean);
  return [
    '## Active Capability Workflow',
    'Treat tool use as a capability graph, not a keyword match. Complete the user-visible side effects and collect evidence from tools whose contracts cover the required capabilities.',
    capabilities.length > 0
      ? `Required capabilities: ${capabilities.join(', ')}.`
      : 'No explicit required capabilities were emitted; infer next actions from the selected tool contracts and verified evidence.',
    categories.length > 0
      ? `Required tool families: ${categories.join(', ')}.`
      : undefined,
    params.requiredToolNames.length > 0
      ? `Contract-matched tools available this turn: ${params.requiredToolNames.join(', ')}.`
      : 'A required capability is not loaded yet. Use the capability catalog to discover an exact tool instead of guessing.',
    'A local artifact or read-only result cannot satisfy a requested remote mutation, external execution, or verification unless a tool result explicitly provides that evidence.',
    'Use guarded resource-creation tools only after resource discovery cannot resolve an existing suitable resource or the user explicitly requested a new resource.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function resolveWorkflowRouteActivation(
  signal: WorkflowRoutePlannerSignal,
): WorkflowRouteActivation | undefined {
  if (signal.routeMode !== 'execution') {
    return undefined;
  }

  const plannedDescriptors = getPlannedToolDescriptors(signal);
  const registry = buildToolCapabilityRegistry(signal.tools);
  const initialRequirements = dedupeRequirements(buildCapabilityRequirements(signal, plannedDescriptors));
  const initialSelectedToolNames = selectToolNamesForCapabilityRequirements(
    signal.tools,
    initialRequirements,
  );
  const initialSelectedDescriptors = initialSelectedToolNames
    .map((toolName) => registry.get(normalizeToolName(toolName)))
    .filter((descriptor): descriptor is ToolCapabilityDescriptor => Boolean(descriptor));
  const requirements = dedupeRequirements([
    ...initialRequirements,
    ...initialSelectedDescriptors.flatMap((descriptor) => {
      const addedRequirements: ToolCapabilityRequirement[] = [];
      addResourceResolutionRequirements(addedRequirements, descriptor, Array.from(registry.values()));
      return addedRequirements;
    }),
  ]);
  const selectedToolNames = selectToolNamesForCapabilityRequirements(signal.tools, requirements);
  const selectedDescriptors = selectedToolNames
    .map((toolName) => registry.get(normalizeToolName(toolName)))
    .filter((descriptor): descriptor is ToolCapabilityDescriptor => Boolean(descriptor));
  const allDescriptors = [...plannedDescriptors, ...selectedDescriptors];
  const hasExecutionRequirement =
    requirements.some((requirement) =>
      requirement.capability ? SIDE_EFFECT_CAPABILITIES.has(requirement.capability) : false,
    ) || allDescriptors.some(descriptorRequiresExecution);

  if (!hasExecutionRequirement) {
    return undefined;
  }

  const phases = buildWorkflowPhasesFromDescriptors(allDescriptors, requirements);
  if (phases.length === 0) {
    return undefined;
  }
  const requirementIndex = buildWorkflowRequirementIndex({
    phases,
    selectedDescriptors: allDescriptors,
  });

  const requiredCategories = new Set(
    Array.from(signal.requiredToolCategories ?? [])
      .map(normalizeCategory)
      .filter((category): category is string => Boolean(category)),
  );

  return {
    routeId: 'capability-workflow',
    title: 'Capability workflow',
    phases,
    requiredToolNames: selectedToolNames,
    ...requirementIndex,
    guidance: buildGenericWorkflowGuidance({
      requiredCapabilities: signal.requiredCapabilities ?? new Set<ToolCapability>(),
      requiredCategories,
      requiredToolNames: selectedToolNames,
    }),
  };
}

export function buildInitialWorkflowRouteState(
  activation: WorkflowRouteActivation,
  timestamp: number,
): AgentRunRouteState {
  const phases = activation.phases.map((phase, index) => ({
    id: phase.id,
    title: phase.title,
    status: index === 0 ? ('active' as const) : ('pending' as const),
    requiredCapabilities: phase.requiredCapabilities.map((requirement) => ({ ...requirement })),
    updatedAt: timestamp,
  }));

  return {
    routeId: activation.routeId,
    title: activation.title,
    status: 'active',
    currentPhaseId: phases[0]?.id ?? 'capability-workflow',
    phases,
    requiredToolNames: activation.requiredToolNames,
    facts: {
      requiredWorkflowRequirementKeys: [...activation.requiredWorkflowRequirementKeys],
      workflowRequirementLabelsByKey: { ...activation.workflowRequirementLabelsByKey },
      workflowRequirementToolNamesByKey: Object.fromEntries(
        Object.entries(activation.workflowRequirementToolNamesByKey).map(([key, value]) => [
          key,
          [...value],
        ]),
      ),
    },
    updatedAt: timestamp,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function collectStringValues(value: unknown, result: string[] = []): string[] {
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringValues(entry, result);
    }
    return result;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      collectStringValues(entry, result);
    }
  }

  return result;
}

function normalizeResourcePath(value: string): string | undefined {
  const trimmed = value.trim().replace(/^["']|["']$/g, '').replace(/^\/+/, '');
  if (
    !trimmed ||
    trimmed.length > 240 ||
    /\s/.test(trimmed) ||
    /:/.test(trimmed) ||
    /^[a-z]+:\/\//i.test(trimmed)
  ) {
    return undefined;
  }

  if (!/[/.]/.test(trimmed)) {
    return undefined;
  }

  return trimmed.replace(/\\/g, '/');
}

function isLikelyFileResourcePath(path: string): boolean {
  const basename = pathBasename(path);
  return /^[^.]+\.[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(basename);
}

function extractPathLikeStrings(value: unknown): string[] {
  return uniqueStrings(
    collectStringValues(value)
      .map(normalizeResourcePath)
      .filter((path): path is string => Boolean(path)),
  );
}

function extractFileResourcePathStrings(value: unknown): string[] {
  return extractPathLikeStrings(value).filter(isLikelyFileResourcePath);
}

function pathBasename(path: string): string {
  return path.split('/').filter(Boolean).pop() || path;
}

function resourcePathsOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeResourcePath(left);
  const normalizedRight = normalizeResourcePath(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.endsWith(`/${normalizedRight}`) ||
    normalizedRight.endsWith(`/${normalizedLeft}`) ||
    pathBasename(normalizedLeft) === pathBasename(normalizedRight)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getStringOrNumber(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return getString(value);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function readStringArrayFact(facts: Record<string, unknown> | undefined, key: string): string[] {
  const value = facts?.[key];
  return Array.isArray(value)
    ? uniqueStrings(value.filter((entry): entry is string => typeof entry === 'string'))
    : [];
}

function readBlockedWorkflowToolNames(state: AgentRunRouteState | undefined): Set<string> {
  return new Set(
    readStringArrayFact(state?.facts, 'blockedWorkflowToolNames')
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );
}

function readBlockedWorkflowRequirementKeys(
  state: AgentRunRouteState | undefined,
): Set<string> {
  return new Set(readStringArrayFact(state?.facts, 'blockedWorkflowRequirementKeys'));
}

function getDescriptorForTool(
  toolName: string,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): ToolCapabilityDescriptor {
  return (
    findToolDescriptorByName(tools, toolName) ??
    inferToolCapabilityDescriptor({ name: normalizeToolName(toolName), description: toolName })
  );
}

function getWorkflowRunTerminalValues(parsed: Record<string, unknown>): unknown[] {
  const workflowRun = isRecord(parsed.workflowRun) ? parsed.workflowRun : undefined;
  return workflowRun ? [workflowRun.status, workflowRun.conclusion, workflowRun.state] : [];
}

function normalizeTerminalState(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().toLowerCase()
    : undefined;
}

function getTerminalStateValues(result: string): string[] {
  const parsed = parseJsonObject(result);
  if (!parsed) {
    return [];
  }

  const directValues = [parsed.status, parsed.conclusion, parsed.result, parsed.state];
  const runValues = getWorkflowRunRecords(result).flatMap((run) => [
    run.status,
    run.conclusion,
    run.result,
    run.state,
  ]);
  return uniqueStrings(
    [...directValues, ...runValues]
      .map(normalizeTerminalState)
      .filter((value): value is string => Boolean(value)),
  );
}

function resultHasFailedTerminalEvidence(result: string): boolean {
  return getTerminalStateValues(result).some((value) => FAILED_TERMINAL_STATES.has(value));
}

function resultHasSuccessfulTerminalEvidence(result: string): boolean {
  const terminalValues = getTerminalStateValues(result);
  const hasFailure = terminalValues.some((value) => FAILED_TERMINAL_STATES.has(value));
  if (hasFailure) {
    return false;
  }
  return terminalValues.some((value) => SUCCESSFUL_TERMINAL_STATES.has(value));
}

function resultHasTerminalEvidence(result: string): boolean {
  return getTerminalStateValues(result).some(
    (value) => FAILED_TERMINAL_STATES.has(value) || SUCCESSFUL_TERMINAL_STATES.has(value),
  );
}

type WorkflowResultDisposition =
  | { kind: 'ok' }
  | { kind: 'recoverable'; detail: string }
  | { kind: 'blocked'; detail: string };

const HARD_BLOCK_RESULT_STATES = new Set([
  'missing_configuration',
  'missing_permission',
  'permission_denied',
  'requires_approval',
  'unauthorized',
  'forbidden',
]);

function getHardBlockTextDetail(result: string): string | undefined {
  const normalized = result.trim();
  if (!normalized) {
    return undefined;
  }

  if (/\b(401|403)\b/.test(normalized)) {
    return summarizeToolResultDetail(normalized);
  }

  if (/(missing permission|permission denied|permission_denied|unauthorized|forbidden|requires approval|not accessible|access denied)/i.test(normalized)) {
    return summarizeToolResultDetail(normalized);
  }

  return undefined;
}

function summarizeToolResultDetail(result: string): string {
  const normalized = result.trim();
  return (normalized || 'Tool returned no usable result.').slice(0, 240);
}

function classifyWorkflowResultDisposition(
  result: string,
  status: WorkflowRouteToolResult['status'],
): WorkflowResultDisposition {
  if (status === 'failed') {
    const hardBlockDetail = getHardBlockTextDetail(result);
    return hardBlockDetail
      ? { kind: 'blocked', detail: hardBlockDetail }
      : { kind: 'recoverable', detail: summarizeToolResultDetail(result) };
  }

  const parsed = parseJsonObject(result);
  if (!parsed) {
    const hardBlockDetail = getHardBlockTextDetail(result);
    if (hardBlockDetail) {
      return { kind: 'blocked', detail: hardBlockDetail };
    }
    return result.trim().startsWith('Error:')
      ? { kind: 'recoverable', detail: summarizeToolResultDetail(result) }
      : { kind: 'ok' };
  }

  const state = [parsed.status, parsed.state, parsed.result, parsed.conclusion]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toLowerCase())
    .find((value) =>
      [
        'blocked',
        'error',
        'failed',
        'cancelled',
        'timed_out',
        'not_found',
        'ambiguous',
        'missing_configuration',
        'missing_permission',
        'permission_denied',
        'requires_approval',
        'unauthorized',
        'forbidden',
      ].includes(value),
    );
  if (!state) {
    return { kind: 'ok' };
  }

  const detail =
    typeof parsed.message === 'string'
      ? parsed.message
      : typeof parsed.guidance === 'string'
        ? parsed.guidance
        : typeof parsed.error === 'string'
          ? parsed.error
          : `Tool result status: ${state}`;

  if (HARD_BLOCK_RESULT_STATES.has(state)) {
    return { kind: 'blocked', detail: detail.slice(0, 240) };
  }

  if (
    (state === 'failed' || state === 'cancelled' || state === 'timed_out') &&
    resultHasTerminalEvidence(result) &&
    typeof parsed.error !== 'string'
  ) {
    return { kind: 'ok' };
  }

  return { kind: 'recoverable', detail: detail.slice(0, 240) };
}

function workflowRequirementKey(requirement: ToolCapabilityRequirement): string {
  return JSON.stringify({
    category: requirement.category,
    capability: requirement.capability,
    resourceKind: requirement.resourceKind,
    evidenceKind: requirement.evidenceKind,
    workflowStage: requirement.workflowStage,
  });
}

function workflowRequirementRequiresCompletionEvidence(
  requirement: ToolCapabilityRequirement,
): boolean {
  if (requirement.evidenceKind) {
    return true;
  }

  if (requirement.capability && SIDE_EFFECT_CAPABILITIES.has(requirement.capability)) {
    return true;
  }

  return requirement.workflowStage
    ? EVIDENCE_REQUIRED_WORKFLOW_STAGES.has(requirement.workflowStage)
    : false;
}

function formatWorkflowRequirementLabel(
  requirement: ToolCapabilityRequirement,
  phase?: WorkflowRoutePhaseSpec,
): string {
  return [
    phase?.title,
    requirement.category ? `category ${requirement.category}` : undefined,
    requirement.capability ? `capability ${requirement.capability}` : undefined,
    requirement.resourceKind ? `resource ${requirement.resourceKind}` : undefined,
    requirement.evidenceKind ? `evidence ${requirement.evidenceKind}` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' / ');
}

function buildWorkflowRequirementIndex(params: {
  phases: ReadonlyArray<WorkflowRoutePhaseSpec>;
  selectedDescriptors: ReadonlyArray<ToolCapabilityDescriptor>;
}): {
  requiredWorkflowRequirementKeys: string[];
  workflowRequirementLabelsByKey: Record<string, string>;
  workflowRequirementToolNamesByKey: Record<string, string[]>;
} {
  const keys: string[] = [];
  const labelsByKey: Record<string, string> = {};
  const toolNamesByKey: Record<string, string[]> = {};

  for (const phase of params.phases) {
    for (const requirement of phase.requiredCapabilities) {
      if (!workflowRequirementRequiresCompletionEvidence(requirement)) {
        continue;
      }

      const key = workflowRequirementKey(requirement);
      if (!keys.includes(key)) {
        keys.push(key);
      }
      labelsByKey[key] = labelsByKey[key] || formatWorkflowRequirementLabel(requirement, phase);
      const matchingToolNames = params.selectedDescriptors
        .filter((descriptor) => descriptorSatisfiesRequirement(descriptor, requirement))
        .map((descriptor) => descriptor.name)
        .filter(Boolean);
      toolNamesByKey[key] = uniqueStrings([...(toolNamesByKey[key] ?? []), ...matchingToolNames]);
    }
  }

  return {
    requiredWorkflowRequirementKeys: keys,
    workflowRequirementLabelsByKey: labelsByKey,
    workflowRequirementToolNamesByKey: toolNamesByKey,
  };
}

function readCompletedWorkflowRequirementKeys(state: AgentRunRouteState): Set<string> {
  const rawKeys = state.facts?.completedWorkflowRequirementKeys;
  return new Set(
    Array.isArray(rawKeys)
      ? rawKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
      : [],
  );
}

function readRequiredWorkflowRequirementKeys(state: AgentRunRouteState): string[] {
  const rawKeys = state.facts?.requiredWorkflowRequirementKeys;
  return Array.isArray(rawKeys)
    ? uniqueStrings(rawKeys.filter((key): key is string => typeof key === 'string'))
    : [];
}

function readWorkflowRequirementLabelsByKey(state: AgentRunRouteState): Record<string, string> {
  const rawLabels = state.facts?.workflowRequirementLabelsByKey;
  if (!rawLabels || typeof rawLabels !== 'object' || Array.isArray(rawLabels)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawLabels).filter(
      (entry): entry is [string, string] =>
        typeof entry[0] === 'string' && typeof entry[1] === 'string',
    ),
  );
}

function readWorkflowRequirementToolNamesByKey(
  state: AgentRunRouteState,
): Record<string, string[]> {
  const rawToolNames = state.facts?.workflowRequirementToolNamesByKey;
  if (!rawToolNames || typeof rawToolNames !== 'object' || Array.isArray(rawToolNames)) {
    return {};
  }

  const normalized: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawToolNames)) {
    if (!Array.isArray(value)) {
      continue;
    }
    normalized[key] = uniqueStrings(
      value.filter((toolName): toolName is string => typeof toolName === 'string'),
    );
  }
  return normalized;
}

function extractChangedFilesFromResult(result: string): string[] {
  const parsed = parseJsonObject(result);
  if (!parsed) {
    return [];
  }

  const directArrays = [parsed.changedFiles, parsed.files, parsed.filePaths, parsed.paths];
  const directFiles = directArrays.flatMap((value) =>
    Array.isArray(value)
      ? value
          .map((entry) => (typeof entry === 'string' ? entry : undefined))
          .filter((entry): entry is string => Boolean(entry?.trim()))
      : [],
  );
  const changeFiles = Array.isArray(parsed.changes)
    ? parsed.changes
        .filter(isRecord)
        .map((entry) => getString(entry.path) || getString(entry.filePath))
        .filter((entry): entry is string => Boolean(entry))
    : [];

  return uniqueStrings([...directFiles, ...changeFiles]).map((path) => path.replace(/^\/+/, ''));
}

function extractMissingWorkspacePath(result: string): string | undefined {
  const parsed = parseJsonObject(result);
  const parsedMessage =
    getString(parsed?.error) || getString(parsed?.message) || getString(parsed?.summary);
  const source = parsedMessage || result;
  const match = source.match(/file not found:\s*([^\n\r]+)/i);
  return match?.[1]?.trim().replace(/^["']|["']$/g, '') || undefined;
}

function getWorkflowRunRecords(result: string): Record<string, unknown>[] {
  const parsed = parseJsonObject(result);
  if (!parsed) {
    return [];
  }

  const workflowRun = isRecord(parsed.workflowRun) ? [parsed.workflowRun] : [];
  const singularRuns = [
    parsed.run,
    parsed.operation,
    parsed.externalRun,
    parsed.asyncOperation,
  ].filter(isRecord);
  const arrayRuns = [
    parsed.runs,
    parsed.workflowRuns,
    parsed.operations,
    parsed.externalRuns,
    parsed.asyncOperations,
  ].flatMap((value) => (Array.isArray(value) ? value.filter(isRecord) : []));
  return [...workflowRun, ...singularRuns, ...arrayRuns];
}

function extractMutationId(result: string): string | undefined {
  const parsed = parseJsonObject(result);
  if (!parsed) {
    return undefined;
  }
  const nestedSources = [parsed.commit, parsed.revision, parsed.mutation, parsed.run].filter(
    isRecord,
  );
  return (
    getStringOrNumber(parsed.mutationId) ||
    getStringOrNumber(parsed.revisionId) ||
    getStringOrNumber(parsed.runId) ||
    getStringOrNumber(parsed.sessionId) ||
    getStringOrNumber(parsed.operationId) ||
    getStringOrNumber(parsed.externalId) ||
    getStringOrNumber(parsed.resourceId) ||
    getStringOrNumber(parsed.id) ||
    getString(parsed.commitSha) ||
    getString(parsed.commitSHA) ||
    getString(parsed.sha) ||
    nestedSources
      .map(
        (source) =>
          getStringOrNumber(source.id) ||
          getString(source.sha) ||
          getString(source.oid) ||
          getString(source.commitSha),
      )
      .find(Boolean)
  );
}

function isPassiveWorkflowMonitorDescriptor(descriptor: ToolCapabilityDescriptor): boolean {
  return (
    descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    descriptor.capabilities.some((capability) =>
      capability === 'monitor' || capability === 'wait' || capability === 'verify',
    ) &&
    descriptor.workflowStages.some(
      (stage) => stage === 'monitor_external_execution' || stage === 'await_external_execution',
    )
  );
}

function workflowHasRequiredStage(
  state: AgentRunRouteState,
  stages: ReadonlySet<ToolWorkflowStage>,
): boolean {
  return readRequiredWorkflowRequirementKeys(state).some((key) => {
    const parsed = parseJsonObject(key);
    const stage = getString(parsed?.workflowStage) as ToolWorkflowStage | undefined;
    return Boolean(stage && stages.has(stage));
  });
}

function workflowRequiresExternalRunCorrelation(state: AgentRunRouteState): boolean {
  const hasExternalObservationRequirement = workflowHasRequiredStage(
    state,
    new Set(['monitor_external_execution', 'await_external_execution']),
  );
  const hasProducerRequirement = workflowHasRequiredStage(
    state,
    new Set(['mutate_remote_state', 'start_external_execution']),
  );
  return hasExternalObservationRequirement && hasProducerRequirement;
}

function workflowRunMatchesKnownMutation(
  run: Record<string, unknown>,
  facts: Record<string, unknown> | undefined,
): boolean {
  const runId = getStringOrNumber(run.id);
  const trackedRunId = getStringOrNumber(facts?.currentExternalWorkflowRunId);
  if (runId && trackedRunId && runId === trackedRunId) {
    return true;
  }

  const producerTimestamp =
    typeof facts?.latestExternalProducerAt === 'number'
      ? facts.latestExternalProducerAt
      : undefined;
  if (!producerTimestamp) {
    return false;
  }

  const createdAt = parseTimestamp(run.createdAt);
  if (createdAt !== undefined) {
    return createdAt >= producerTimestamp - 5_000;
  }

  const mutationId = getString(facts?.latestExternalProducerId);
  const runMutationId =
    getStringOrNumber(run.sourceMutationId) ||
    getStringOrNumber(run.mutationId) ||
    getStringOrNumber(run.revisionId) ||
    getStringOrNumber(run.sourceId) ||
    getString(run.headSha) ||
    getString(run.head_sha) ||
    getString(run.commitSha) ||
    getString(run.commit_sha);
  return Boolean(
    mutationId &&
      runMutationId &&
      (runMutationId === mutationId || runMutationId.startsWith(mutationId.slice(0, 12))),
  );
}

function getCorrelatedWorkflowRun(
  descriptor: ToolCapabilityDescriptor,
  result: string,
  facts: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!isPassiveWorkflowMonitorDescriptor(descriptor)) {
    return undefined;
  }

  return getWorkflowRunRecords(result).find((run) => workflowRunMatchesKnownMutation(run, facts));
}

function workflowHasKnownExternalRun(facts: Record<string, unknown> | undefined): boolean {
  return Boolean(getStringOrNumber(facts?.currentExternalWorkflowRunId));
}

function readUncorrelatedExternalMonitorCount(
  facts: Record<string, unknown> | undefined,
): number {
  return typeof facts?.uncorrelatedExternalMonitorCount === 'number'
    ? facts.uncorrelatedExternalMonitorCount
    : 0;
}

function readRepeatedUncorrelatedExternalMonitorCount(
  facts: Record<string, unknown> | undefined,
): number {
  return typeof facts?.repeatedUncorrelatedExternalMonitorCount === 'number'
    ? facts.repeatedUncorrelatedExternalMonitorCount
    : 0;
}

function buildUncorrelatedExternalMonitorBlocker(
  facts: Record<string, unknown> | undefined,
  toolName: string,
): string {
  const count = readUncorrelatedExternalMonitorCount(facts);
  const repeatedCount = readRepeatedUncorrelatedExternalMonitorCount(facts);
  const detail =
    typeof facts?.lastUncorrelatedExternalMonitorDetail === 'string'
      ? facts.lastUncorrelatedExternalMonitorDetail.trim()
      : '';
  return [
    `External execution could not be correlated to the current mutation after ${count} monitor observation${count === 1 ? '' : 's'} from ${toolName}.`,
    repeatedCount >= MAX_REPEATED_UNCORRELATED_EXTERNAL_MONITOR_OBSERVATIONS
      ? `The same uncorrelated monitor evidence repeated ${repeatedCount} times, so repeating the call is non-progress.`
      : undefined,
    'The observed external runs are stale, unrelated, or missing, so they are not valid evidence for this workflow.',
    'Use a tool that starts or returns the exact external run id, fix the trigger prerequisite, or report the trigger/correlation blocker instead of polling indefinitely.',
    detail ? `Last observation: ${detail}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join(' ');
}

interface ExternalMonitorDiagnostic {
  guidance: string;
  source?: string;
  expectedAfter?: string;
  branch?: string;
  configPaths: string[];
  autoTriggerOnSourceMutation?: boolean;
}

function normalizeBranchReference(value: string): string | undefined {
  const trimmed = value.trim().replace(/^["']|["']$/g, '');
  if (
    !trimmed ||
    trimmed.length > 180 ||
    /\s/.test(trimmed) ||
    /^[a-z]+:\/\//i.test(trimmed) ||
    /^[0-9a-f]{7,40}$/i.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed
    .replace(/^refs\/heads\//i, '')
    .replace(/^origin\//i, '')
    .replace(/^heads\//i, '');
}

function branchReferencesEqual(left: string, right: string): boolean {
  const normalizedLeft = normalizeBranchReference(left);
  const normalizedRight = normalizeBranchReference(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      normalizedLeft.toLowerCase() === normalizedRight.toLowerCase(),
  );
}

const BRANCH_ARGUMENT_KEYS = new Set([
  'branch',
  'basebranch',
  'targetbranch',
  'sourcebranch',
  'headbranch',
  'frombranch',
  'tobranch',
]);

function collectBranchReferenceArguments(value: unknown, result: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectBranchReferenceArguments(entry, result);
    }
    return result;
  }

  if (!isRecord(value)) {
    return result;
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (BRANCH_ARGUMENT_KEYS.has(normalizedKey)) {
      if (typeof entry === 'string') {
        const branch = normalizeBranchReference(entry);
        if (branch) {
          result.push(branch);
        }
      }
      continue;
    }
    collectBranchReferenceArguments(entry, result);
  }

  return result;
}

function descriptorCanSatisfyTriggerExpectedAfter(
  descriptor: ToolCapabilityDescriptor,
  expectedAfter: string | undefined,
): boolean {
  const expected = expectedAfter?.trim().toLowerCase();
  if (!expected) {
    return true;
  }

  return (
    descriptor.capabilities.some((capability) => capability.toLowerCase() === expected) ||
    descriptor.providesEvidence.some((evidenceKind) =>
      evidenceKind.toLowerCase().includes(expected),
    ) ||
    descriptor.sideEffects.some((sideEffect) => sideEffect.toLowerCase().includes(expected))
  );
}

function extractExternalMonitorDiagnostic(result: string): ExternalMonitorDiagnostic | undefined {
  const parsed = parseJsonObject(result);
  if (!parsed) {
    return undefined;
  }

  const trigger = isRecord(parsed.trigger) ? parsed.trigger : undefined;
  if (!trigger) {
    return undefined;
  }

  const source = getString(trigger.source);
  const expectedAfter = getString(trigger.expectedAfter);
  const branch = getString(trigger.branch);
  const normalizedBranch = branch ? normalizeBranchReference(branch) : undefined;
  const configPaths = readStringArrayFact(trigger, 'configPaths');
  const autoTriggerOnSourceMutation =
    typeof trigger.autoTriggerOnSourceMutation === 'boolean'
      ? trigger.autoTriggerOnSourceMutation
      : undefined;
  const triggerLines = [
    source ? `Source: ${source}.` : undefined,
    expectedAfter ? `Expected after: ${expectedAfter}.` : undefined,
    normalizedBranch ? `Branch: ${normalizedBranch}.` : undefined,
    configPaths.length > 0 ? `Config paths: ${configPaths.join(', ')}.` : undefined,
  ].filter((line): line is string => Boolean(line));
  if (triggerLines.length === 0) {
    return undefined;
  }

  const lines: string[] = [];
  const note = typeof parsed.note === 'string' ? parsed.note.trim() : '';
  const guidance = typeof parsed.guidance === 'string' ? parsed.guidance.trim() : '';
  if (note) {
    lines.push(note);
  }
  if (guidance && guidance !== note) {
    lines.push(guidance);
  }

  lines.push(triggerLines.join(' '));

  const diagnosticGuidance = uniqueStrings(lines).join(' ').slice(0, 800);
  return diagnosticGuidance
    ? {
        guidance: diagnosticGuidance,
        source,
        expectedAfter,
        branch: normalizedBranch,
        configPaths,
        autoTriggerOnSourceMutation,
      }
    : undefined;
}

function workflowNeedsExternalRunCorrelationDiagnostic(
  state: AgentRunRouteState | undefined,
): boolean {
  return state?.facts?.externalRunCorrelationDiagnosticRequired === true;
}

function passiveWaitRequiresKnownExternalRun(
  state: AgentRunRouteState,
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    workflowRequiresExternalRunCorrelation(state) &&
    isPassiveWorkflowMonitorDescriptor(descriptor) &&
    descriptor.capabilities.includes('wait') &&
    descriptor.workflowStages.includes('await_external_execution') &&
    !workflowHasKnownExternalRun(state.facts)
  );
}

function passiveTerminalMonitorRequiresKnownExternalRun(
  state: AgentRunRouteState,
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    workflowRequiresExternalRunCorrelation(state) &&
    isPassiveWorkflowMonitorDescriptor(descriptor) &&
    !workflowHasKnownExternalRun(state.facts) &&
    (
      descriptor.capabilities.includes('wait') ||
      descriptor.workflowStages.includes('await_external_execution') ||
      descriptor.providesEvidence.some((evidenceKind) => evidenceKind.includes('terminal'))
    )
  );
}

function passiveConversationMonitorRequiresKnownExternalRun(
  state: AgentRunRouteState,
  descriptor: ToolCapabilityDescriptor,
): boolean {
  return (
    workflowRequiresExternalRunCorrelation(state) &&
    descriptorIsConversationScopedOnly(descriptor) &&
    isPassiveWorkflowMonitorDescriptor(descriptor) &&
    !workflowHasKnownExternalRun(state.facts)
  );
}

function shouldSuppressWorkflowToolForState(
  state: AgentRunRouteState,
  toolName: string,
  descriptor: ToolCapabilityDescriptor,
): boolean {
  const normalizedToolName = normalizeToolName(toolName);
  if (readBlockedWorkflowToolNames(state).has(normalizedToolName)) {
    return true;
  }

  if (
    workflowNeedsExternalRunCorrelationDiagnostic(state) &&
    isPassiveWorkflowMonitorDescriptor(descriptor)
  ) {
    return true;
  }

  return (
    passiveWaitRequiresKnownExternalRun(state, descriptor) ||
    passiveTerminalMonitorRequiresKnownExternalRun(state, descriptor) ||
    passiveConversationMonitorRequiresKnownExternalRun(state, descriptor)
  );
}

function passiveWorkflowMonitorCanAdvance(params: {
  state: AgentRunRouteState;
  descriptor: ToolCapabilityDescriptor;
  requirement: ToolCapabilityRequirement;
  toolResult: WorkflowRouteToolResult;
  facts: Record<string, unknown>;
}): boolean {
  if (!isPassiveWorkflowMonitorDescriptor(params.descriptor)) {
    return true;
  }

  if (
    ![
      'monitor_external_execution',
      'await_external_execution',
      'verify_evidence',
    ].includes(params.requirement.workflowStage || '')
  ) {
    return true;
  }

  if (!workflowRequiresExternalRunCorrelation(params.state)) {
    return true;
  }

  const correlatedRun = getCorrelatedWorkflowRun(
    params.descriptor,
    params.toolResult.result,
    params.facts,
  );
  if (!correlatedRun) {
    return false;
  }

  if (
    (params.requirement.workflowStage === 'await_external_execution' ||
      params.requirement.workflowStage === 'verify_evidence') &&
    params.descriptor.capabilities.includes('wait') &&
    !resultHasTerminalEvidence(params.toolResult.result)
  ) {
    return false;
  }

  return true;
}

function updateWorkflowFactsFromSuccessfulToolResult(params: {
  state: AgentRunRouteState;
  descriptor: ToolCapabilityDescriptor;
  toolResult: WorkflowRouteToolResult;
  facts: Record<string, unknown>;
}): Record<string, unknown> {
  const facts = { ...params.facts };

  if (
    params.descriptor.resourceKinds.some(
      (resourceKind) => resourceKind === 'eas_workflow' || resourceKind === 'github_workflow',
    ) ||
    params.descriptor.providesEvidence.includes('expo_project_ready')
  ) {
    const workflowConfigPaths = extractFileResourcePathStrings(parseJsonObject(params.toolResult.result))
      .slice(0, MAX_PATH_LIKE_FACTS);
    if (workflowConfigPaths.length > 0) {
      facts.observedExternalWorkflowConfigPaths = uniqueStrings([
        ...readStringArrayFact(facts, 'observedExternalWorkflowConfigPaths'),
        ...workflowConfigPaths,
      ]).slice(-MAX_PATH_LIKE_FACTS);
    }
  }

  if (
    params.descriptor.sideEffects.some(
      (sideEffect) => sideEffect === 'remote_mutation' || sideEffect === 'external_run',
    )
  ) {
    const mutationId = extractMutationId(params.toolResult.result);
    const changedFiles = extractChangedFilesFromResult(params.toolResult.result);
    facts.latestExternalProducerToolName = params.toolResult.toolName;
    facts.latestExternalProducerAt = params.toolResult.timestamp;
    facts.uncorrelatedExternalMonitorCount = 0;
    facts.repeatedUncorrelatedExternalMonitorCount = 0;
    delete facts.lastUncorrelatedExternalMonitorToolName;
    delete facts.lastUncorrelatedExternalMonitorDetail;
    delete facts.lastUncorrelatedExternalMonitorSignature;
    delete facts.lastUncorrelatedExternalMonitorAt;
    delete facts.externalRunCorrelationDiagnosticRequired;
    delete facts.externalRunCorrelationDiagnosticSourceToolName;
    delete facts.externalRunCorrelationDiagnosticGuidance;
    delete facts.externalRunCorrelationDiagnosticReason;
    delete facts.externalRunCorrelationDiagnosticInspectionCount;
    delete facts.externalRunCorrelationLastDiagnosticToolName;
    delete facts.externalRunCorrelationLastDiagnosticAt;
    delete facts.externalRunCorrelationTriggerSource;
    delete facts.externalRunCorrelationTriggerExpectedAfter;
    delete facts.externalRunCorrelationTriggerBranch;
    delete facts.externalRunCorrelationTriggerConfigPaths;
    delete facts.externalRunCorrelationAutoTriggerOnSourceMutation;
    if (mutationId) {
      facts.latestExternalProducerId = mutationId;
      if (params.descriptor.sideEffects.includes('external_run')) {
        facts.currentExternalWorkflowRunId = mutationId;
        facts.currentExternalWorkflowRunToolName = params.toolResult.toolName;
        facts.currentExternalWorkflowRunCreatedAt = params.toolResult.timestamp;
      }
    }
    if (changedFiles.length > 0) {
      facts.latestExternalProducerChangedResources = changedFiles;
    }
  }

  if (
    params.descriptor.sideEffects.includes('local_artifact') &&
    params.descriptor.capabilities.includes('write')
  ) {
    const changedFiles = extractChangedFilesFromResult(params.toolResult.result);
    const localArtifactPaths = uniqueStrings([
      ...readStringArrayFact(facts, 'preparedLocalArtifactPaths'),
      ...changedFiles,
    ]).slice(-16);
    if (localArtifactPaths.length > 0) {
      facts.preparedLocalArtifactPaths = localArtifactPaths;
      facts.forceArtifactBootstrap = false;
    }
  }

  const correlatedRun = getCorrelatedWorkflowRun(
    params.descriptor,
    params.toolResult.result,
    facts,
  );
  if (correlatedRun) {
    const runId = getStringOrNumber(correlatedRun.id);
    const createdAt = parseTimestamp(correlatedRun.createdAt);
    if (runId) {
      facts.currentExternalWorkflowRunId = runId;
      facts.currentExternalWorkflowRunToolName = params.toolResult.toolName;
    }
    if (createdAt !== undefined) {
      facts.currentExternalWorkflowRunCreatedAt = createdAt;
    }
    facts.uncorrelatedExternalMonitorCount = 0;
    facts.repeatedUncorrelatedExternalMonitorCount = 0;
    delete facts.lastUncorrelatedExternalMonitorToolName;
    delete facts.lastUncorrelatedExternalMonitorDetail;
    delete facts.lastUncorrelatedExternalMonitorSignature;
    delete facts.lastUncorrelatedExternalMonitorAt;
  } else if (
    workflowRequiresExternalRunCorrelation(params.state) &&
    isPassiveWorkflowMonitorDescriptor(params.descriptor) &&
    typeof facts.latestExternalProducerAt === 'number'
  ) {
    const currentCount = readUncorrelatedExternalMonitorCount(params.state.facts);
    const detail = summarizeToolResultDetail(params.toolResult.result);
    const previousSignature =
      typeof params.state.facts?.lastUncorrelatedExternalMonitorSignature === 'string'
        ? params.state.facts.lastUncorrelatedExternalMonitorSignature
        : undefined;
    const previousToolName =
      typeof params.state.facts?.lastUncorrelatedExternalMonitorToolName === 'string'
        ? params.state.facts.lastUncorrelatedExternalMonitorToolName
        : undefined;
    const isRepeatedObservation =
      previousToolName === params.toolResult.toolName && previousSignature === detail;
    const previousRepeatedCount = readRepeatedUncorrelatedExternalMonitorCount(params.state.facts);
    facts.uncorrelatedExternalMonitorCount = currentCount + 1;
    facts.repeatedUncorrelatedExternalMonitorCount = isRepeatedObservation
      ? previousRepeatedCount + 1
      : 1;
    facts.lastUncorrelatedExternalMonitorToolName = params.toolResult.toolName;
    facts.lastUncorrelatedExternalMonitorDetail = detail;
    facts.lastUncorrelatedExternalMonitorSignature = detail;
    facts.lastUncorrelatedExternalMonitorAt = params.toolResult.timestamp;
    const diagnostic = extractExternalMonitorDiagnostic(params.toolResult.result);
    if (diagnostic) {
      facts.externalRunCorrelationDiagnosticRequired = true;
      facts.externalRunCorrelationDiagnosticSourceToolName = params.toolResult.toolName;
      facts.externalRunCorrelationDiagnosticGuidance = diagnostic.guidance;
      facts.externalRunCorrelationDiagnosticReason =
        'External monitor returned no run correlated to the current mutation but included trigger guidance.';
      if (diagnostic.source) {
        facts.externalRunCorrelationTriggerSource = diagnostic.source;
      }
      if (diagnostic.expectedAfter) {
        facts.externalRunCorrelationTriggerExpectedAfter = diagnostic.expectedAfter;
      }
      if (diagnostic.branch) {
        facts.externalRunCorrelationTriggerBranch = diagnostic.branch;
      }
      if (diagnostic.configPaths.length > 0) {
        facts.externalRunCorrelationTriggerConfigPaths = diagnostic.configPaths;
      }
      if (typeof diagnostic.autoTriggerOnSourceMutation === 'boolean') {
        facts.externalRunCorrelationAutoTriggerOnSourceMutation =
          diagnostic.autoTriggerOnSourceMutation;
      }
    }
  } else if (
    workflowNeedsExternalRunCorrelationDiagnostic(params.state) &&
    params.descriptor.workflowStages.includes('inspect_resource') &&
    params.descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
    !isPassiveWorkflowMonitorDescriptor(params.descriptor)
  ) {
    facts.externalRunCorrelationDiagnosticInspectionCount =
      typeof params.state.facts?.externalRunCorrelationDiagnosticInspectionCount === 'number'
        ? params.state.facts.externalRunCorrelationDiagnosticInspectionCount + 1
        : 1;
    facts.externalRunCorrelationLastDiagnosticToolName = params.toolResult.toolName;
    facts.externalRunCorrelationLastDiagnosticAt = params.toolResult.timestamp;
  }

  const failedTerminalExternalRunIsRelevant =
    !workflowRequiresExternalRunCorrelation(params.state) ||
    Boolean(correlatedRun) ||
    workflowHasKnownExternalRun(facts);
  if (
    isPassiveWorkflowMonitorDescriptor(params.descriptor) &&
    resultHasFailedTerminalEvidence(params.toolResult.result) &&
    failedTerminalExternalRunIsRelevant
  ) {
    facts.lastExternalRunFailureToolName = params.toolResult.toolName;
    facts.lastExternalRunFailureDetail = summarizeToolResultDetail(params.toolResult.result);
    facts.lastExternalRunFailureAt = params.toolResult.timestamp;
    facts.externalRunFailureRecoveryCount =
      typeof params.state.facts?.externalRunFailureRecoveryCount === 'number'
        ? params.state.facts.externalRunFailureRecoveryCount + 1
        : 1;
  } else if (resultHasSuccessfulTerminalEvidence(params.toolResult.result)) {
    delete facts.lastExternalRunFailureToolName;
    delete facts.lastExternalRunFailureDetail;
    delete facts.lastExternalRunFailureAt;
    delete facts.externalRunFailureRecoveryCount;
  }

  return facts;
}

function updateBlockedFactsFromToolIssue(params: {
  state: AgentRunRouteState;
  descriptor: ToolCapabilityDescriptor;
  toolResult: WorkflowRouteToolResult;
  activation?: WorkflowRouteActivation;
}): Record<string, unknown> {
  const facts: Record<string, unknown> = {
    ...(params.state.facts ?? {}),
  };
  const normalizedToolName = normalizeToolName(params.toolResult.toolName);
  facts.blockedWorkflowToolNames = uniqueStrings([
    ...readStringArrayFact(params.state.facts, 'blockedWorkflowToolNames'),
    normalizedToolName,
  ]);

  if (params.activation?.routeId === params.state.routeId) {
    const completedRequirementKeys = readCompletedWorkflowRequirementKeys(params.state);
    const blockedRequirementKeys = params.activation.phases
      .filter((phase) => {
        const routePhase = params.state.phases.find((candidate) => candidate.id === phase.id);
        return routePhase?.status === 'active' || routePhase?.status === 'pending';
      })
      .flatMap((phase) => phase.requiredCapabilities)
      .filter((requirement) => !completedRequirementKeys.has(workflowRequirementKey(requirement)))
      .filter((requirement) => descriptorSatisfiesRequirement(params.descriptor, requirement))
      .map(workflowRequirementKey);

    if (blockedRequirementKeys.length > 0) {
      facts.blockedWorkflowRequirementKeys = uniqueStrings([
        ...readStringArrayFact(params.state.facts, 'blockedWorkflowRequirementKeys'),
        ...blockedRequirementKeys,
      ]);
    }
  }

  return facts;
}

function transitionWorkflowRouteAfterToolBlock(params: {
  state: AgentRunRouteState;
  toolResult: WorkflowRouteToolResult;
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>;
  detail: string;
  facts: Record<string, unknown>;
  activation?: WorkflowRouteActivation;
}): AgentRunRouteState {
  const candidateActiveState = {
    ...params.state,
    status: 'active' as const,
    blockers: Array.from(new Set([...(params.state.blockers ?? []), params.detail])),
    facts: params.facts,
    updatedAt: params.toolResult.timestamp,
  };
  const hasAlternatePhaseTools =
    params.activation?.routeId === params.state.routeId &&
    selectToolNamesForWorkflowRoutePhase(
      params.activation,
      candidateActiveState,
      params.tools,
    ).length > 0;
  const phases = params.state.phases.map((phase) =>
    phase.id === params.state.currentPhaseId
      ? {
          ...phase,
          status: hasAlternatePhaseTools ? ('active' as const) : ('blocked' as const),
          detail: params.detail,
          updatedAt: params.toolResult.timestamp,
        }
      : phase,
  );
  return {
    ...params.state,
    status: hasAlternatePhaseTools ? 'active' : 'blocked',
    phases,
    blockers: Array.from(new Set([...(params.state.blockers ?? []), params.detail])),
    facts: params.facts,
    updatedAt: params.toolResult.timestamp,
  };
}

function updateRecoverableFactsFromToolIssue(params: {
  state: AgentRunRouteState;
  descriptor: ToolCapabilityDescriptor;
  toolResult: WorkflowRouteToolResult;
  detail: string;
  existingRecoverableCount?: number;
}): Record<string, unknown> {
  const recoverableErrorCount =
    params.existingRecoverableCount ??
    (typeof params.state.facts?.recoverableErrorCount === 'number'
      ? params.state.facts.recoverableErrorCount + 1
      : 1);
  const facts: Record<string, unknown> = {
    ...(params.state.facts ?? {}),
    recoverableErrorCount,
    lastRecoverableToolError: params.detail,
    lastRecoverableToolName: params.toolResult.toolName,
  };

  const missingPath = extractMissingWorkspacePath(params.toolResult.result);
  if (
    missingPath &&
    params.descriptor.category === 'workspace_files' &&
    params.descriptor.capabilities.includes('read')
  ) {
    const missingPaths = uniqueStrings([
      ...readStringArrayFact(params.state.facts, 'missingWorkspaceArtifactPaths'),
      missingPath,
    ]).slice(-8);
    facts.missingWorkspaceArtifactPaths = missingPaths;
    facts.forceArtifactBootstrap = true;
  }

  return facts;
}

function buildObservedToolNameSet(observedToolNames?: Iterable<string>): Set<string> {
  return new Set(
    Array.from(observedToolNames ?? [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );
}

function getMissingWorkflowRequirementKeys(
  state: AgentRunRouteState,
  _observedToolNames?: Iterable<string>,
): string[] {
  const requiredRequirementKeys = readRequiredWorkflowRequirementKeys(state);
  if (requiredRequirementKeys.length === 0) {
    return [];
  }

  const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
  return requiredRequirementKeys.filter((key) => {
    return !completedRequirementKeys.has(key);
  });
}

function canToolResultSatisfyWorkflowRequirement(
  state: AgentRunRouteState,
  descriptor: ToolCapabilityDescriptor,
  requirement: ToolCapabilityRequirement,
  toolResult: WorkflowRouteToolResult,
  facts: Record<string, unknown>,
): boolean {
  if (!descriptorSatisfiesRequirement(descriptor, requirement)) {
    return false;
  }

  if (toolResult.status !== 'completed') {
    return false;
  }

  if (
    !passiveWorkflowMonitorCanAdvance({
      state,
      descriptor,
      requirement,
      toolResult,
      facts,
    })
  ) {
    return false;
  }

  if (
    isPassiveWorkflowMonitorDescriptor(descriptor) &&
    requirement.workflowStage === 'verify_evidence' &&
    resultHasFailedTerminalEvidence(toolResult.result)
  ) {
    return false;
  }

  return true;
}

function advancePhasesFromCompletedRequirements(params: {
  state: AgentRunRouteState;
  activation: WorkflowRouteActivation;
  completedRequirementKeys: Set<string>;
  descriptor: ToolCapabilityDescriptor;
  toolResult: WorkflowRouteToolResult;
  facts?: Record<string, unknown>;
  didAdvanceRequirements?: boolean;
}): AgentRunRouteState {
  const phaseSpecsById = new Map(params.activation.phases.map((phase) => [phase.id, phase]));
  const completedStages = new Set(params.descriptor.workflowStages);
  const phases = params.state.phases.map((phase) => {
    const spec = phaseSpecsById.get(phase.id);
    const completedByRequirements =
      spec && spec.requiredCapabilities.length > 0
        ? spec.requiredCapabilities.every((requirement) =>
            params.completedRequirementKeys.has(workflowRequirementKey(requirement)),
          )
        : false;
    const completedByStage =
      (!spec || spec.requiredCapabilities.length === 0) &&
      completedStages.has(phase.id as ToolWorkflowStage);

    if (completedByRequirements || completedByStage) {
      if (phase.status === 'completed') {
        return phase;
      }

      return {
        ...phase,
        status: 'completed' as const,
        detail: `${params.toolResult.toolName} satisfied ${phase.title}.`,
        updatedAt: params.toolResult.timestamp,
      };
    }

    return {
      ...phase,
      status: phase.status === 'completed' ? ('completed' as const) : ('pending' as const),
    };
  });

  const nextActivePhase = phases.find((phase) => phase.status !== 'completed');
  const advancedPhases = nextActivePhase
    ? phases.map((phase) =>
        phase.id === nextActivePhase.id
          ? { ...phase, status: 'active' as const, updatedAt: params.toolResult.timestamp }
          : phase,
      )
    : phases;

  const facts: Record<string, unknown> = {
    ...(params.facts ?? params.state.facts ?? {}),
    completedWorkflowRequirementKeys: Array.from(params.completedRequirementKeys),
  };
  if (params.didAdvanceRequirements) {
    facts.lastAdvancedByTool = params.toolResult.toolName;
  } else {
    facts.lastObservedByTool = params.toolResult.toolName;
  }

  return {
    ...params.state,
    status: nextActivePhase ? 'active' : 'completed',
    currentPhaseId: nextActivePhase?.id ?? params.state.currentPhaseId,
    phases: advancedPhases,
    facts,
    updatedAt: params.toolResult.timestamp,
  };
}

export function advanceWorkflowRouteStateFromToolResult(
  state: AgentRunRouteState | undefined,
  toolResult: WorkflowRouteToolResult,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  activation?: WorkflowRouteActivation,
): AgentRunRouteState | undefined {
  if (!state || state.routeId !== 'capability-workflow') {
    return state;
  }

  const descriptor = getDescriptorForTool(toolResult.toolName, tools);
  if (descriptor.workflowStages.length === 0) {
    return state;
  }

  if (state.status === 'blocked') {
    return state;
  }

  const disposition = classifyWorkflowResultDisposition(toolResult.result, toolResult.status);
  if (disposition.kind === 'blocked') {
    const facts = updateBlockedFactsFromToolIssue({
      state,
      descriptor,
      toolResult,
      activation,
    });
    return transitionWorkflowRouteAfterToolBlock({
      state,
      toolResult,
      tools,
      detail: disposition.detail,
      facts,
      activation,
    });
  }

  if (disposition.kind === 'recoverable') {
    const phases = state.phases.map((phase) =>
      phase.id === state.currentPhaseId
        ? {
            ...phase,
            status: 'active' as const,
            detail: disposition.detail,
            updatedAt: toolResult.timestamp,
          }
        : phase,
    );
    const recoverableErrorCount =
      typeof state.facts?.recoverableErrorCount === 'number'
        ? state.facts.recoverableErrorCount + 1
        : 1;

    return {
      ...state,
      status: 'active',
      phases,
      facts: updateRecoverableFactsFromToolIssue({
        state,
        descriptor,
        toolResult,
        detail: disposition.detail,
        existingRecoverableCount: recoverableErrorCount,
      }),
      updatedAt: toolResult.timestamp,
    };
  }

  if (activation && activation.routeId === state.routeId) {
    const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
    const initialCompletedRequirementCount = completedRequirementKeys.size;
    const nextFacts = updateWorkflowFactsFromSuccessfulToolResult({
      state,
      descriptor,
      toolResult,
      facts: { ...(state.facts ?? {}) },
    });
    if (
      workflowRequiresExternalRunCorrelation(state) &&
      isPassiveWorkflowMonitorDescriptor(descriptor) &&
      !getCorrelatedWorkflowRun(descriptor, toolResult.result, nextFacts) &&
      (
        readUncorrelatedExternalMonitorCount(nextFacts) >=
          MAX_UNCORRELATED_EXTERNAL_MONITOR_OBSERVATIONS ||
        readRepeatedUncorrelatedExternalMonitorCount(nextFacts) >=
          MAX_REPEATED_UNCORRELATED_EXTERNAL_MONITOR_OBSERVATIONS
      )
    ) {
      const diagnosticState = { ...state, facts: nextFacts };
      const diagnosticToolNames = workflowNeedsExternalRunCorrelationDiagnostic(diagnosticState)
        ? selectExternalRunCorrelationDiagnosticToolNames(
            activation,
            diagnosticState,
            tools,
            buildToolCapabilityRegistry(tools),
          )
        : [];
      if (diagnosticToolNames.length > 0) {
        const phases = state.phases.map((phase) =>
          phase.id === state.currentPhaseId
            ? {
                ...phase,
                status: 'active' as const,
                detail:
                  'External execution has not appeared for the current mutation; inspect trigger prerequisites before polling again.',
                updatedAt: toolResult.timestamp,
              }
            : phase,
        );
        return {
          ...state,
          status: 'active',
          phases,
          facts: {
            ...nextFacts,
            lastObservedByTool: toolResult.toolName,
          },
          updatedAt: toolResult.timestamp,
        };
      }
      const blockedFacts = updateBlockedFactsFromToolIssue({
        state: { ...state, facts: nextFacts },
        descriptor,
        toolResult,
        activation,
      });
      const detail = buildUncorrelatedExternalMonitorBlocker(
        blockedFacts,
        toolResult.toolName,
      );
      return transitionWorkflowRouteAfterToolBlock({
        state,
        toolResult,
        tools,
        detail,
        facts: blockedFacts,
        activation,
      });
    }
    for (const phase of activation.phases) {
      for (const requirement of phase.requiredCapabilities) {
        if (canToolResultSatisfyWorkflowRequirement(state, descriptor, requirement, toolResult, nextFacts)) {
          completedRequirementKeys.add(workflowRequirementKey(requirement));
        }
      }
    }

    return advancePhasesFromCompletedRequirements({
      state,
      activation,
      completedRequirementKeys,
      descriptor,
      toolResult,
      facts: nextFacts,
      didAdvanceRequirements: completedRequirementKeys.size > initialCompletedRequirementCount,
    });
  }

  const completedStages = new Set(descriptor.workflowStages);
  if (descriptor.capabilities.includes('wait') && !resultHasTerminalEvidence(toolResult.result)) {
    completedStages.delete('await_external_execution');
    completedStages.delete('verify_evidence');
  }

  const phases = state.phases.map((phase) =>
    completedStages.has(phase.id as ToolWorkflowStage)
      ? {
          ...phase,
          status: 'completed' as const,
          detail: `${toolResult.toolName} completed.`,
          updatedAt: toolResult.timestamp,
        }
      : phase,
  );
  const nextActivePhase = phases.find((phase) => phase.status === 'pending');
  const advancedPhases = nextActivePhase
    ? phases.map((phase) =>
        phase.id === nextActivePhase.id
          ? { ...phase, status: 'active' as const, updatedAt: toolResult.timestamp }
          : phase,
      )
    : phases;

  return {
    ...state,
    status: nextActivePhase ? 'active' : 'completed',
    currentPhaseId: nextActivePhase?.id ?? state.currentPhaseId,
    phases: advancedPhases,
    facts: {
      ...(state.facts ?? {}),
      lastAdvancedByTool: toolResult.toolName,
    },
    updatedAt: toolResult.timestamp,
  };
}

function buildSeededWorkflowRouteState(
  activation: WorkflowRouteActivation,
  seedState: AgentRunRouteState | undefined,
  timestamp: number,
): AgentRunRouteState {
  const initialState = buildInitialWorkflowRouteState(activation, timestamp);
  if (!seedState || seedState.routeId !== activation.routeId) {
    return initialState;
  }

  const seedCompletedRequirementKeys = Array.isArray(
    seedState.facts?.completedWorkflowRequirementKeys,
  )
    ? { completedWorkflowRequirementKeys: [...seedState.facts.completedWorkflowRequirementKeys] }
    : {};

  return {
    ...initialState,
    blockers: seedState.blockers?.length ? [...seedState.blockers] : initialState.blockers,
    facts: {
      ...(seedState.facts ?? {}),
      ...(initialState.facts ?? {}),
      ...seedCompletedRequirementKeys,
    },
  };
}

export function replayWorkflowRouteStateFromToolResults(
  activation: WorkflowRouteActivation,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  toolResults: ReadonlyArray<WorkflowRouteToolResult>,
  options?: {
    seedState?: AgentRunRouteState;
    timestamp?: number;
  },
): AgentRunRouteState {
  let state = buildSeededWorkflowRouteState(
    activation,
    options?.seedState,
    options?.timestamp ?? Date.now(),
  );

  for (const toolResult of toolResults) {
    const nextState = advanceWorkflowRouteStateFromToolResult(
      state,
      toolResult,
      tools,
      activation,
    );
    if (nextState) {
      state = nextState;
    }
  }

  return state;
}

function selectExternalRunCorrelationDiagnosticToolNames(
  activation: WorkflowRouteActivation,
  state: AgentRunRouteState,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  registry: Map<string, ToolCapabilityDescriptor>,
): string[] {
  const inspectRequirements = activation.phases
    .filter((phase) => phase.stage === 'inspect_resource' || phase.stage === 'discover_resource')
    .flatMap((phase) => phase.requiredCapabilities);
  const diagnosticTools = uniqueStrings([
    ...selectToolNamesForCapabilityRequirements(tools, inspectRequirements),
    ...activation.requiredToolNames.filter((toolName) => {
      const descriptor =
        registry.get(normalizeToolName(toolName)) ?? getDescriptorForTool(toolName, tools);
      return (
        descriptor.sideEffects.every((sideEffect) => sideEffect === 'none') &&
        !isPassiveWorkflowMonitorDescriptor(descriptor) &&
        (descriptor.workflowStages.includes('inspect_resource') ||
          descriptor.workflowStages.includes('discover_resource'))
      );
    }),
  ]).filter((toolName) => {
    const descriptor =
      registry.get(normalizeToolName(toolName)) ?? getDescriptorForTool(toolName, tools);
    return !shouldSuppressWorkflowToolForState(state, toolName, descriptor);
  });

  const diagnosticInspectionCount =
    typeof state.facts?.externalRunCorrelationDiagnosticInspectionCount === 'number'
      ? state.facts.externalRunCorrelationDiagnosticInspectionCount
      : 0;
  const correctionRequirements =
    diagnosticInspectionCount > 0
      ? activation.phases
          .filter((phase) =>
            [
              'prepare_artifact',
              'persist_artifact',
              'mutate_remote_state',
              'start_external_execution',
            ].includes(phase.stage),
          )
          .flatMap((phase) => phase.requiredCapabilities)
      : [];
  const correctionTools =
    correctionRequirements.length > 0
      ? selectToolNamesForCapabilityRequirements(tools, correctionRequirements).filter(
          (toolName) => {
            const descriptor =
              registry.get(normalizeToolName(toolName)) ?? getDescriptorForTool(toolName, tools);
            const expectedAfter =
              typeof state.facts?.externalRunCorrelationTriggerExpectedAfter === 'string'
                ? state.facts.externalRunCorrelationTriggerExpectedAfter
                : undefined;
            return (
              descriptorCanSatisfyTriggerExpectedAfter(descriptor, expectedAfter) &&
              !shouldSuppressWorkflowToolForState(state, toolName, descriptor)
            );
          },
        )
      : [];

  return uniqueStrings([...diagnosticTools, ...correctionTools]);
}

export function selectToolNamesForWorkflowRoutePhase(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string[] {
  if (!activation || !state || state.routeId !== activation.routeId || state.status !== 'active') {
    return [];
  }

  const currentPhase = activation.phases.find((phase) => phase.id === state.currentPhaseId);
  if (!currentPhase) {
    return activation.requiredToolNames;
  }

  const registry = buildToolCapabilityRegistry(tools);
  const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
  const externalRunDiagnosticToolNames = workflowNeedsExternalRunCorrelationDiagnostic(state)
    ? selectExternalRunCorrelationDiagnosticToolNames(activation, state, tools, registry)
    : [];
  if (externalRunDiagnosticToolNames.length > 0) {
    return externalRunDiagnosticToolNames;
  }
  const outstandingRequirements = currentPhase.requiredCapabilities.filter(
    (requirement) => !completedRequirementKeys.has(workflowRequirementKey(requirement)),
  );
  const phaseToolNames = activation.requiredToolNames.filter((toolName) => {
    const descriptor = registry.get(normalizeToolName(toolName));
    if (!descriptor?.workflowStages.includes(currentPhase.stage)) {
      return false;
    }

    if (shouldSuppressWorkflowToolForState(state, toolName, descriptor)) {
      return false;
    }

    if (currentPhase.requiredCapabilities.length === 0) {
      return true;
    }

    return outstandingRequirements.some((requirement) =>
      descriptorSatisfiesRequirement(descriptor, requirement),
    );
  });

  const requirementToolNames = selectToolNamesForCapabilityRequirements(
    tools,
    outstandingRequirements,
  ).filter((toolName) => {
    const descriptor = registry.get(normalizeToolName(toolName)) ?? getDescriptorForTool(toolName, tools);
    return !shouldSuppressWorkflowToolForState(state, toolName, descriptor);
  });
  const shouldBootstrapMissingWorkspaceArtifacts =
    Boolean(state.facts?.forceArtifactBootstrap) &&
    readStringArrayFact(state.facts, 'missingWorkspaceArtifactPaths').length > 0;
  const bootstrapRequirements = shouldBootstrapMissingWorkspaceArtifacts
    ? activation.phases
        .filter(
          (phase) =>
            phase.stage === 'prepare_artifact' || phase.stage === 'persist_artifact',
        )
        .flatMap((phase) => phase.requiredCapabilities)
        .filter(
          (requirement) =>
            requirement.category === 'workspace_files' &&
            requirement.capability === 'write' &&
            !completedRequirementKeys.has(workflowRequirementKey(requirement)),
        )
    : [];
  const bootstrapToolNames =
    bootstrapRequirements.length > 0
      ? selectToolNamesForCapabilityRequirements(tools, bootstrapRequirements).filter(
          (toolName) => {
            const descriptor =
              registry.get(normalizeToolName(toolName)) ?? getDescriptorForTool(toolName, tools);
            return !shouldSuppressWorkflowToolForState(state, toolName, descriptor);
          },
        )
      : [];
  const shouldRecoverFailedExternalRun =
    currentPhase.stage === 'verify_evidence' &&
    typeof state.facts?.lastExternalRunFailureDetail === 'string' &&
    state.facts.lastExternalRunFailureDetail.trim().length > 0;
  const correctiveRequirements = shouldRecoverFailedExternalRun
    ? activation.phases
        .filter((phase) =>
          [
            'prepare_artifact',
            'persist_artifact',
            'mutate_remote_state',
            'start_external_execution',
          ].includes(phase.stage),
        )
        .flatMap((phase) => phase.requiredCapabilities)
    : [];
  const correctiveToolNames =
    correctiveRequirements.length > 0
      ? selectToolNamesForCapabilityRequirements(tools, correctiveRequirements).filter(
          (toolName) => {
            const descriptor =
              registry.get(normalizeToolName(toolName)) ?? getDescriptorForTool(toolName, tools);
            return !shouldSuppressWorkflowToolForState(state, toolName, descriptor);
          },
        )
      : [];

  const selected = uniqueStrings([
    ...phaseToolNames,
    ...requirementToolNames,
    ...bootstrapToolNames,
    ...correctiveToolNames,
  ]);
  return selected.length > 0 ? selected : [];
}

export function validateWorkflowRouteToolCallAgainstState(
  state: AgentRunRouteState | undefined,
  toolName: string,
  argumentsText: string,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string | undefined {
  if (!state || state.routeId !== 'capability-workflow' || state.status !== 'active') {
    return undefined;
  }

  const descriptor = getDescriptorForTool(toolName, tools);
  if (!descriptor.sideEffects.includes('remote_mutation')) {
    return undefined;
  }

  const parsedArgs = parseJsonObject(argumentsText);
  const triggerBranch =
    workflowNeedsExternalRunCorrelationDiagnostic(state) &&
    typeof state.facts?.externalRunCorrelationTriggerBranch === 'string'
      ? normalizeBranchReference(state.facts.externalRunCorrelationTriggerBranch)
      : undefined;
  if (triggerBranch) {
    const mismatchedBranches = collectBranchReferenceArguments(parsedArgs).filter(
      (branch) => !branchReferencesEqual(branch, triggerBranch),
    );
    if (mismatchedBranches.length > 0) {
      return [
        `Blocked ${normalizeToolName(toolName)} because the current external trigger correlation expects the next remote mutation on branch ${triggerBranch}, but the requested mutation targets ${uniqueStrings(mismatchedBranches).join(', ')}.`,
        'A mutation on a different branch cannot produce the expected external run evidence for this workflow.',
        'Use the trigger branch, inspect the trigger prerequisites, or surface a correlation blocker instead of creating unrelated remote state.',
      ].join(' ');
    }
  }

  const protectedPaths = readStringArrayFact(state.facts, 'observedExternalWorkflowConfigPaths');
  if (protectedPaths.length === 0 || state.facts?.externalWorkflowConfigMutationRequired === true) {
    return undefined;
  }

  const requestedPaths = extractPathLikeStrings(parsedArgs);
  const overlappingPaths = requestedPaths.filter((requestedPath) =>
    protectedPaths.some((protectedPath) => resourcePathsOverlap(requestedPath, protectedPath)),
  );
  if (overlappingPaths.length === 0) {
    return undefined;
  }

  return [
    `Blocked ${normalizeToolName(toolName)} because the requested mutation targets previously discovered external workflow configuration: ${uniqueStrings(overlappingPaths).join(', ')}.`,
    'The current workflow has not established that execution configuration is missing or broken.',
    'Modify the requested application/artifact resources or surface a configuration blocker instead of changing deployment automation implicitly.',
  ].join(' ');
}

export function selectToolNamesForWorkflowRouteTurn(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
  observedToolNames?: Iterable<string>,
): string[] {
  if (!activation || !state || state.routeId !== activation.routeId || state.status !== 'active') {
    return [];
  }

  const phaseToolNames = selectToolNamesForWorkflowRoutePhase(activation, state, tools);
  if (phaseToolNames.length > 0) {
    return phaseToolNames;
  }

  const observed = new Set(
    Array.from(observedToolNames ?? [])
      .map((toolName) => normalizeToolName(toolName))
      .filter(Boolean),
  );
  const completedRequirementKeys = readCompletedWorkflowRequirementKeys(state);
  const outstandingRequirements = activation.phases
    .filter((phase) => {
      const routePhase = state.phases.find((candidate) => candidate.id === phase.id);
      return routePhase?.status === 'active' || routePhase?.status === 'pending';
    })
    .flatMap((phase) => phase.requiredCapabilities)
    .filter((requirement) => !completedRequirementKeys.has(workflowRequirementKey(requirement)));
  const fallbackToolNames = activation.requiredToolNames.filter((toolName) => {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName || observed.has(normalizedToolName)) {
      return false;
    }
    const descriptor = getDescriptorForTool(normalizedToolName, tools);
    if (shouldSuppressWorkflowToolForState(state, normalizedToolName, descriptor)) {
      return false;
    }
    return (
      descriptorRequiresObservedToolUse(descriptor) &&
      outstandingRequirements.some((requirement) =>
        descriptorSatisfiesRequirement(descriptor, requirement),
      )
    );
  });

  return uniqueStrings(fallbackToolNames);
}

export function buildWorkflowRouteRuntimeGuidance(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string | undefined {
  if (!activation || !state || state.routeId !== activation.routeId || state.status !== 'active') {
    return undefined;
  }

  const currentPhase = activation.phases.find((phase) => phase.id === state.currentPhaseId);
  const phaseToolNames = selectToolNamesForWorkflowRoutePhase(activation, state, tools);
  const lastRecoverableError =
    typeof state.facts?.lastRecoverableToolError === 'string'
      ? state.facts.lastRecoverableToolError.trim()
      : '';
  const lastRecoverableToolName =
    typeof state.facts?.lastRecoverableToolName === 'string'
      ? state.facts.lastRecoverableToolName.trim()
      : '';
  const missingWorkspaceArtifactPaths = readStringArrayFact(
    state.facts,
    'missingWorkspaceArtifactPaths',
  );
  const blockedToolNames = readStringArrayFact(state.facts, 'blockedWorkflowToolNames');
  const uncorrelatedExternalMonitorCount = readUncorrelatedExternalMonitorCount(state.facts);
  const lastUncorrelatedExternalMonitorToolName =
    typeof state.facts?.lastUncorrelatedExternalMonitorToolName === 'string'
      ? state.facts.lastUncorrelatedExternalMonitorToolName.trim()
      : '';
  const externalRunCorrelationDiagnosticGuidance =
    typeof state.facts?.externalRunCorrelationDiagnosticGuidance === 'string'
      ? state.facts.externalRunCorrelationDiagnosticGuidance.trim()
      : '';
  const externalRunCorrelationTriggerBranch =
    typeof state.facts?.externalRunCorrelationTriggerBranch === 'string'
      ? state.facts.externalRunCorrelationTriggerBranch.trim()
      : '';
  const externalRunCorrelationTriggerExpectedAfter =
    typeof state.facts?.externalRunCorrelationTriggerExpectedAfter === 'string'
      ? state.facts.externalRunCorrelationTriggerExpectedAfter.trim()
      : '';
  const requiresRunCorrelation = workflowRequiresExternalRunCorrelation(state);
  const hasKnownExternalRun = workflowHasKnownExternalRun(state.facts);

  return [
    '## Capability Workflow State',
    currentPhase
      ? `Current phase: ${currentPhase.title}. Complete this phase before later workflow phases.`
      : undefined,
    phaseToolNames.length > 0
      ? `Use phase-appropriate tools now: ${phaseToolNames.join(', ')}.`
      : 'No phase-specific tool is loaded yet; discover a matching capability instead of guessing identifiers or arguments.',
    'Phase order is guidance for evidence quality, not a permission boundary. If inspection shows a requested artifact or state is absent, use loaded write, mutation, or monitoring tools that satisfy the next required capability instead of asking the user to re-authorize the already requested work.',
    'When the user has already requested artifact creation or remote execution, an absent file/resource reported by read-only inspection is workflow input, not a reason to ask for permission. Create the requested artifacts or resolve the missing prerequisite autonomously unless multiple externally visible choices remain genuinely ambiguous.',
    missingWorkspaceArtifactPaths.length > 0
      ? `Missing workspace artifacts observed: ${missingWorkspaceArtifactPaths.join(', ')}. Create the required artifacts now with write-capable tools; do not keep reading adjacent missing filenames.`
      : undefined,
    blockedToolNames.length > 0
      ? `Blocked workflow tools: ${blockedToolNames.join(', ')}. Do not retry blocked tools with the same credentials or arguments; use an alternate contract-matched path if one is available.`
      : undefined,
    readStringArrayFact(state.facts, 'observedExternalWorkflowConfigPaths').length > 0
      ? `Discovered external workflow configuration: ${readStringArrayFact(state.facts, 'observedExternalWorkflowConfigPaths').join(', ')}. Do not modify these configuration resources unless a tool has established that the configuration itself is missing or broken.`
      : undefined,
    typeof state.facts?.lastExternalRunFailureDetail === 'string' &&
      state.facts.lastExternalRunFailureDetail.trim().length > 0
      ? `Latest external execution failed: ${state.facts.lastExternalRunFailureDetail}`
      : undefined,
    typeof state.facts?.lastExternalRunFailureDetail === 'string' &&
      state.facts.lastExternalRunFailureDetail.trim().length > 0
      ? 'Treat failed external execution as feedback for a corrective artifact or prerequisite change before monitoring again; do not count a failed run as final verification evidence.'
      : undefined,
    requiresRunCorrelation && !hasKnownExternalRun
      ? 'External execution has not been correlated to the current mutation yet. Use monitor/list/status tools to discover a run created by the current mutation before calling passive wait tools.'
      : undefined,
    requiresRunCorrelation && !hasKnownExternalRun
      ? 'Passive conversation-scoped monitors require a known run or session id first; do not use them as an alternate path before a producer has returned a run handle.'
      : undefined,
    uncorrelatedExternalMonitorCount > 0
      ? `Uncorrelated external monitor observations: ${uncorrelatedExternalMonitorCount}${lastUncorrelatedExternalMonitorToolName ? ` from ${lastUncorrelatedExternalMonitorToolName}` : ''}. Treat stale or unrelated external runs as non-evidence for this task.`
      : undefined,
    workflowNeedsExternalRunCorrelationDiagnostic(state)
      ? 'The external monitor returned no run correlated to the current mutation but included trigger guidance. Stop polling monitors for now; inspect the trigger prerequisites, branch, workflow configuration, and linked project state with read-only tools before deciding whether a corrective mutation or blocker is needed.'
      : undefined,
    workflowNeedsExternalRunCorrelationDiagnostic(state) &&
      externalRunCorrelationTriggerBranch &&
      externalRunCorrelationTriggerExpectedAfter
      ? `Correlation constraint: the next producer evidence is expected after ${externalRunCorrelationTriggerExpectedAfter} on branch ${externalRunCorrelationTriggerBranch}. Do not create or mutate an unrelated branch as a recovery path.`
      : undefined,
    externalRunCorrelationDiagnosticGuidance
      ? `External monitor guidance: ${externalRunCorrelationDiagnosticGuidance}`
      : undefined,
    uncorrelatedExternalMonitorCount >= MAX_UNCORRELATED_EXTERNAL_MONITOR_OBSERVATIONS
      ? 'The monitor has reached the non-progress limit for this external run correlation. Stop polling the same monitor and surface the trigger/correlation blocker unless another contract-matched producer can create or return a fresh run id.'
      : undefined,
    lastRecoverableError
      ? `Previous recoverable tool issue${lastRecoverableToolName ? ` from ${lastRecoverableToolName}` : ''}: ${lastRecoverableError}`
      : undefined,
    lastRecoverableError
      ? 'Treat the issue as feedback for the next action: correct the arguments, resolve missing prerequisites with discovery or read tools, or choose another contract-matched tool. Do not retry the same arguments.'
      : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function shouldHoldWorkflowRouteFinalization(
  state: AgentRunRouteState | undefined,
  observedToolNames?: Iterable<string>,
): boolean {
  if (!state || state.routeId !== 'capability-workflow' || state.status === 'blocked') {
    return false;
  }

  const requiredRequirementKeys = readRequiredWorkflowRequirementKeys(state);
  if (requiredRequirementKeys.length > 0) {
    return getMissingWorkflowRequirementKeys(state, observedToolNames).length > 0;
  }

  const missingRequiredTools = getMissingRequiredWorkflowToolNames(state, observedToolNames);
  if (state.status !== 'active') {
    return missingRequiredTools.length > 0;
  }

  return (
    state.phases.some((phase) => phase.status === 'active' || phase.status === 'pending') ||
    missingRequiredTools.length > 0
  );
}

function descriptorRequiresObservedToolUse(descriptor: ToolCapabilityDescriptor): boolean {
  if (descriptor.workflowStages.includes('guarded_resource_creation')) {
    return false;
  }

  if (descriptor.sideEffects.some((sideEffect) => sideEffect !== 'none')) {
    return true;
  }

  if (descriptor.capabilities.some((capability) => REQUIRED_OBSERVED_CAPABILITIES.has(capability))) {
    return true;
  }

  return descriptor.providesEvidence.some(
    (evidenceKind) => !NON_SPECIFIC_EVIDENCE_KINDS.has(evidenceKind),
  );
}

export function getMissingRequiredWorkflowToolNames(
  state: AgentRunRouteState | undefined,
  observedToolNames?: Iterable<string>,
): string[] {
  if (!state || state.routeId !== 'capability-workflow') {
    return [];
  }

  const requiredRequirementKeys = readRequiredWorkflowRequirementKeys(state);
  if (requiredRequirementKeys.length > 0) {
    const labelsByKey = readWorkflowRequirementLabelsByKey(state);
    const toolNamesByKey = readWorkflowRequirementToolNamesByKey(state);
    return getMissingWorkflowRequirementKeys(state, observedToolNames).map((key) => {
      const candidateToolNames = toolNamesByKey[key] ?? [];
      if (candidateToolNames.length > 0) {
        return candidateToolNames.join(' or ');
      }
      return labelsByKey[key] || key;
    });
  }

  if (!observedToolNames) {
    return [];
  }

  const observed = buildObservedToolNameSet(observedToolNames);
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const toolName of state.requiredToolNames ?? []) {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName || seen.has(normalizedToolName) || observed.has(normalizedToolName)) {
      continue;
    }
    seen.add(normalizedToolName);

    const descriptor = inferToolCapabilityDescriptor({
      name: normalizedToolName,
      description: normalizedToolName,
    });
    if (descriptorRequiresObservedToolUse(descriptor)) {
      missing.push(normalizedToolName);
    }
  }

  return missing;
}

export function buildWorkflowRouteFinalizationHoldGuidance(
  activation: WorkflowRouteActivation | undefined,
  state: AgentRunRouteState | undefined,
  tools: ReadonlyArray<Pick<ToolDefinition, 'name' | 'description'>>,
): string {
  const runtimeGuidance = buildWorkflowRouteRuntimeGuidance(activation, state, tools);

  return [
    '[SYSTEM WORKFLOW HOLD]',
    'The assistant attempted to finalize while the capability workflow still has incomplete active or pending phases.',
    'Do not hand this draft to final review yet. Continue the existing workflow from the current phase and use contract-matched tools before writing a final answer.',
    runtimeGuidance,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}
