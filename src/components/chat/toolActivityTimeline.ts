// ---------------------------------------------------------------------------
// Kavi — Tool activity compression for the assistant timeline
// ---------------------------------------------------------------------------
// An agentic answer is built over several model steps, and each step used to render
// its tool calls as their own rows: a five-step task put five cards, and the thinking
// between them, ahead of the answer the user asked for. Consecutive tool steps are
// folded into one activity item that reads as a single line of progress and expands to
// the individual steps on request.
//
// Only consecutive steps fold. Visible narration, attachments, errors, and worker cards
// stay where they are, so the transcript keeps its real order; thinking that sits
// between two tool steps belongs to that work and folds with it.
// ---------------------------------------------------------------------------

import type { ToolCall } from '../../types/message';
import type { AssistantBubbleSegment, AssistantBubbleTimelineItem } from './assistantBubbleModel';

/** Fewest tool calls worth folding: a group of one is a row with extra chrome. */
export const MIN_FOLDED_TOOL_CALLS = 2;

type ReasoningTimelineItem = Extract<AssistantBubbleTimelineItem, { kind: 'reasoning' }>;
type ContentTimelineItem = Extract<AssistantBubbleTimelineItem, { kind: 'content' }>;

export type ToolActivityStep =
  | { kind: 'reasoning'; id: string; item: ReasoningTimelineItem }
  | { kind: 'tools'; id: string; toolCalls: ToolCall[] };

export type ToolActivityTimelineItem = {
  kind: 'tool_activity';
  id: string;
  sourceSegmentId: string;
  steps: ToolActivityStep[];
  toolCalls: ToolCall[];
};

export type CompressedTimelineItem = AssistantBubbleTimelineItem | ToolActivityTimelineItem;

function hasVisibleNonToolContent(segment: AssistantBubbleSegment): boolean {
  return (
    !!segment.subAgentEvent ||
    segment.content.trim().length > 0 ||
    !!segment.attachments?.length ||
    !!segment.isError
  );
}

/**
 * A content item split into what stays in place (narration, attachments, errors) and the
 * tool calls that may fold. Worker segments render their own card and never split.
 */
function splitContentItem(item: ContentTimelineItem): {
  visible?: ContentTimelineItem;
  toolCalls?: ToolCall[];
} {
  const { segment } = item;
  if (segment.subAgentEvent || !segment.toolCalls?.length) {
    return { visible: item };
  }
  return {
    ...(hasVisibleNonToolContent(segment)
      ? { visible: { ...item, segment: { ...segment, toolCalls: undefined } } }
      : {}),
    toolCalls: segment.toolCalls,
  };
}

type PendingRun = {
  steps: ToolActivityStep[];
  /** The original items, re-emitted unchanged when the run is too short to fold. */
  originals: AssistantBubbleTimelineItem[];
  /**
   * Narration from the run's first item when that item also carried tool calls. It is
   * shown above the fold; when nothing folds, the original item is re-emitted whole.
   */
  leadingNarration?: ContentTimelineItem;
  sourceSegmentId?: string;
};

function emptyRun(): PendingRun {
  return { steps: [], originals: [] };
}

function countToolCalls(steps: ReadonlyArray<ToolActivityStep>): number {
  return steps.reduce(
    (total, step) => total + (step.kind === 'tools' ? step.toolCalls.length : 0),
    0,
  );
}

export function compressToolActivityTimeline(
  items: ReadonlyArray<AssistantBubbleTimelineItem>,
): CompressedTimelineItem[] {
  const output: CompressedTimelineItem[] = [];
  let run = emptyRun();

  const flush = () => {
    // Thinking after the last tool step leads into what follows, not into the work.
    const trailing: ToolActivityStep[] = [];
    while (run.steps.length > 0 && run.steps[run.steps.length - 1]!.kind === 'reasoning') {
      trailing.unshift(run.steps.pop()!);
    }
    if (countToolCalls(run.steps) >= MIN_FOLDED_TOOL_CALLS) {
      const firstStep = run.steps[0]!;
      if (run.leadingNarration) {
        output.push(run.leadingNarration);
      }
      output.push({
        kind: 'tool_activity',
        id: `tool-activity-${firstStep.id}`,
        sourceSegmentId: run.sourceSegmentId ?? firstStep.id,
        steps: run.steps,
        toolCalls: run.steps.flatMap((step) => (step.kind === 'tools' ? step.toolCalls : [])),
      });
      output.push(
        ...trailing.map((step) => (step as Extract<ToolActivityStep, { kind: 'reasoning' }>).item),
      );
    } else {
      output.push(...run.originals);
    }
    run = emptyRun();
  };

  for (const item of items) {
    if (item.kind === 'reasoning') {
      run.steps.push({ kind: 'reasoning', id: item.id, item });
      run.originals.push(item);
      run.sourceSegmentId ??= item.sourceSegmentId;
      continue;
    }

    const { visible, toolCalls } = splitContentItem(item);
    if (visible && !toolCalls) {
      flush();
      output.push(visible);
      continue;
    }
    if (visible && toolCalls) {
      // Narration that introduces a tool step opens a new run: it stays visible above
      // the folded work, and nothing before it can join that fold.
      flush();
      run.leadingNarration = visible;
    }
    run.steps.push({ kind: 'tools', id: item.id, toolCalls: toolCalls! });
    run.originals.push(item);
    run.sourceSegmentId ??= item.sourceSegmentId;
  }
  flush();

  return output;
}

export type ToolActivitySummary = {
  total: number;
  settled: number;
  failed: number;
  /** The most recent call still running or queued, if any. */
  active?: ToolCall;
};

export function summarizeToolActivity(toolCalls: ReadonlyArray<ToolCall>): ToolActivitySummary {
  let settled = 0;
  let failed = 0;
  let active: ToolCall | undefined;
  for (const toolCall of toolCalls) {
    if (toolCall.status === 'completed' || toolCall.status === 'failed') {
      settled += 1;
      if (toolCall.status === 'failed') failed += 1;
    } else {
      active = toolCall;
    }
  }
  return { total: toolCalls.length, settled, failed, ...(active ? { active } : {}) };
}
