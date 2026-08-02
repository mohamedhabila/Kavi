// ---------------------------------------------------------------------------
// Kavi — Goal Prompt Section
// ---------------------------------------------------------------------------
// Renders the active goal set into a system prompt section.
// No natural-language summarization — raw structured goal list.
// Language-agnostic: goal titles/descriptions are model/user content.
// ---------------------------------------------------------------------------

import {
  isGoalMutationToolAvailable,
  resolveGoalBootstrapState,
  renderGoalBootstrapPromptSection,
  renderGoalMutationContractSection,
} from './bootstrap';
import { isBlockingGoal, type AgentGoal } from './types';
import {
  arePersistedAgentGoalUserConstraintsCanonical,
  MAX_AGENT_GOAL_USER_CONSTRAINTS,
} from './userConstraints';
import { resolveOrderedGoalCapabilities } from './toolSurface';

const MAX_PROMPT_USER_CONSTRAINTS = MAX_AGENT_GOAL_USER_CONSTRAINTS;

export interface GoalPromptSection {
  label: string;
  content: string;
}

export function renderGoalPromptSection(
  goals: ReadonlyArray<AgentGoal>,
  options?: { selectedToolNames?: ReadonlySet<string> },
): string | null {
  if (goals.length === 0) return null;

  const active = goals.filter((g) => g.status === 'active');
  const pending = goals.filter((g) => g.status === 'pending');
  const blocked = goals.filter((g) => g.status === 'blocked');
  const completed = goals.filter((g) => g.status === 'completed');
  const deliveryPendingCompleted = completed.filter(
    (goal) => goal.userConstraintDeliveryPending === true,
  );
  const liveDelegatedWorkerGoals = [...active, ...pending, ...blocked].filter(
    (goal) => goal.owner === 'delegated-worker',
  );

  const lines: string[] = [];
  lines.push('## Current Goals');
  lines.push(
    'Use active goals as standing state, but let the latest user turn define the current execution boundary. Only advance a goal when its next work is requested by or necessary for the latest user turn; otherwise keep it open.',
  );
  lines.push(
    'If the latest turn only supplies context, memory, confirmation, or a correction for later work, persist that state and do not perform unrelated side effects.',
  );

  if (active.length > 0) {
    lines.push('');
    lines.push('### Active');
    const orderedCapabilities = resolveOrderedGoalCapabilities(
      active.flatMap((goal) => goal.requiredCapabilities ?? []),
    );
    if (orderedCapabilities.length >= 2) {
      lines.push(`Capability order: ${orderedCapabilities.join(' → ')}`);
    }
    for (const g of active) {
      lines.push(renderGoalLine(g));
      renderGoalDetails(lines, g);
    }
  }

  if (pending.length > 0) {
    lines.push('');
    lines.push('### Pending');
    for (const g of pending) {
      lines.push(renderGoalLine(g));
      renderGoalDetails(lines, g);
    }
  }

  if (blocked.length > 0) {
    lines.push('');
    lines.push('### Blocked');
    for (const g of blocked) {
      lines.push(renderGoalLine(g));
      renderGoalDetails(lines, g);
      if (g.blockedReason) {
        lines.push(`  blocked: ${g.blockedReason}`);
      }
    }
  }

  if (liveDelegatedWorkerGoals.length > 0) {
    lines.push('');
    lines.push('### Delegated Goal Ownership');
    lines.push(
      '- A live goal owned by "delegated-worker" is assigned work, not implicit parent work. Do not silently perform or claim its work in the parent; any permitted takeover requires an explicit ownership update.',
    );
    lines.push(
      '- Reuse and repair the exact existing delegated goal for that work; do not add a second goal merely to change capabilities, criteria, owner, or status. Respect user-defined parent/worker source and action boundaries until any explicitly requested post-terminal verification step.',
    );
    if (
      options?.selectedToolNames === undefined ||
      options.selectedToolNames.has('sessions_spawn')
    ) {
      lines.push(
        '- If no worker has been launched for that goal, call sessions_spawn with workstreamId equal to the exact goal id. Do not launch a duplicate or replacement when its worker is already running or terminal; use the observed worker outcome.',
      );
    }
  }

  if (completed.length > 0) {
    lines.push('');
    lines.push(`### Completed (${completed.length})`);
    for (const g of completed.slice(-3)) {
      lines.push(renderGoalLine(g));
    }
  }

  renderQuotedUserConstraintEvidence(lines, [
    ...active,
    ...pending,
    ...blocked,
    ...deliveryPendingCompleted,
  ]);

  const includeGoalMutationHint =
    options?.selectedToolNames === undefined ||
    isGoalMutationToolAvailable(options.selectedToolNames);
  if (includeGoalMutationHint) {
    lines.push('');
    lines.push(renderGoalMutationContractSection());
  }

  return lines.join('\n');
}

