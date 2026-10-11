// ---------------------------------------------------------------------------
// Kavi — The run's plan
// ---------------------------------------------------------------------------
// A plan is the model's own checklist for multi-step work: the steps it intends and how
// far it got. It records intent and nothing gates on it — the model ends a request by
// answering. This is the shape agent loops converged on: Codex's `update_plan` takes
// `{ explanation?, plan: [{ step, status }] }`, replaces the whole list, and replies
// "Plan updated".
// ---------------------------------------------------------------------------

import type { AgentPlanStep, AgentPlanStepStatus } from '../../types/agentRun';

const AGENT_PLAN_STEP_STATUSES: ReadonlyArray<AgentPlanStepStatus> = [
  'pending',
  'in_progress',
  'completed',
];

/** Longest plan kept, so a runaway list cannot grow the prompt or the stored run. */
export const MAX_AGENT_PLAN_STEPS = 50;
/** Longest step text kept, for the same reason. */
export const MAX_AGENT_PLAN_STEP_CHARS = 500;

function isPlanStepStatus(value: unknown): value is AgentPlanStepStatus {
  return (AGENT_PLAN_STEP_STATUSES as ReadonlyArray<unknown>).includes(value);
}

function boundStepText(text: string): string {
  return text.length > MAX_AGENT_PLAN_STEP_CHARS ? text.slice(0, MAX_AGENT_PLAN_STEP_CHARS) : text;
}

/**
 * The plan as stored on a run: well-formed steps only, bounded. Used for persisted
 * runs, so anything malformed is dropped rather than rejected.
 */
export function normalizeAgentPlan(value: unknown): AgentPlanStep[] {
  if (!Array.isArray(value)) return [];
  const steps: AgentPlanStep[] = [];
  for (const entry of value) {
    if (steps.length >= MAX_AGENT_PLAN_STEPS) break;
    if (!entry || typeof entry !== 'object') continue;
    const { step, status } = entry as Record<string, unknown>;
    if (typeof step !== 'string' || !step.trim() || !isPlanStepStatus(status)) continue;
    steps.push({ step: boundStepText(step.trim()), status });
  }
  return steps;
}

type UpdatePlanArguments = Readonly<{ plan: AgentPlanStep[]; explanation?: string }>;

const EXPECTED_SHAPE =
  'Expected {"plan":[{"step":"<what to do>","status":"pending|in_progress|completed"}],"explanation":"<optional>"}.';

/** Reads an update_plan call. Only the shape is checked; what the plan says is the model's. */
export function parseUpdatePlanArguments(
  args: unknown,
): { arguments: UpdatePlanArguments } | { error: string } {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { error: `update_plan arguments must be an object. ${EXPECTED_SHAPE}` };
  }
  const { plan, explanation } = args as Record<string, unknown>;
  if (!Array.isArray(plan)) {
    return { error: `update_plan needs a plan array. ${EXPECTED_SHAPE}` };
  }
  if (plan.length > MAX_AGENT_PLAN_STEPS) {
    return { error: `A plan holds at most ${MAX_AGENT_PLAN_STEPS} steps.` };
  }
  const steps: AgentPlanStep[] = [];
  for (const [index, entry] of plan.entries()) {
    const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    if (typeof record.step !== 'string' || !record.step.trim()) {
      return { error: `Plan step ${index + 1} needs non-empty step text. ${EXPECTED_SHAPE}` };
    }
    if (!isPlanStepStatus(record.status)) {
      return {
        error: `Plan step ${index + 1} needs a status of pending, in_progress or completed.`,
      };
    }
    steps.push({ step: boundStepText(record.step.trim()), status: record.status });
  }
  return {
    arguments: {
      plan: steps,
      ...(typeof explanation === 'string' && explanation.trim()
        ? { explanation: explanation.trim() }
        : {}),
    },
  };
}

const STATUS_MARKERS: Readonly<Record<AgentPlanStepStatus, string>> = {
  completed: '[x]',
  in_progress: '[>]',
  pending: '[ ]',
};

/**
 * The plan as the model sees it on each turn, so it survives compaction and long
 * conversations that drop the tool history. Nothing when there is no plan.
 */
export function renderPlanPromptSection(plan: ReadonlyArray<AgentPlanStep> | undefined): string {
  if (!plan?.length) return '';
  return [
    '## Plan',
    'Your checklist for this work, as you last set it with update_plan. It records progress; it does not decide when you are done.',
    ...plan.map((entry) => `- ${STATUS_MARKERS[entry.status]} ${entry.step}`),
  ].join('\n');
}
