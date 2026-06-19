import { AssistantCompletionMetadata, MessageProviderReplay } from '../../types/message';
import { LlmProviderConfig } from '../../types/provider';
import { LlmService } from '../llm/LlmService';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  FINALIZATION_RESULT_PREVIEW_CHARS,
  normalizeFinalizationOutputText,
  truncateFinalizationText,
} from './finalizationText';
import {
  getEscalatedFinalizationMaxTokens,
  resolveFinalizationMaxTokens,
} from '../context/tokenOptimization';
import {
  isResumableIncompleteTextCompletion,
  MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES,
} from '../llm/support/completionRecovery';
import type { AgentRunFinalizationEvidence } from './lifecycle/finalizePhaseTypes';
import { getAgentRunFinalizationToolNameForMessage } from './agentRunFinalizationMessages';

const MAX_TRANSCRIPT_MESSAGES = 18;
const MAX_MESSAGE_CHARS = 1_800;
const MAX_TOOL_CONTENT_CHARS = 2_600;
const MAX_TERMINAL_DELIVERABLE_LINES = 8;

export function buildAgentRunFinalizationPrompt(evidence: AgentRunFinalizationEvidence): string {
  const transcript = evidence.transcriptMessages
    .slice(-MAX_TRANSCRIPT_MESSAGES)
    .map((message) => {
      if (message.role === 'user') {
        return `User task:\n${truncateFinalizationText(message.content, MAX_MESSAGE_CHARS) || '[No task details]'}`;
      }

      if (message.role === 'assistant') {
        if (message.subAgentEvent) {
          const snapshot = message.subAgentEvent.snapshot;
          const workerName = snapshot.name?.trim() || snapshot.sessionId;
          const workerStatus = snapshot.status;
          const workerBody =
            truncateFinalizationText(
              snapshot.output ||
                snapshot.lastToolResultPreview ||
                snapshot.currentActivity ||
                message.content,
              MAX_TOOL_CONTENT_CHARS,
            ) || '[No worker details]';
          return `Worker update - ${workerName} (${workerStatus}):\n${workerBody}`;
        }

        const requestedTools = message.toolCalls?.length
          ? ` (requested tools: ${message.toolCalls.map((toolCall) => toolCall.name).join(', ')})`
          : '';
        const body =
          truncateFinalizationText(message.content, MAX_MESSAGE_CHARS) ||
          '[No visible assistant text]';
        return `Assistant${requestedTools}:\n${body}`;
      }

      const toolName = getAgentRunFinalizationToolNameForMessage(message);
      const toolBody =
        truncateFinalizationText(message.content, MAX_TOOL_CONTENT_CHARS) || '[No tool output]';
      return `Tool result - ${toolName}:\n${toolBody}`;
    })
    .join('\n\n');

  const terminalDeliverables = (evidence.terminalDeliverables ?? [])
    .slice(-MAX_TERMINAL_DELIVERABLE_LINES)
    .map((deliverable) => {
      const output = truncateFinalizationText(
        deliverable.output,
        FINALIZATION_RESULT_PREVIEW_CHARS,
      );
      return output ? `- ${deliverable.sourceName}: ${output}` : undefined;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');
  const toolSummary =
    evidence.toolsUsed.length > 0
      ? `Tool activity summary:\n- Iterations: ${evidence.iterations}\n- Tools used: ${[...new Set(evidence.toolsUsed)].join(', ')}`
      : undefined;
  return [
    'Finalize this completed agentic assistant run for the user.',
    `Original task:\n${truncateFinalizationText(evidence.originalPrompt, MAX_MESSAGE_CHARS) || '[No task provided]'}`,
    transcript ? `Execution transcript:\n${transcript}` : undefined,
    toolSummary,
    terminalDeliverables ? `Terminal deliverables:\n${terminalDeliverables}` : undefined,
    [
      'Write the final assistant answer.',
      '- Start with the concrete outcome.',
      '- Preserve exact or format-constrained final-output instructions from the original task.',
      '- Do not claim any exact literal, identifier, token, filename content, result value, or worker output unless it appears in verified tool or worker evidence above.',
      '- If a required exact value appears only in the user request or draft, report the missing evidence instead of fabricating completion.',
      '- If one terminal deliverable is itself the requested final answer, output that value without status narration.',
      '- Include the key verified findings.',
      '- Mention any remaining blocker or uncertainty only if it still matters.',
      '- Do not ask for more tool calls.',
      '- Do not narrate the transcript; synthesize it into a concise, useful answer for the user.',
    ].join('\n'),
  ]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
}

function findFinalizationContinuationOverlap(existingText: string, incomingText: string): number {
  const maxOverlap = Math.min(existingText.length, incomingText.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (existingText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}

function mergeFinalizationContinuationText(existingText: string, incomingText: string): string {
  if (!existingText) {
    return incomingText;
  }

  if (!incomingText) {
    return existingText;
  }

  if (incomingText.startsWith(existingText)) {
    return incomingText;
  }

  if (existingText.startsWith(incomingText)) {
    return existingText;
  }

  const overlapLength = findFinalizationContinuationOverlap(existingText, incomingText);
  if (overlapLength > 0) {
    return `${existingText}${incomingText.slice(overlapLength)}`;
  }

  return `${existingText}${incomingText}`;
}

function buildFinalizationSystemPrompt(systemPrompt: string, continuationMode: boolean): string {
  return continuationMode
    ? `${systemPrompt}\n\n## Finalization Continuation\nTools unavailable. Continue exactly where the prior final answer stopped; do not restart or repeat text.`
    : `${systemPrompt}\n\n## Finalization\nTools unavailable. Answer directly using only verified transcript/results.`;
}

// Interrupt/recovery synthesis only — completed graph-finalized runs use goal evidence directly.
export async function synthesizeAgentRunFinalAnswer(params: {
  provider: LlmProviderConfig;
  model: string;
  systemPrompt: string;
  evidence: AgentRunFinalizationEvidence;
  signal?: AbortSignal;
}): Promise<{ output?: string; providerReplay?: MessageProviderReplay }> {
  let continuationPrefix = '';
  let maxTokens = resolveFinalizationMaxTokens(params.model);

  try {
    for (
      let recoveryCount = 0;
      recoveryCount <= MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES;
      recoveryCount += 1
    ) {
      let attemptOutput = '';
      let attemptCompletion: AssistantCompletionMetadata | undefined;
      let attemptProviderReplay: MessageProviderReplay | undefined;
      const llm = new LlmService(params.provider);
      const stream = llm.streamMessage(
        [
          {
            role: 'system',
            content: buildFinalizationSystemPrompt(
              params.systemPrompt,
              continuationPrefix.length > 0,
            ),
          },
          {
            role: 'user',
            content: buildAgentRunFinalizationPrompt(params.evidence),
          },
          ...(continuationPrefix.length > 0
            ? [
                {
                  role: 'assistant' as const,
                  content: continuationPrefix,
                },
                {
                  role: 'user' as const,
                  content:
                    'Continue the same final answer from exactly where it stopped. Do not restart, do not repeat completed text, and do not call tools.',
                },
              ]
            : []),
        ],
        {
          model: params.model,
          maxTokens,
          signal: params.signal,
        },
      );

      for await (const event of stream) {
        if (event.type === 'token') {
          attemptOutput += event.content || '';
        } else if (event.type === 'done') {
          if (!attemptOutput && event.content) {
            attemptOutput = event.content;
          }
          attemptCompletion = event.completion;
          attemptProviderReplay = event.providerReplay;
        }
      }

      const mergedOutput =
        continuationPrefix.length > 0
          ? mergeFinalizationContinuationText(continuationPrefix, attemptOutput)
          : attemptOutput;
      const normalizedOutput = normalizeFinalizationOutputText(
        mergedOutput,
        FINALIZATION_OUTPUT_TRUNCATION,
      );
      if (!attemptCompletion || attemptCompletion.completionStatus !== 'incomplete') {
        return {
          output: normalizedOutput,
          providerReplay: attemptProviderReplay,
        };
      }

      if (
        !normalizedOutput ||
        !isResumableIncompleteTextCompletion(attemptCompletion) ||
        recoveryCount >= MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES
      ) {
        return {};
      }

      continuationPrefix = mergedOutput;
      maxTokens = getEscalatedFinalizationMaxTokens(maxTokens, params.model);
    }
  } catch {
    return {};
  }

  return {};
}