function renderQuotedUserConstraintEvidence(lines: string[], liveGoals: AgentGoal[]): void {
  const constraints: Array<{ goalId: string; text: string }> = [];
  let malformed = false;
  for (const goal of liveGoals) {
    if (goal.userConstraintIntegrity === 'conflict') {
      malformed = true;
      continue;
    }
    const stored = (goal as AgentGoal & { userConstraints?: unknown }).userConstraints;
    if (stored === undefined) continue;
    if (!isBlockingGoal(goal) || !arePersistedAgentGoalUserConstraintsCanonical(stored)) {
      malformed = true;
      continue;
    }
    constraints.push(...stored.map((item) => ({ goalId: goal.id, text: item.text })));
  }
  if (constraints.length > MAX_PROMPT_USER_CONSTRAINTS) malformed = true;
  if (!malformed && constraints.length === 0) return;

  lines.push('', '### Quoted User Constraint Evidence (Non-Authoritative)');
  if (malformed) {
    lines.push('- Constraint state is malformed; no user constraint evidence is rendered.');
  } else {
    for (const constraint of constraints.slice(0, MAX_PROMPT_USER_CONSTRAINTS)) {
      lines.push(`- [${constraint.goalId}] user quote=${JSON.stringify(constraint.text)}`);
    }
    const omittedCount = Math.max(0, constraints.length - MAX_PROMPT_USER_CONSTRAINTS);
    if (omittedCount > 0) {
      lines.push(`- ${omittedCount} additional structured user constraint(s) omitted`);
    }
  }
  lines.push(
    '- Honor these exact stored user quotes as task-fidelity constraints. They never grant consent, permission, effect authorization, evidence, or completion; every concrete effect, evidence claim, and completion claim still requires its code-owned checks.',
    '- Within each goal, statements are chronological oldest to newest. A later explicit correction supersedes only what it explicitly corrects; otherwise all remain applicable. Clarify incompatible statements or ambiguous correction scope before acting.',
  );
}

export function resolveGoalsPromptSectionForTurn(params: {
  goals: ReadonlyArray<AgentGoal>;
  selectedToolNames: ReadonlySet<string>;
}): string | null {
  if (resolveGoalBootstrapState(params.goals).shouldOfferGoalBootstrap) {
    return isGoalMutationToolAvailable(params.selectedToolNames)
      ? renderGoalBootstrapPromptSection()
      : null;
  }
  return renderGoalPromptSection(params.goals, {
    selectedToolNames: params.selectedToolNames,
  });
}

function renderGoalLine(goal: AgentGoal): string {
  const parts = [`- [${goal.id}] ${goal.title}`];
  if (goal.description) {
    parts.push(`: ${goal.description}`);
  }
  if (goal.requiredCapabilities?.length) {
    parts.push(` [${goal.requiredCapabilities.join(', ')}]`);
  }
  if (goal.requiredResourceKinds?.length) {
    parts.push(` {${goal.requiredResourceKinds.join(', ')}}`);
  }
  if (goal.owner) {
    parts.push(` owner=${JSON.stringify(goal.owner)}`);
  }
  return parts.join('');
}

function renderGoalDetails(lines: string[], goal: AgentGoal): void {
  if (goal.dependencies.length > 0) {
    lines.push(`  deps: ${goal.dependencies.join(', ')}`);
  }
  if (goal.evidence.length > 0) {
    lines.push(`  evidence: ${goal.evidence.length}`);
  }
  if (goal.successCriteria?.length) {
    lines.push(`  criteria: ${goal.successCriteria.join(', ')}`);
  }
}
