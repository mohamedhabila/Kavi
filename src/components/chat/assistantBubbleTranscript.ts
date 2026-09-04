import { Attachment } from '../../types/attachment';
import { Message, ToolCall } from '../../types/message';
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

function formatAttachmentLine(attachment: Attachment, t: TranslateFn): string {
  const details = [
    attachment.type,
    attachment.mimeType?.trim() || undefined,
    Number.isFinite(attachment.size) && attachment.size > 0
      ? t('assistantExport.attachmentSizeBytes', { size: Math.round(attachment.size) })
      : undefined,
    attachment.workspacePath?.trim()
      ? t('assistantExport.attachmentWorkspacePath', { path: attachment.workspacePath.trim() })
      : undefined,
  ].filter(Boolean);

  return `- ${attachment.name || t('chat.attachmentFallbackName')}${details.length ? ` (${details.join(' | ')})` : ''}`;
}

function pushToolCallSection(lines: string[], toolCall: ToolCall, t: TranslateFn): void {
  lines.push(`#### ${toolCall.name}`);
  lines.push('');
  lines.push(`- ${t('assistantExport.statusLine', { status: toolCall.status })}`);

  const summary = summarizeToolCall(toolCall, t);
  if (summary) {
    lines.push(`- ${t('assistantExport.summaryLine', { summary })}`);
  }

  if (toolCall.arguments?.trim()) {
    lines.push('');
    lines.push(t('assistantExport.argumentsHeading'));
    lines.push('```json');
    lines.push(toolCall.arguments.trim());
    lines.push('```');
  }

  const toolOutput = toolCall.error?.trim() || toolCall.result?.trim();
  if (toolOutput) {
    lines.push('');
    lines.push(
      toolCall.error ? t('assistantExport.errorOutputLabel') : t('assistantExport.resultLabel'),
    );
    lines.push('```text');
    lines.push(toolOutput);
    lines.push('```');
  }

  lines.push('');
}

function pushSubAgentSection(
  lines: string[],
  segment: NonNullable<ReturnType<typeof buildAssistantBubbleViewModel>['contentSegments']>[number],
  t: TranslateFn,
): void {
  const snapshot = segment.subAgentEvent?.snapshot;
  if (!snapshot) {
    return;
  }

  lines.push(`### ${t('assistantExport.workerUpdateHeading')}`);
  lines.push('');
  lines.push(`- ${t('assistantExport.sessionLine', { id: snapshot.sessionId })}`);
  lines.push(`- ${t('assistantExport.statusLine', { status: snapshot.status })}`);
  lines.push(`- ${t('assistantExport.depthLine', { depth: snapshot.depth })}`);
  if (snapshot.name?.trim()) {
    lines.push(`- ${t('assistantExport.nameLine', { name: snapshot.name.trim() })}`);
  }
  if (snapshot.currentActivity?.trim()) {
    lines.push(`- ${t('assistantExport.activityLine', { activity: snapshot.currentActivity.trim() })}`);
  }
  if (snapshot.output?.trim()) {
    lines.push('');
    lines.push(t('assistantExport.workerOutputLabel'));
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
    `# ${params.t('assistantExport.responseHeading', { label: params.assistantLabel })}`,
    '',
    `_${params.t('assistantExport.generated', { timestamp: formatTimestamp(params.message.timestamp) })}_`,
  ];

  if (!bubbleModel.contentSegments.length) {
    lines.push('', params.t('assistantExport.noContent'));
    return `${lines.join('\n').trim()}\n`;
  }

  bubbleModel.contentSegments.forEach((segment, index) => {
    lines.push('');
    lines.push(`## ${params.t('assistantExport.segmentHeading', { index: index + 1 })}`);
    lines.push('');
    lines.push(
      `- ${params.t('assistantExport.timestampLine', { timestamp: formatTimestamp(segment.timestamp) })}`,
    );

    const reasoning = getRenderableThinkingText(segment.reasoning);
    if (reasoning) {
      lines.push('');
      lines.push(`### ${params.t('assistantExport.thinkingHeading')}`);
      lines.push('');
      lines.push(reasoning);
    }

    if (segment.subAgentEvent) {
      lines.push('');
      pushSubAgentSection(lines, segment, params.t);
    } else if (segment.content.trim()) {
      lines.push('');
      lines.push(`### ${params.t('assistantExport.contentHeading')}`);
      lines.push('');
      lines.push(segment.content.trim());
    }

    if (segment.attachments?.length) {
      lines.push('');
      lines.push(`### ${params.t('assistantExport.attachmentsHeading')}`);
      lines.push('');
      segment.attachments.forEach((attachment) => {
        lines.push(formatAttachmentLine(attachment, params.t));
      });
    }

    if (segment.toolCalls?.length) {
      lines.push('');
      lines.push(`### ${params.t('assistantExport.toolCallsHeading')}`);
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
      lines.push(`> ${params.t('assistantExport.segmentErrorNotice')}`);
    }
  });

  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
