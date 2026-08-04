import { isBlockingGoal, type AgentGoal } from './types';
import {
  extractJsonPayloadFromEvidenceEntry,
  readJsonFieldAtPath,
  structuralValuesMatch,
} from './structuralCriterionValues';
import {
  effectReceiptEvidenceSatisfiesCriterion,
  parseEffectCompletionCriterion,
  parseToolEffectReceiptEvidence,
} from './effectCompletionEvidence';

export interface GoalEvidenceGap {
  goalId: string;
  criterionId: string;
}

export interface SuccessCriterionSurfaceHints {
  toolNames: string[];
  capabilities: string[];
  resourceKinds: string[];
  categories: string[];
}

export const SUCCESS_CRITERION_FORMS = [
  'evidence.min:<n>',
  'evidence.count:<n>',
  'evidence.prefix:<token>',
  'evidence.tool:<name>',
  'evidence.artifact:<path>',
  'evidence.json_field:<path>:<value>',
  'evidence.file_hash:<path>:<algo>[:<hex>]',
  'evidence.exit_code:<n>',
  'evidence.effect:<closed-json-contract>',
] as const;

const EVIDENCE_MIN_PATTERN = /^evidence\.min:(\d+)$/;
const EVIDENCE_COUNT_PATTERN = /^evidence\.count:(\d+)$/;
const EVIDENCE_PREFIX_PATTERN = /^evidence\.prefix:(.+)$/;
const EVIDENCE_TOOL_PATTERN = /^evidence\.tool:(.+)$/;
const EVIDENCE_ARTIFACT_PATTERN = /^evidence\.artifact:(.+)$/;
const EVIDENCE_JSON_FIELD_PATTERN = /^evidence\.json_field:([^:]+):(.+)$/;
const EVIDENCE_FILE_HASH_PATTERN = /^evidence\.file_hash:([^:]+):([^:]+)(?::([0-9a-fA-F]+))?$/;
const EVIDENCE_EXIT_CODE_PATTERN = /^evidence\.exit_code:(-?\d+)$/;
const EVIDENCE_PREFIX_SURFACE_HINTS: ReadonlyMap<string, SuccessCriterionSurfaceHints> = new Map([
  [
    'worker',
    {
      toolNames: [],
      capabilities: ['coordinate'],
      resourceKinds: [],
      categories: ['sessions'],
    },
  ],
]);

export function formatSuccessCriteriaFormsDescription(): string {
  return SUCCESS_CRITERION_FORMS.join(', ');
}

export function formatModelAuthoredSuccessCriteriaFormsDescription(): string {
  return SUCCESS_CRITERION_FORMS.filter(
    (form) => form !== 'evidence.effect:<closed-json-contract>',
  ).join(', ');
}

export function isRecognizedSuccessCriterionForm(criterion: string): boolean {
  const fileHashMatch = criterion.match(EVIDENCE_FILE_HASH_PATTERN);
  const exitCodeMatch = criterion.match(EVIDENCE_EXIT_CODE_PATTERN);
  return (
    EVIDENCE_MIN_PATTERN.test(criterion) ||
    EVIDENCE_COUNT_PATTERN.test(criterion) ||
    EVIDENCE_PREFIX_PATTERN.test(criterion) ||
    EVIDENCE_TOOL_PATTERN.test(criterion) ||
    EVIDENCE_ARTIFACT_PATTERN.test(criterion) ||
    EVIDENCE_JSON_FIELD_PATTERN.test(criterion) ||
    (fileHashMatch !== null &&
      fileHashMatch[2].toLowerCase() === 'sha256' &&
      (fileHashMatch[3] === undefined || fileHashMatch[3].length === 64)) ||
    (exitCodeMatch !== null && Number.parseInt(exitCodeMatch[1], 10) === 0) ||
    parseEffectCompletionCriterion(criterion) !== null
  );
}

export function isCountOnlySuccessCriterion(criterion: string): boolean {
  return EVIDENCE_MIN_PATTERN.test(criterion) || EVIDENCE_COUNT_PATTERN.test(criterion);
}

