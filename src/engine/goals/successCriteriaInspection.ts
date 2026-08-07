// ---------------------------------------------------------------------------
// Kavi — Success criteria inspection
// ---------------------------------------------------------------------------
// Predicates that read a goal patch's declared success criteria: whether they are
// present, structural, specific, and whether any of them name evidence the graph can
// never produce. Split out of the mutation validator so that file stays focused on
// lifecycle rules rather than criterion parsing.
// ---------------------------------------------------------------------------

import { GOAL_BOOTSTRAP_TOOL_NAME } from './bootstrap';
import {
  isCountOnlySuccessCriterion,
  isRecognizedSuccessCriterionForm,
} from './completionEvidence';
import type { AgentGoal, AgentGoalMutation } from './types';
import { isRegisteredToolName } from '../tools/toolNameNormalization';
import { EFFECT_RECEIPT_EVIDENCE_PREFIX } from './effectCompletionEvidence';

const INTERNAL_DELIVERABLE_TOOL_NAMES = new Set([
  GOAL_BOOTSTRAP_TOOL_NAME,
  'tool_catalog',
  'tool_describe',
  'sessions_spawn',
  'sessions_send',
  'sessions_wait',
  'sessions_output',
  'sessions_history',
]);
const REGISTERED_NON_TOOL_EVIDENCE_PREFIXES = new Set(['worker']);
const CODE_OWNED_EVIDENCE_PREFIXES = [EFFECT_RECEIPT_EVIDENCE_PREFIX] as const;

export function resolvePatchCompletionPolicy(
  patch: AgentGoalMutation['goals'][number],
  existingGoals: ReadonlyArray<AgentGoal>,
): AgentGoal['completionPolicy'] | undefined {
  if (patch.completionPolicy === 'blocking' || patch.completionPolicy === 'persistent') {
    return patch.completionPolicy;
  }
  const goalId = patch.id?.trim();
  if (!goalId) {
    return undefined;
  }
  return existingGoals.find((goal) => goal.id === goalId)?.completionPolicy;
}

export function shouldValidateSuccessCriteria(
  patch: AgentGoalMutation['goals'][number],
  existingGoals: ReadonlyArray<AgentGoal>,
): boolean {
  return resolvePatchCompletionPolicy(patch, existingGoals) !== 'persistent';
}

export function hasStructuralSuccessCriteria(patch: AgentGoalMutation['goals'][number]): boolean {
  return (patch.successCriteria ?? []).some((criterion) =>
    isRecognizedSuccessCriterionForm(criterion),
  );
}

export function hasSpecificSuccessCriteria(patch: AgentGoalMutation['goals'][number]): boolean {
  return (patch.successCriteria ?? []).some(
    (criterion) =>
      isRecognizedSuccessCriterionForm(criterion) && !isCountOnlySuccessCriterion(criterion),
  );
}

export function findInvalidSuccessCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => criterion.length > 0 && !isRecognizedSuccessCriterionForm(criterion));
}

export function findInternalGraphEvidenceCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => referencesInternalGraphToolCriterion(criterion));
}

export function findUnknownToolEvidenceCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => {
      const toolToken = readEvidenceToolCriterionToken(criterion);
      return Boolean(toolToken && !isRegisteredToolName(toolToken));
    });
}

export function findUnknownEvidencePrefixCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => {
      const prefixToken = readEvidencePrefixCriterionToken(criterion);
      return Boolean(
        prefixToken &&
        !REGISTERED_NON_TOOL_EVIDENCE_PREFIXES.has(prefixToken) &&
        !isRegisteredToolName(prefixToken),
      );
    });
}

export function findCodeOwnedEvidence(patch: AgentGoalMutation['goals'][number]): ReadonlyArray<string> {
  return (patch.evidence ?? []).filter((evidence) =>
    CODE_OWNED_EVIDENCE_PREFIXES.some((prefix) => evidence.startsWith(prefix)),
  );
}

export function readEvidenceToolCriterionToken(criterion: string): string | null {
  const prefix = 'evidence.tool:';
  if (!criterion.startsWith(prefix)) {
    return null;
  }
  const toolToken = criterion.slice(prefix.length).trim();
  return toolToken.length > 0 ? toolToken : null;
}

