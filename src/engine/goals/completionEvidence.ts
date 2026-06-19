import type { AgentGoal } from './types';
import {
  extractJsonPayloadFromEvidenceEntry,
  readJsonFieldAtPath,
  structuralValuesMatch,
} from './structuralCriterionValues';

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

export function isRecognizedSuccessCriterionForm(criterion: string): boolean {
  return (
    EVIDENCE_MIN_PATTERN.test(criterion) ||
    EVIDENCE_COUNT_PATTERN.test(criterion) ||
    EVIDENCE_PREFIX_PATTERN.test(criterion) ||
    EVIDENCE_TOOL_PATTERN.test(criterion) ||
    EVIDENCE_ARTIFACT_PATTERN.test(criterion) ||
    EVIDENCE_JSON_FIELD_PATTERN.test(criterion) ||
    EVIDENCE_FILE_HASH_PATTERN.test(criterion) ||
    EVIDENCE_EXIT_CODE_PATTERN.test(criterion)
  );
}

export function isCountOnlySuccessCriterion(criterion: string): boolean {
  return EVIDENCE_MIN_PATTERN.test(criterion) || EVIDENCE_COUNT_PATTERN.test(criterion);
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
  return goal.evidence.some((entry) => entry.includes(normalized));
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

  const prefix = `file_hash:${normalizedPath}:${normalizedAlgorithm}:`;
  return goal.evidence.some((entry) => {
    const index = entry.indexOf(prefix);
    if (index < 0) {
      return false;
    }
    const digest = entry.slice(index + prefix.length).split(/[\s,;]/)[0] ?? '';
    if (!/^[0-9a-f]+$/i.test(digest)) {
      return false;
    }
    return !normalizedExpectedDigest || digest.toLowerCase() === normalizedExpectedDigest;
  });
}

function meetsEvidenceExitCodeCriterion(goal: AgentGoal, expectedExitCode: number): boolean {
  if (!Number.isInteger(expectedExitCode)) {
    return false;
  }
  const token = `exit_code:${expectedExitCode}`;
  return goal.evidence.some((entry) => entry.includes(token));
}

export function isSuccessCriterionMet(goal: AgentGoal, criterion: string): boolean {
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

export function buildMissingRequiredEvidenceLabels(gaps: ReadonlyArray<GoalEvidenceGap>): string[] {
  return gaps.map((gap) => `${gap.goalId}:${gap.criterionId}`);
}