/**
 * Renders the concrete action that records evidence for an unmet criterion.
 *
 * Loop-recovery and completion-hold prompts are read by the model, so naming the
 * criterion alone leaves it guessing which action closes the gap — and guessing is
 * what produces repeated goal bookkeeping instead of progress. Only actions backed
 * by default core tools are named, so a hint never points at an unavailable tool.
 *
 * Returns null for criteria that no single action satisfies (bare counts), where a
 * specific instruction would be misleading.
 */
export function describeCriterionSatisfactionAction(criterion: string): string | null {
  const trimmed = criterion.trim();
  if (!trimmed || isCountOnlySuccessCriterion(trimmed)) {
    return null;
  }

  const toolMatch = trimmed.match(EVIDENCE_TOOL_PATTERN);
  if (toolMatch) {
    return `call ${toolMatch[1].trim()} and keep its result`;
  }

  const artifactMatch = trimmed.match(EVIDENCE_ARTIFACT_PATTERN);
  if (artifactMatch) {
    return `write ${artifactMatch[1].trim()} with write_file`;
  }

  const jsonFieldMatch = trimmed.match(EVIDENCE_JSON_FIELD_PATTERN);
  if (jsonFieldMatch) {
    return `write ${jsonFieldMatch[1].trim()} with write_file so it contains ${jsonFieldMatch[2].trim()}`;
  }

  const fileHashMatch = trimmed.match(EVIDENCE_FILE_HASH_PATTERN);
  if (fileHashMatch) {
    return `write ${fileHashMatch[1].trim()} with write_file`;
  }

  const exitCodeMatch = trimmed.match(EVIDENCE_EXIT_CODE_PATTERN);
  if (exitCodeMatch) {
    return `run the command until it exits ${exitCodeMatch[1]}`;
  }

  const prefixMatch = trimmed.match(EVIDENCE_PREFIX_PATTERN);
  if (prefixMatch) {
    return `produce a ${prefixMatch[1].trim()} result`;
  }

  return null;
}

/** Actionable directives for the unmet criteria of the supplied goals, deduped. */
export function buildCriterionSatisfactionActions(
  goals: ReadonlyArray<AgentGoal>,
): string[] {
  const actions: string[] = [];
  const seen = new Set<string>();
  for (const goal of goals) {
    for (const criterion of goal.successCriteria ?? []) {
      if (isSuccessCriterionMet(goal, criterion)) continue;
      const action = describeCriterionSatisfactionAction(criterion);
      if (!action || seen.has(action)) continue;
      seen.add(action);
      actions.push(action);
    }
  }
  return actions;
}

export function resolveSuccessCriterionSurfaceHints(
  criterion: string,
): SuccessCriterionSurfaceHints {
  const prefixMatch = criterion.match(EVIDENCE_PREFIX_PATTERN);
  if (prefixMatch) {
    const token = prefixMatch[1].trim();
    const registeredHints = EVIDENCE_PREFIX_SURFACE_HINTS.get(token);
    if (registeredHints) {
      return registeredHints;
    }
    return {
      toolNames: [token].filter(Boolean),
      capabilities: [],
      resourceKinds: [],
      categories: [],
    };
  }

  const toolMatch = criterion.match(EVIDENCE_TOOL_PATTERN);
  if (toolMatch) {
    return {
      toolNames: [toolMatch[1].trim()].filter(Boolean),
      capabilities: [],
      resourceKinds: [],
      categories: [],
    };
  }

  if (EVIDENCE_ARTIFACT_PATTERN.test(criterion) || EVIDENCE_FILE_HASH_PATTERN.test(criterion)) {
    return {
      toolNames: [],
      capabilities: ['write'],
      resourceKinds: ['conversation_workspace'],
      categories: ['workspace_files'],
    };
  }

  return { toolNames: [], capabilities: [], resourceKinds: [], categories: [] };
}

function meetsEvidenceCountCriterion(goal: AgentGoal, minimum: number): boolean {
  if (!Number.isFinite(minimum) || minimum < 0) {
    return false;
  }
  return goal.evidence.length >= minimum;
}

