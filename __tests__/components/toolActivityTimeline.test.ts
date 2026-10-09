import type { AssistantBubbleTimelineItem } from '../../src/components/chat/assistantBubbleModel';
import {
  compressToolActivityTimeline,
  summarizeToolActivity,
} from '../../src/components/chat/toolActivityTimeline';
import type { ToolCall } from '../../src/types/message';

function tool(id: string, status: ToolCall['status'] = 'completed', name = 'read_file'): ToolCall {
  return { id, name, arguments: '{}', status };
}

function content(
  segmentId: string,
  overrides: { content?: string; toolCalls?: ToolCall[]; isError?: boolean; worker?: boolean } = {},
): AssistantBubbleTimelineItem {
  return {
    kind: 'content',
    id: `content-${segmentId}`,
    sourceSegmentId: segmentId,
    segment: {
      id: segmentId,
      messageId: `m-${segmentId}`,
      content: overrides.content ?? '',
      timestamp: 1,
      ...(overrides.toolCalls ? { toolCalls: overrides.toolCalls } : {}),
      ...(overrides.isError ? { isError: true } : {}),
      ...(overrides.worker
        ? { subAgentEvent: { snapshot: { sessionId: 's', depth: 1 } } as never }
        : {}),
    },
  };
}

function reasoning(segmentId: string): AssistantBubbleTimelineItem {
  return {
    kind: 'reasoning',
    id: `reasoning-${segmentId}`,
    sourceSegmentId: segmentId,
    reasoning: `thinking in ${segmentId}`,
    timestamp: 1,
  };
}

function shape(items: ReturnType<typeof compressToolActivityTimeline>): string[] {
  return items.map((item) =>
    item.kind === 'tool_activity'
      ? `fold[${item.steps.map((step) => (step.kind === 'tools' ? step.toolCalls.map((call) => call.id).join('+') : 'think')).join(',')}]`
      : item.kind === 'reasoning'
        ? 'think'
        : item.segment.content
          ? `text:${item.segment.content}`
          : `tools:${(item.segment.toolCalls ?? []).map((call) => call.id).join('+')}`,
  );
}

describe('compressToolActivityTimeline', () => {
  it('folds consecutive tool steps, and the thinking between them, into one activity item', () => {
    const items = compressToolActivityTimeline([
      content('s1', { content: 'Let me check your calendar.', toolCalls: [tool('a')] }),
      reasoning('s2'),
      content('s2', { toolCalls: [tool('b')] }),
      content('s3', { toolCalls: [tool('c'), tool('d')] }),
      reasoning('s4'),
      content('s4', { content: 'You are free on Tuesday.' }),
    ]);

    expect(shape(items)).toEqual([
      'text:Let me check your calendar.',
      'fold[a,think,b,c+d]',
      'think',
      'text:You are free on Tuesday.',
    ]);
  });

  it('leaves a lone tool call as an ordinary row', () => {
    const original = [
      content('s1', { toolCalls: [tool('a')] }),
      content('s2', { content: 'Done.' }),
    ];

    expect(compressToolActivityTimeline(original)).toEqual(original);
  });

  it('re-emits narration with its single tool call unchanged when nothing folds', () => {
    const original = [
      content('s1', { content: 'Saving that now.', toolCalls: [tool('a')] }),
      content('s2', { content: 'Saved.' }),
    ];

    expect(compressToolActivityTimeline(original)).toEqual(original);
  });

  it('shows narration above the fold it introduces, with unique keys', () => {
    const items = compressToolActivityTimeline([
      content('s1', { content: 'Checking two calendars.', toolCalls: [tool('a')] }),
      content('s2', { toolCalls: [tool('b')] }),
    ]);

    expect(shape(items)).toEqual(['text:Checking two calendars.', 'fold[a,b]']);
    const ids = items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never folds across visible narration, an error, or a worker card', () => {
    const items = compressToolActivityTimeline([
      content('s1', { toolCalls: [tool('a')] }),
      content('s2', { content: 'Halfway there.' }),
      content('s3', { toolCalls: [tool('b')] }),
      content('s4', { isError: true }),
      content('s5', { toolCalls: [tool('c')], worker: true }),
      content('s6', { toolCalls: [tool('d')] }),
    ]);

    expect(items.some((item) => item.kind === 'tool_activity')).toBe(false);
    expect(items).toHaveLength(6);
  });

  it('keeps the fold id stable as more steps stream in, so its open state survives', () => {
    const first = compressToolActivityTimeline([
      content('s1', { toolCalls: [tool('a')] }),
      content('s2', { toolCalls: [tool('b', 'running')] }),
    ]);
    const later = compressToolActivityTimeline([
      content('s1', { toolCalls: [tool('a')] }),
      content('s2', { toolCalls: [tool('b')] }),
      content('s3', { toolCalls: [tool('c', 'running')] }),
    ]);

    expect(first[0]?.id).toBe(later[0]?.id);
  });
});

describe('summarizeToolActivity', () => {
  it('reports progress, failures, and the step still running', () => {
    const running = tool('c', 'running');

    expect(summarizeToolActivity([tool('a'), tool('b', 'failed'), running])).toEqual({
      total: 3,
      settled: 2,
      failed: 1,
      active: running,
    });
  });

  it('has no active step once every call has settled', () => {
    expect(summarizeToolActivity([tool('a'), tool('b')])).toEqual({
      total: 2,
      settled: 2,
      failed: 0,
    });
  });
});
