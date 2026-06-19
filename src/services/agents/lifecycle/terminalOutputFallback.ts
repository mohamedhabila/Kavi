import type { Message } from '../../../types/message';
import type { SubAgentResult } from '../../../types/subAgent';
import { truncateTranscriptText } from './sessionContextMessages';
import { OUTPUT_TRUNCATION } from './runConfig';
import { normalizePreviewText } from './runText';

export function buildToolResultFallback(params: {
  status: SubAgentResult['status'];
  lastNonEmptyContent: string;
  toolResultPreviews: Array<{ toolName: string; preview: string }>;
  toolsUsed: string[];
  iterations: number;
  maxToolResultPreviewChars: number;
  outputTruncation?: number;
}): string | undefined {
  const outputTruncation = params.outputTruncation ?? OUTPUT_TRUNCATION;
  const sections: string[] = [];
  const baseText = normalizePreviewText(params.lastNonEmptyContent, outputTruncation);
  if (baseText) {
    sections.push(baseText);
  }

  const uniquePreviews = params.toolResultPreviews
    .map((entry) => ({
      toolName: entry.toolName,
      preview: normalizePreviewText(entry.preview, params.maxToolResultPreviewChars),
    }))
    .filter((entry): entry is { toolName: string; preview: string } => Boolean(entry.preview));

  const dedupedPreviewMap = new Map<string, string>();
  for (const entry of uniquePreviews) {
    dedupedPreviewMap.set(
      `${entry.toolName}:${entry.preview}`,
      `${entry.toolName}: ${entry.preview}`,
    );
  }
  const previewLines = Array.from(dedupedPreviewMap.values()).slice(-10);

  if (previewLines.length > 0) {
    const intro =
      params.status === 'cancelled'
        ? 'Latest verified worker findings before cancellation:'
        : params.status === 'timeout'
          ? 'Latest verified worker findings before timeout:'
          : params.status === 'error'
            ? 'Latest verified worker findings before the error:'
            : 'Latest verified worker findings:';
    sections.push([intro, ...previewLines.map((line) => `- ${line}`)].join('\n'));
  }

  if (sections.length === 0 && params.toolsUsed.length > 0) {
    const uniqueTools = [...new Set(params.toolsUsed)];
    sections.push(
      params.status === 'completed'
        ? `[Sub-agent completed ${params.iterations} tool iteration(s) using: ${uniqueTools.join(', ')}]`
        : `[Sub-agent ${params.status}: completed ${params.iterations} tool iteration(s) using: ${uniqueTools.join(', ')}]`,
    );
  }

  return sections.join('\n\n') || undefined;
}

export function buildSubAgentFinalizationPrompt(params: {
  originalPrompt: string;
  transcriptMessages: Message[];
  toolsUsed: string[];
  iterations: number;
  finalizationMaxTranscriptMessages: number;
  finalizationMessageCharLimit: number;
  finalizationToolContentCharLimit: number;
}): string {
  const transcript = params.transcriptMessages
    .slice(-params.finalizationMaxTranscriptMessages)
    .map((message) => {
      if (message.role === 'user') {
        return `User task:\n${truncateTranscriptText(message.content, params.finalizationMessageCharLimit) || '[No task details]'}`;
      }

      if (message.role === 'assistant') {
        const requestedTools = message.toolCalls?.length
          ? ` (requested tools: ${message.toolCalls.map((toolCall) => toolCall.name).join(', ')})`
          : '';
        const body =
          truncateTranscriptText(message.content, params.finalizationMessageCharLimit) ||
          '[No visible assistant text]';
        return `Assistant${requestedTools}:\n${body}`;
      }

      const toolName = message.toolCalls?.[0]?.name || message.toolCallId || 'tool';
      const toolBody =
        truncateTranscriptText(message.content, params.finalizationToolContentCharLimit) ||
        '[No tool output]';
      return `Tool result - ${toolName}:\n${toolBody}`;
    })
    .join('\n\n');

  const toolSummary =
    params.toolsUsed.length > 0
      ? `Tool activity summary:\n- Iterations: ${params.iterations}\n- Tools used: ${[...new Set(params.toolsUsed)].join(', ')}`
      : undefined;

  return [
    'Finalize this worker run for the supervising agent.',
    `Original task:\n${truncateTranscriptText(params.originalPrompt, params.finalizationMessageCharLimit) || '[No task provided]'}`,
    transcript ? `Execution transcript:\n${transcript}` : undefined,
    toolSummary,
    [
      'Write the final worker report.',
      '- The structured completionState field is captured separately; do not include completion_state or other machine-readable fields in the visible report.',
      '- Use verified_success only when completed tool results directly verify the requested work.',
      '- Use blocked or incomplete when verification did not happen or a blocker remains.',
      '- Start with the concrete outcome.',
      '- Include the key verified findings.',
      '- Mention any remaining blocker or uncertainty only if it still matters.',
      '- Do not ask for more tool calls.',
      '- Do not narrate the transcript; synthesize it into a useful answer for the supervisor.',
    ].join('\n'),
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}