function meetsEvidencePrefixCriterion(goal: AgentGoal, token: string): boolean {
  const prefix = `${token}:`;
  return goal.evidence.some((entry) => entry.startsWith(prefix));
}

function meetsEvidenceToolCriterion(goal: AgentGoal, toolName: string): boolean {
  const normalized = toolName.trim();
  if (!normalized) {
    return false;
  }
  const prefix = `${normalized}:`;
  return goal.evidence.some((entry) => entry.startsWith(prefix));
}

function meetsEvidenceArtifactCriterion(goal: AgentGoal, pathToken: string): boolean {
  const normalized = pathToken.trim();
  if (!normalized) {
    return false;
  }
  return goal.evidence.some((entry) => {
    const receipt = parseToolEffectReceiptEvidence(entry);
    return (
      receipt?.transportState === 'returned' &&
      receipt.effectKind === 'artifact.write' &&
      receipt.effectState === 'applied' &&
      receipt.verificationState === 'verified' &&
      receipt.resource.kind === 'workspace_file' &&
      receipt.resource.id === normalized
    );
  });
}

function meetsEvidenceJsonFieldCriterion(
  goal: AgentGoal,
  fieldPath: string,
  expectedValue: string,
): boolean {
  const normalizedPath = fieldPath.trim();
  const normalizedExpected = expectedValue.trim();
  if (!normalizedPath || !normalizedExpected) {
    return false;
  }

  return goal.evidence.some((entry) => {
    const parsed = extractJsonPayloadFromEvidenceEntry(entry);
    if (parsed === undefined) {
      return false;
    }
    const actual = readJsonFieldAtPath(parsed, normalizedPath);
    return structuralValuesMatch(actual, normalizedExpected);
  });
}

function meetsEvidenceFileHashCriterion(
  goal: AgentGoal,
  pathToken: string,
  algorithm: string,
  expectedDigest?: string,
): boolean {
  const normalizedPath = pathToken.trim();
  const normalizedAlgorithm = algorithm.trim().toLowerCase();
  const normalizedExpectedDigest = expectedDigest?.trim().toLowerCase() ?? '';
  if (!normalizedPath || !normalizedAlgorithm) {
    return false;
  }

  if (normalizedAlgorithm !== 'sha256') {
    return false;
  }
  return goal.evidence.some((entry) => {
    const receipt = parseToolEffectReceiptEvidence(entry);
    const digest = receipt?.resource.digest?.slice('sha256:'.length) ?? '';
    return (
      receipt?.transportState === 'returned' &&
      receipt.effectKind === 'artifact.write' &&
      receipt.effectState === 'applied' &&
      receipt.verificationState === 'verified' &&
      receipt.resource.kind === 'workspace_file' &&
      receipt.resource.id === normalizedPath &&
      /^[0-9a-f]{64}$/u.test(digest) &&
      (!normalizedExpectedDigest || digest === normalizedExpectedDigest)
    );
  });
}

function meetsEvidenceExitCodeCriterion(goal: AgentGoal, expectedExitCode: number): boolean {
  if (!Number.isInteger(expectedExitCode)) {
    return false;
  }
  if (expectedExitCode !== 0) {
    return false;
  }
  return goal.evidence.some((entry) => {
    const receipt = parseToolEffectReceiptEvidence(entry);
    return (
      receipt?.transportState === 'returned' &&
      receipt.effectKind === 'compute.execute' &&
      receipt.executionState === 'completed' &&
      (receipt.toolName === 'python' || receipt.toolName === 'javascript')
    );
  });
}

