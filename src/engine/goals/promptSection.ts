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
import type { AgentGoal } from './types';
import { resolveOrderedGoalCapabilities } from './toolSurface';

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
      if (g.dependencies.length > 0) {
        lines.push(`  deps: ${g.dependencies.join(', ')}`);
      }
      if (g.evidence.length > 0) {
        lines.push(`  evidence: ${g.evidence.length}`);
      }
      if (g.successCriteria?.length) {
        lines.push(`  criteria: ${g.successCriteria.join(', ')}`);
      }
    }
  }

  if (pending.length > 0) {
    lines.push('');
    lines.push('### Pending');
    for (const g of pending) {
      lines.push(renderGoalLine(g));
    }
  }

  if (blocked.length > 0) {
    lines.push('');
    lines.push('### Blocked');
    for (const g of blocked) {
      lines.push(renderGoalLine(g));
      if (g.blockedReason) {
        lines.push(`  blocked: ${g.blockedReason}`);
      }
    }
  }

  if (completed.length > 0) {
    lines.push('');
    lines.push(`### Completed (${completed.length})`);
    for (const g of completed.slice(-3)) {
      lines.push(renderGoalLine(g));
    }
  }

  const includeGoalMutationHint =
    options?.selectedToolNames === undefined ||
    isGoalMutationToolAvailable(options.selectedToolNames);
  if (includeGoalMutationHint) {
    lines.push('');
    lines.push(renderGoalMutationContractSection());
  }

  return lines.join('\n');
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
  return parts.join('');
}
