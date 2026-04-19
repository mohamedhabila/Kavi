import { Attachment, Message, ToolCall } from '../../types';
import { buildAssistantBubbleViewModel } from './assistantBubbleModel';
import { getRenderableThinkingText } from './ThinkingBlock';
import { summarizeToolCall } from './ToolCallDisplay';
import { DisplayResponseSegment } from './messageGrouping';

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function buildAssistantResponseFileStamp(timestamp: number): string {
  return new Date(timestamp)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:]/g, '-');
}

function formatAttachmentLine(attachment: Attachment): string {
  const details = [
    attachment.type,
    attachment.mimeType?.trim() || undefined,
    Number.isFinite(attachment.size) && attachment.size > 0
      ? `${Math.round(attachment.size)} bytes`
      : undefined,
    attachment.workspacePath?.trim() ? `workspace: ${attachment.workspacePath.trim()}` : undefined,
  ].filter(Boolean);

  return `- ${attachment.name || 'Attachment'}${details.length ? ` (${details.join(' | ')})` : ''}`;
}

function pushToolCallSection(lines: string[], toolCall: ToolCall, t: TranslateFn): void {
  lines.push(`#### ${toolCall.name}`);
  lines.push('');
  lines.push(`- Status: ${toolCall.status}`);

  const summary = summarizeToolCall(toolCall, t);
  if (summary) {
    lines.push(`- Summary: ${summary}`);
  }

  if (toolCall.arguments?.trim()) {
    lines.push('');
    lines.push('Arguments:');
    lines.push('```json');
    lines.push(toolCall.arguments.trim());
    lines.push('```');
  }

  const toolOutput = toolCall.error?.trim() || toolCall.result?.trim();
  if (toolOutput) {
    lines.push('');
    lines.push(toolCall.error ? 'Error output:' : 'Result:');
    lines.push('```text');
    lines.push(toolOutput);
    lines.push('```');
  }

  lines.push('');
}

function pushSubAgentSection(
  lines: string[],
  segment: NonNullable<ReturnType<typeof buildAssistantBubbleViewModel>['contentSegments']>[number],
): void {
  const snapshot = segment.subAgentEvent?.snapshot;
  if (!snapshot) {
    return;
  }

  lines.push('### Worker update');
  lines.push('');
  lines.push(`- Session: ${snapshot.sessionId}`);
  lines.push(`- Status: ${snapshot.status}`);
  lines.push(`- Depth: ${snapshot.depth}`);
  if (snapshot.name?.trim()) {
    lines.push(`- Name: ${snapshot.name.trim()}`);
  }
  if (snapshot.currentActivity?.trim()) {
    lines.push(`- Activity: ${snapshot.currentActivity.trim()}`);
  }
  if (snapshot.output?.trim()) {
    lines.push('');
    lines.push('Worker output:');
    lines.push(snapshot.output.trim());
  }
}

export function buildAssistantBubbleTranscriptFileName(
  message: Pick<Message, 'timestamp'>,
): string {
  return `assistant-response-${buildAssistantResponseFileStamp(message.timestamp)}.md`;
}

export function buildAssistantBubbleTranscriptMarkdown(params: {
  message: Message;
  responseSegments?: Array<DisplayResponseSegment & { isStreaming?: boolean }>;
  isStreaming?: boolean;
  assistantLabel: string;
  t: TranslateFn;
}): string {
  const bubbleModel = buildAssistantBubbleViewModel({
    message: params.message,
    responseSegments: params.responseSegments,
    isStreaming: params.isStreaming,
  });

  const lines: string[] = [
    `# ${params.assistantLabel} response`,
    '',
    `_Generated: ${formatTimestamp(params.message.timestamp)}_`,
  ];

  if (!bubbleModel.contentSegments.length) {
    lines.push('', 'No shareable response content was available.');
    return `${lines.join('\n').trim()}\n`;
  }

  bubbleModel.contentSegments.forEach((segment, index) => {
    lines.push('');
    lines.push(`## Segment ${index + 1}`);
    lines.push('');
    lines.push(`- Timestamp: ${formatTimestamp(segment.timestamp)}`);

    const reasoning = getRenderableThinkingText(segment.reasoning);
    if (reasoning) {
      lines.push('');
      lines.push('### Thinking');
      lines.push('');
      lines.push(reasoning);
    }

    if (segment.subAgentEvent) {
      lines.push('');
      pushSubAgentSection(lines, segment);
    } else if (segment.content.trim()) {
      lines.push('');
      lines.push('### Content');
      lines.push('');
      lines.push(segment.content.trim());
    }

    if (segment.attachments?.length) {
      lines.push('');
      lines.push('### Attachments');
      lines.push('');
      segment.attachments.forEach((attachment) => {
        lines.push(formatAttachmentLine(attachment));
      });
    }

    if (segment.toolCalls?.length) {
      lines.push('');
      lines.push('### Tool calls');
      lines.push('');
      segment.toolCalls.forEach((toolCall) => {
        pushToolCallSection(lines, toolCall, params.t);
      });
      while (lines[lines.length - 1] === '') {
        lines.pop();
      }
    }

    if (segment.isError) {
      lines.push('');
      lines.push('> This segment is marked as an error.');
    }
  });

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