export function isSuccessCriterionMet(goal: AgentGoal, criterion: string): boolean {
  const effectCriterion = parseEffectCompletionCriterion(criterion);
  if (effectCriterion) {
    return goal.evidence.some((entry) => {
      const receipt = parseToolEffectReceiptEvidence(entry);
      return receipt ? effectReceiptEvidenceSatisfiesCriterion(receipt, effectCriterion) : false;
    });
  }

  const minMatch = criterion.match(EVIDENCE_MIN_PATTERN);
  if (minMatch) {
    return meetsEvidenceCountCriterion(goal, Number.parseInt(minMatch[1], 10));
  }

  const countMatch = criterion.match(EVIDENCE_COUNT_PATTERN);
  if (countMatch) {
    return meetsEvidenceCountCriterion(goal, Number.parseInt(countMatch[1], 10));
  }

  const prefixMatch = criterion.match(EVIDENCE_PREFIX_PATTERN);
  if (prefixMatch) {
    return meetsEvidencePrefixCriterion(goal, prefixMatch[1]);
  }

  const toolMatch = criterion.match(EVIDENCE_TOOL_PATTERN);
  if (toolMatch) {
    return meetsEvidenceToolCriterion(goal, toolMatch[1]);
  }

  const artifactMatch = criterion.match(EVIDENCE_ARTIFACT_PATTERN);
  if (artifactMatch) {
    return meetsEvidenceArtifactCriterion(goal, artifactMatch[1]);
  }

  const jsonFieldMatch = criterion.match(EVIDENCE_JSON_FIELD_PATTERN);
  if (jsonFieldMatch) {
    return meetsEvidenceJsonFieldCriterion(goal, jsonFieldMatch[1], jsonFieldMatch[2]);
  }

  const fileHashMatch = criterion.match(EVIDENCE_FILE_HASH_PATTERN);
  if (fileHashMatch) {
    return meetsEvidenceFileHashCriterion(
      goal,
      fileHashMatch[1],
      fileHashMatch[2],
      fileHashMatch[3],
    );
  }

  const exitCodeMatch = criterion.match(EVIDENCE_EXIT_CODE_PATTERN);
  if (exitCodeMatch) {
    return meetsEvidenceExitCodeCriterion(goal, Number.parseInt(exitCodeMatch[1], 10));
  }

  return false;
}

export function areGoalSuccessCriteriaSatisfied(
  goal: Pick<AgentGoal, 'evidence' | 'successCriteria'>,
): boolean {
  const criteria = goal.successCriteria ?? [];
  if (criteria.length === 0) {
    return goal.evidence.length > 0;
  }

  const hypotheticalGoal = {
    id: 'criteria-check',
    title: 'criteria-check',
    status: 'active' as const,
    dependencies: [],
    evidence: goal.evidence,
    successCriteria: criteria,
    createdAt: 0,
    updatedAt: 0,
  };
  return criteria.every((criterion) => isSuccessCriterionMet(hypotheticalGoal, criterion));
}

export function areBlockingGoalsStructurallyComplete(goals: ReadonlyArray<AgentGoal>): boolean {
  return goals.every(
    (goal) =>
      !isBlockingGoal(goal) ||
      (goal.status === 'completed' &&
        (goal.successCriteria?.length ?? 0) > 0 &&
        areGoalSuccessCriteriaSatisfied(goal)),
  );
}

export function evaluateGoalEvidenceGaps(goals: ReadonlyArray<AgentGoal>): GoalEvidenceGap[] {
  const gaps: GoalEvidenceGap[] = [];

  for (const goal of goals) {
    if (goal.status !== 'active' || !goal.successCriteria?.length) {
      continue;
    }

    for (const criterion of goal.successCriteria) {
      if (!isSuccessCriterionMet(goal, criterion)) {
        gaps.push({ goalId: goal.id, criterionId: criterion });
      }
    }
  }

  return gaps;
}

export function evaluateRequiredEffectEvidenceGaps(
  goals: ReadonlyArray<AgentGoal>,
): GoalEvidenceGap[] {
  const gaps: GoalEvidenceGap[] = [];

  for (const goal of goals) {
    if (goal.status !== 'active' && goal.status !== 'completed') {
      continue;
    }
    for (const criterion of goal.successCriteria ?? []) {
      if (parseEffectCompletionCriterion(criterion) && !isSuccessCriterionMet(goal, criterion)) {
        gaps.push({ goalId: goal.id, criterionId: criterion });
      }
    }
  }

  return gaps;
}

export function buildMissingRequiredEvidenceLabels(gaps: ReadonlyArray<GoalEvidenceGap>): string[] {
  return gaps.map((gap) => `${gap.goalId}:${gap.criterionId}`);
}