export function readEvidencePrefixCriterionToken(criterion: string): string | null {
  const prefix = 'evidence.prefix:';
  if (!criterion.startsWith(prefix)) {
    return null;
  }
  const prefixToken = criterion.slice(prefix.length).trim();
  return prefixToken.length > 0 ? prefixToken : null;
}

export function referencesInternalGraphToolCriterion(criterion: string): boolean {
  for (const prefix of ['evidence.tool:', 'evidence.prefix:'] as const) {
    if (!criterion.startsWith(prefix)) {
      continue;
    }

    const toolToken = criterion.slice(prefix.length).trim();
    if (!toolToken) {
      continue;
    }

    const segments = toolToken
      .split(':')
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (segments.some((segment) => INTERNAL_DELIVERABLE_TOOL_NAMES.has(segment))) {
      return true;
    }
  }

  return false;
}

/**
 * A structural criterion names a resource — a workspace path or a JSON field path — so
 * its operand is an identifier, not a sentence. The grammar behind `evidence.artifact:`
 * and `evidence.json_field:` is `(.+)`, which accepts anything, and unlike
 * `evidence.tool:` and `evidence.prefix:` the operand was never checked. A model could
 * therefore declare a criterion that is well-formed, counts as "specific", and can never
 * be satisfied by any evidence the run produces.
 *
 * That is the state this guards against, traced live: a blocking goal accumulated
 * seventeen criteria, eleven of them over three hundred characters. None could ever
 * match, completion was refused every time, and blocking criteria are monotonic — a
 * criterion can never be removed — so there was no legal move left. The run spent ten
 * rejected mutations and thirty-two tool calls before stagnation detection ended it.
 * Refusing the criterion at declaration is the only point where the goal is still
 * repairable.
 */
const STRUCTURAL_CRITERION_OPERAND_MAX_LENGTH = 180;

function isResourceIdentifierOperand(operand: string): boolean {
  const value = operand.trim();
  if (!value || value.length > STRUCTURAL_CRITERION_OPERAND_MAX_LENGTH) {
    return false;
  }
  // Prose carries line breaks and sentence breaks; a path or field reference carries
  // neither. This checks the shape of the operand, not its words.
  return !/[\r\n]/.test(value) && !/[.!?]\s+\S/.test(value);
}

export function findUnsatisfiableStructuralCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  const operandPrefixes = ['evidence.artifact:', 'evidence.json_field:', 'evidence.file_hash:'];
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => {
      const prefix = operandPrefixes.find((entry) => criterion.startsWith(entry));
      if (!prefix) {
        return false;
      }
      return !isResourceIdentifierOperand(criterion.slice(prefix.length));
    });
}

/**
 * `evidence.json_field` reads a field out of a JSON payload, so its first operand is a
 * dotted field path — `calendar.allowsModifications` — not a file path. Every sibling
 * criterion takes a workspace path in that position (`evidence.artifact:<path>`,
 * `evidence.file_hash:<path>:<algo>`), and the documented form said `<path>` here too, so
 * naming the file instead of the field is the natural mistake to make.
 *
 * The result is silent and permanent: `readJsonFieldAtPath` looks for a field literally
 * named after the file, never finds one, and blocking criteria are monotonic so the
 * criterion cannot be withdrawn. Traced live on `direct-bfcl-v4-parallel-relevance` —
 * the goal declared `evidence.json_field:artifacts/bfcl-direct-output.txt:content:…`,
 * which the two-part grammar reads as field `artifacts/bfcl-direct-output.txt` and value
 * `content:…`. The write succeeded, completion was refused eight times, and every retry
 * rewrote the file and appended another effect criterion. Twenty-six tool calls, ended
 * blocked, with the deliverable sitting correct on disk the whole time.
 *
 * A path separator is the unambiguous tell: `readJsonFieldAtPath` splits on `.`, so a
 * segment carrying `/` or `\` is addressing a filesystem, not a document.
 */
export function findMisdirectedJsonFieldCriteria(
  patch: AgentGoalMutation['goals'][number],
): ReadonlyArray<string> {
  const prefix = 'evidence.json_field:';
  return (patch.successCriteria ?? [])
    .map((criterion) => criterion.trim())
    .filter((criterion) => {
      if (!criterion.startsWith(prefix)) {
        return false;
      }
      const fieldPath = criterion.slice(prefix.length).split(':')[0] ?? '';
      return /[/\\]/.test(fieldPath);
    });
}
