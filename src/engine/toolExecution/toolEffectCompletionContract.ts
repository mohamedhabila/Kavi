import { resolveToolEffectPolicy } from '../durability/toolEffectPolicy';
import {
  buildEffectCompletionCriterion,
  effectCompletionCriteriaEqual,
  parseEffectCompletionCriterion,
  type EffectCompletionCriterion,
  type EffectCompletionResource,
} from '../goals/effectCompletionEvidence';
import { isBlockingGoal } from '../goals/types';
import { normalizeToolName } from '../tools/toolNameNormalization';
import type { AgentGoal } from '../../types/agentRun';
import type { ToolEffectIdentitySelector } from '../../types/toolEffectReceipt';
import { digestToolEffectText } from './toolEffectReceipt';
import { getCodeOwnedToolEffectContract } from './toolEffectReceiptContracts';

export type ToolEffectCompletionRequirement =
  | { kind: 'effect_free'; toolName: string }
  | { kind: 'operational'; toolName: string }
  | {
      kind: 'effectful';
      toolName: string;
      criterion: EffectCompletionCriterion;
      serializedCriterion: string;
    }
  | {
      kind: 'unsupported';
      toolName: string;
      code: 'effect_contract_unavailable' | 'effect_arguments_invalid';
    };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseArguments(argumentsText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readPath(
  root: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isPlainRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function readCompletionResource(
  selector: ToolEffectIdentitySelector | undefined,
  argumentsValue: Record<string, unknown>,
): EffectCompletionResource | null {
  if (!selector || selector.source !== 'arguments') {
    return null;
  }
  const value = readPath(argumentsValue, selector.path);
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isSafeInteger(value))
  ) {
    return null;
  }
  const id = String(value).trim();
  return id ? { kind: selector.kind, id } : null;
}

function completionContractIsEffectFree(
  contract: NonNullable<ReturnType<typeof getCodeOwnedToolEffectContract>>,
  argumentsValue: Record<string, unknown>,
): boolean {
  const condition = contract.completion?.effectFreeWhen;
  if (!condition) {
    return false;
  }
  const value = readPath(argumentsValue, condition.argumentPath);
  return typeof value === 'string' && condition.values.includes(value);
}

async function resolveCompletionResource(params: {
  argumentsValue: Record<string, unknown>;
  requestDigest: `sha256:${string}`;
  contract: NonNullable<ReturnType<typeof getCodeOwnedToolEffectContract>>;
}): Promise<EffectCompletionResource> {
  const explicit = readCompletionResource(
    params.contract.completion?.resource,
    params.argumentsValue,
  );
  const resource: EffectCompletionResource =
    explicit ??
    (params.contract.result?.resource
      ? { kind: params.contract.result.resource.kind, id: '*' }
      : { kind: 'effect_request', id: params.requestDigest });
  const digestPath = params.contract.completion?.sha256ArgumentPath;
  if (!digestPath) {
    return resource;
  }
  const digestValue = readPath(params.argumentsValue, digestPath);
  return typeof digestValue === 'string'
    ? { ...resource, digest: await digestToolEffectText(digestValue) }
    : resource;
}

export async function resolveToolEffectCompletionRequirement(params: {
  toolName: string;
  argumentsText: string;
}): Promise<ToolEffectCompletionRequirement> {
  const toolName = normalizeToolName(params.toolName);
  const policy = resolveToolEffectPolicy(toolName);
  if (policy.source !== 'unknown' && policy.effects.every((effect) => effect === 'none')) {
    return { kind: 'effect_free', toolName };
  }

  const contract = getCodeOwnedToolEffectContract(toolName);
  if (
    policy.source === 'unknown' ||
    policy.effects.includes('unknown') ||
    !contract
  ) {
    return { kind: 'unsupported', toolName, code: 'effect_contract_unavailable' };
  }
  if (contract.effectMode === 'operational') {
    return { kind: 'operational', toolName };
  }
  if (contract.effectMode !== 'effectful') {
    return { kind: 'unsupported', toolName, code: 'effect_contract_unavailable' };
  }
  const argumentsValue = parseArguments(params.argumentsText);
  if (!argumentsValue) {
    return { kind: 'unsupported', toolName, code: 'effect_arguments_invalid' };
  }
  if (completionContractIsEffectFree(contract, argumentsValue)) {
    return { kind: 'effect_free', toolName };
  }

  const requestDigest = await digestToolEffectText(params.argumentsText);
  const criterion: EffectCompletionCriterion = {
    effectKind: contract.effectKind,
    requestDigest,
    resource: await resolveCompletionResource({
      argumentsValue,
      requestDigest,
      contract,
    }),
    verificationState: 'verified',
  };
  return {
    kind: 'effectful',
    toolName,
    criterion,
    serializedCriterion: buildEffectCompletionCriterion(criterion),
  };
}

export function findGoalForEffectCompletionRequirement(
  goals: ReadonlyArray<AgentGoal> | undefined,
  requirement: Extract<ToolEffectCompletionRequirement, { kind: 'effectful' }>,
): AgentGoal | undefined {
  return (goals ?? []).find(
    (goal) =>
      goal.status === 'active' &&
      isBlockingGoal(goal) &&
      (goal.successCriteria ?? []).some((value) => {
        const criterion = parseEffectCompletionCriterion(value);
        return criterion
          ? effectCompletionCriteriaEqual(criterion, requirement.criterion)
          : false;
      }),
  );
}

export function buildEffectCompletionContractBlock(
  requirement: Extract<ToolEffectCompletionRequirement, { kind: 'effectful' | 'unsupported' }>,
): string {
  if (requirement.kind === 'unsupported') {
    return JSON.stringify({
      status: 'error',
      code: requirement.code,
      tool: requirement.toolName,
      message:
        'The code-owned effect contract cannot prove this mutation. Do not execute or claim completion.',
    });
  }
  return JSON.stringify({
    status: 'error',
    code: 'completion_contract_required',
    tool: requirement.toolName,
    requiredCriterion: requirement.serializedCriterion,
    repair: {
      tool: 'update_goals',
      completionPolicy: 'blocking',
      status: 'active',
      successCriteria: [requirement.serializedCriterion],
    },
    message:
      'Create or update an active blocking goal with the exact required criterion before retrying this effect.',
  });
}

export function buildGoalMutationBoundaryBlock(toolName: string): string {
  return JSON.stringify({
    status: 'error',
    code: 'goal_mutation_boundary',
    tool: normalizeToolName(toolName),
    message:
      'The goal mutation must commit before this effect can execute. Retry the effect on the next graph iteration.',
  });
}
