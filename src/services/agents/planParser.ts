import { AgentRunPlan, AgentRunWorkstream } from '../../types';
import { normalizeWorkflowWorkstreams } from './workflowScheduling';

export type ParsedAgentRunPlan = Omit<AgentRunPlan, 'updatedAt'>;

const DEFAULT_SUCCESS_CRITERIA = [
  'Produce the requested deliverable.',
  'Verify the result before finalizing.',
];

const DEFAULT_STOP_CONDITIONS = [
  'Stop when the deliverable is complete and the success criteria are satisfied.',
  'Stop early if a concrete blocker, missing permission, or dependency prevents further progress.',
];

type PlanSection = 'objective' | 'successCriteria' | 'stopConditions' | 'workstreams' | null;

const WORKSTREAM_CONTINUATION_PATTERN =
  /^(?:\|\s*)?(?:goal|success|success criteria|depends on|dependencies)\s*:/i;

function normalizeInlineList(value: string): string[] {
  return value
    .split(/[;,]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseListItem(line: string): string | null {
  const match = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
  return match?.[1]?.trim() || null;
}

function parseSectionHeader(
  line: string,
): { section: Exclude<PlanSection, null>; remainder?: string } | null {
  const normalizedLine = line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:[-*•]|\d+[.)])\s+/, '');
  const match = normalizedLine.match(
    /^(?:\*\*|__)?(Objective|Success Criteria|Stop Conditions|Workstreams)\s*:?(?:\*\*|__)?\s*(.*)$/i,
  );
  if (!match) {
    return null;
  }

  const label = match[1].toLowerCase();
  const remainder = match[2]?.trim() || undefined;
  if (label === 'objective') {
    return { section: 'objective', remainder };
  }
  if (label === 'success criteria') {
    return { section: 'successCriteria', remainder };
  }
  if (label === 'stop conditions') {
    return { section: 'stopConditions', remainder };
  }
  return { section: 'workstreams', remainder };
}

function appendListValue(target: string[], line: string) {
  const item = parseListItem(line);
  if (item) {
    target.push(item);
    return;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  if (target.length === 0) {
    target.push(trimmed);
    return;
  }

  target[target.length - 1] = `${target[target.length - 1]} ${trimmed}`.trim();
}

function shouldAppendWorkstreamContinuation(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }

  if (parseSectionHeader(line) || parseListItem(line)) {
    return false;
  }

  return /^\s/.test(line) || WORKSTREAM_CONTINUATION_PATTERN.test(trimmed);
}

function parseWorkstreamItem(text: string, index: number): AgentRunWorkstream | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const segments = trimmed.split(/\s+\|\s+/);
  const firstSegment = segments.shift() || trimmed;
  const emDashIndex = firstSegment.indexOf(' — ');
  const hyphenIndex = emDashIndex >= 0 ? -1 : firstSegment.indexOf(' - ');

  const titleSegment =
    emDashIndex >= 0
      ? firstSegment.slice(0, emDashIndex)
      : hyphenIndex >= 0
        ? firstSegment.slice(0, hyphenIndex)
        : firstSegment;
  const trailingGoal =
    emDashIndex >= 0
      ? firstSegment.slice(emDashIndex + 3)
      : hyphenIndex >= 0
        ? firstSegment.slice(hyphenIndex + 3)
        : undefined;

  const workstream: AgentRunWorkstream = {
    id: `workstream-${index + 1}`,
    title: titleSegment.trim(),
    goal: trailingGoal?.trim() || undefined,
  };

  for (const segment of segments) {
    const goalMatch = segment.match(/^goal\s*:\s*(.+)$/i);
    if (goalMatch) {
      workstream.goal = goalMatch[1].trim();
      continue;
    }

    const successMatch = segment.match(/^(?:success|success criteria)\s*:\s*(.+)$/i);
    if (successMatch) {
      workstream.successCriteria = normalizeInlineList(successMatch[1]);
      continue;
    }

    const dependencyMatch = segment.match(/^(?:depends on|dependencies)\s*:\s*(.+)$/i);
    if (dependencyMatch) {
      workstream.dependencies = normalizeInlineList(dependencyMatch[1]);
      continue;
    }

    if (!workstream.goal) {
      workstream.goal = segment.trim();
    }
  }

  return workstream.title ? workstream : null;
}

export function extractStructuredAgentPlan(text: string, fallbackGoal: string): ParsedAgentRunPlan {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const objectiveLines: string[] = [];
  const successCriteria: string[] = [];
  const stopConditions: string[] = [];
  const workstreamLines: string[] = [];
  let currentSection: PlanSection = null;

  for (const line of lines) {
    const header = parseSectionHeader(line);
    if (header) {
      currentSection = header.section;
      if (header.remainder) {
        if (header.section === 'objective') {
          objectiveLines.push(header.remainder);
        } else if (header.section === 'workstreams') {
          workstreamLines.push(header.remainder);
        } else if (header.section === 'successCriteria') {
          appendListValue(successCriteria, header.remainder);
        } else if (header.section === 'stopConditions') {
          appendListValue(stopConditions, header.remainder);
        }
      }
      continue;
    }

    if (currentSection === 'objective') {
      const trimmed = line.trim();
      if (trimmed) {
        objectiveLines.push(trimmed);
      }
      continue;
    }

    if (currentSection === 'successCriteria') {
      appendListValue(successCriteria, line);
      continue;
    }

    if (currentSection === 'stopConditions') {
      appendListValue(stopConditions, line);
      continue;
    }

    if (currentSection === 'workstreams') {
      const item = parseListItem(line);
      const trimmed = line.trim();
      if (item) {
        workstreamLines.push(item);
      } else if (
        trimmed &&
        workstreamLines.length > 0 &&
        shouldAppendWorkstreamContinuation(line)
      ) {
        workstreamLines[workstreamLines.length - 1] =
          `${workstreamLines[workstreamLines.length - 1]} ${trimmed}`.trim();
      } else if (trimmed) {
        currentSection = null;
      }
    }
  }

  const objective =
    objectiveLines.join(' ').trim() || fallbackGoal.trim() || 'Complete the current task.';
  const workstreams = workstreamLines
    .map((item, index) => parseWorkstreamItem(item, index))
    .filter((workstream): workstream is AgentRunWorkstream => !!workstream);

  return {
    objective,
    successCriteria: successCriteria.length ? successCriteria : [...DEFAULT_SUCCESS_CRITERIA],
    stopConditions: stopConditions.length ? stopConditions : [...DEFAULT_STOP_CONDITIONS],
    workstreams: normalizeWorkflowWorkstreams(workstreams),
    rawPlan: text.trim() || undefined,
  };
}
