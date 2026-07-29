import type {
  MemoryApplicabilityAnnotation,
  MemoryApplicabilityReason,
} from './memoryApplicabilityTypes';
import type { MemoryFact } from './facts/types';

export interface MemoryApplicabilityPromptFact {
  id: string;
  applicability?: MemoryApplicabilityAnnotation;
}

export type PromptMemoryFact = MemoryFact &
  MemoryApplicabilityPromptFact & { subjectLabel?: string };

export interface MemoryApplicabilityPromptEntry {
  action: 'ask' | 'abstain';
  reason: MemoryApplicabilityReason;
  renderedFact: string;
}

const RESOLUTION_HEADER = '## This Turn\n### Memory Resolution Required';
const RESOLUTION_NOTE =
  'These memory policy labels are binding. Ask items require user confirmation before reliance. Abstain items must not be asserted or used for an action until stronger evidence resolves the issue.';
export const MEMORY_APPLICABILITY_PROMPT_LIMITS = Object.freeze({
  sectionChars: 3_800,
  resolutionFacts: 4,
  renderedFactChars: 700,
});

function actionHeader(action: MemoryApplicabilityPromptEntry['action']): string {
  return action === 'ask' ? '#### Ask User to Confirm' : '#### Abstain Pending Evidence';
}

function fitLine(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function prioritizedResolutionFacts<T extends MemoryApplicabilityPromptFact>(
  facts: ReadonlyArray<T>,
): T[] {
  const abstain = facts.filter((fact) => fact.applicability?.action === 'abstain');
  const ask = facts.filter((fact) => fact.applicability?.action === 'ask');
  const anchors = [abstain[0], ask[0]].filter((fact): fact is T => Boolean(fact));
  return [...anchors, ...abstain.slice(1), ...ask.slice(1)].slice(
    0,
    MEMORY_APPLICABILITY_PROMPT_LIMITS.resolutionFacts,
  );
}

export function renderMemoryApplicabilityPromptSections<T extends MemoryApplicabilityPromptFact>(
  facts: ReadonlyArray<T>,
  renderFact: (fact: T) => string,
): string[] {
  const entries = prioritizedResolutionFacts(facts).flatMap(
    (fact): MemoryApplicabilityPromptEntry[] => {
      const applicability = fact.applicability;
      if (!applicability) return [];
      const action = applicability.action;
      if (action !== 'ask' && action !== 'abstain') return [];
      return [{ action, reason: applicability.reason, renderedFact: renderFact(fact) }];
    },
  );
  if (entries.length === 0) return [];
  const lines = [RESOLUTION_HEADER, RESOLUTION_NOTE];
  for (const action of ['abstain', 'ask'] as const) {
    const actionEntries = entries.filter((entry) => entry.action === action);
    if (actionEntries.length === 0) continue;
    lines.push(actionHeader(action));
    lines.push(
      ...actionEntries.map((entry) =>
        fitLine(entry.renderedFact, MEMORY_APPLICABILITY_PROMPT_LIMITS.renderedFactChars),
      ),
    );
  }
  const section = lines.join('\n');
  return [fitLine(section, MEMORY_APPLICABILITY_PROMPT_LIMITS.sectionChars)];
}

export function selectMemoryApplicabilityResolutionFactIds<T extends MemoryApplicabilityPromptFact>(
  facts: ReadonlyArray<T>,
): Set<string> {
  return new Set(prioritizedResolutionFacts(facts).map((fact) => fact.id));
}

export function selectDirectlyUsableMemoryFacts<T extends MemoryApplicabilityPromptFact>(
  facts: ReadonlyArray<T>,
): T[] {
  return facts.filter((fact) => !fact.applicability || fact.applicability.action === 'use');
}

export function renderMemoryApplicabilityMetadata(
  applicability: MemoryApplicabilityAnnotation | undefined,
): string {
  return applicability ? ` policy=${applicability.action} reason=${applicability.reason}` : '';
}
