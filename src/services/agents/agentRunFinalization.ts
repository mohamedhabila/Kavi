import {
  AgentRunStatus,
  AssistantCompletionMetadata,
  LlmProviderConfig,
  Message,
  MessageProviderReplay,
  SubAgentSnapshot,
} from '../../types';
import { LlmService } from '../llm/LlmService';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  FINALIZATION_RESULT_PREVIEW_CHARS,
  normalizeFinalizationOutputText,
  normalizeFinalizationPreviewText,
  summarizeFinalizationToolResultPreview,
  truncateFinalizationText,
} from './finalizationText';
import {
  getEscalatedFinalizationMaxTokens,
  resolveFinalizationMaxTokens,
} from '../context/tokenOptimization';
import { getAgentRunMessageSlice } from './workflowState';
import {
  isResumableIncompleteTextCompletion,
  MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES,
} from '../llm/completionRecovery';

const OUTPUT_TRUNCATION = FINALIZATION_OUTPUT_TRUNCATION;
const MAX_RESULT_PREVIEW_CHARS = FINALIZATION_RESULT_PREVIEW_CHARS;
const MAX_TRANSCRIPT_MESSAGES = 18;
const MAX_MESSAGE_CHARS = 1_800;
const MAX_TOOL_CONTENT_CHARS = 2_600;
const MAX_DETAILED_RESULT_CHARS = 4_000;
const MAX_FALLBACK_PREVIEW_LINES = 6;
const MAX_PROMPT_PREVIEW_LINES = 8;
const RESEARCH_SOURCE_TASK_PATTERN =
  /\b(official|docs?|documentation|cite|citation|source|sources|cross[- ]reference|research|compare|comparison|providers?)\b/i;

export interface AgentRunResultPreview {
  sourceName: string;
  preview: string;
}

export interface AgentRunFinalizationEvidence {
  originalPrompt: string;
  transcriptMessages: Message[];
  lastNonEmptyAssistantContent: string;
  lastSubstantiveResult: string;
  lastSubstantiveResultSourceName?: string;
  resultPreviews: AgentRunResultPreview[];
  toolsUsed: string[];
  iterations: number;
  hasIncompleteToolCalls: boolean;
}

function getToolNameForMessage(message: Message): string {
  const toolCallName = message.toolCalls?.[0]?.name;
  if (toolCallName?.trim()) {
    return toolCallName.trim();
  }

  const toolCallId = message.toolCallId?.trim();
  return toolCallId || 'tool';
}

function isSessionCoordinationSourceName(sourceName: string | undefined): boolean {
  return /^(sessions_(spawn|send|status|history|output|surface_output|list|wait|cancel|yield)|wait)$/i.test(
    sourceName?.trim() || '',
  );
}

function updateLastSubstantiveResult(
  state: { value: string; sourceName?: string },
  result: string | undefined,
  sourceName: string | undefined,
): void {
  const normalizedResult = normalizeFinalizationOutputText(result);
  const normalizedSourceName = sourceName?.trim() || undefined;
  if (!normalizedResult) {
    return;
  }

  const nextIsSessionCoordination = isSessionCoordinationSourceName(normalizedSourceName);
  const currentIsSessionCoordination = isSessionCoordinationSourceName(state.sourceName);
  if (state.value && !currentIsSessionCoordination && nextIsSessionCoordination) {
    return;
  }

  state.value = normalizedResult;
  state.sourceName = normalizedSourceName;
}

export function collectAgentRunFinalizationEvidence(
  messages: Message[],
  userMessageId: string,
  iterations: number,
  options?: {
    liveSubAgentSnapshots?: ReadonlyArray<SubAgentSnapshot>;
  },
): AgentRunFinalizationEvidence {
  const runMessages = getAgentRunMessageSlice(messages, userMessageId);
  const transcriptMessages = [...runMessages];
  const originalPrompt =
    normalizeFinalizationOutputText(
      runMessages.find((message) => message.id === userMessageId && message.role === 'user')
        ?.content,
    ) ||
    normalizeFinalizationOutputText(
      runMessages.find((message) => message.role === 'user')?.content,
    ) ||
    'Complete the current task.';

  let lastNonEmptyAssistantContent = '';
  const lastSubstantiveResultState: { value: string; sourceName?: string } = { value: '' };
  const resultPreviews: AgentRunResultPreview[] = [];
  const toolsUsed: string[] = [];
  const seenSubAgentSessionIds = new Set<string>();
  let hasIncompleteToolCalls = false;

  for (const message of runMessages) {
    if (message.role === 'assistant') {
      if (
        (message.toolCalls ?? []).some(
          (toolCall) =>
            toolCall.status === 'pending' ||
            toolCall.status === 'running' ||
            (toolCall.status === 'failed' &&
              !normalizeFinalizationOutputText(toolCall.error || toolCall.result)),
        )
      ) {
        hasIncompleteToolCalls = true;
      }

      const assistantContent = normalizeFinalizationOutputText(message.content);
      if (!message.subAgentEvent && assistantContent) {
        lastNonEmptyAssistantContent = assistantContent;
      }

      if (message.subAgentEvent) {
        const snapshot = message.subAgentEvent.snapshot;
        seenSubAgentSessionIds.add(snapshot.sessionId);
        const workerName = snapshot.name?.trim() || snapshot.sessionId;
        const preview = normalizeFinalizationPreviewText(
          snapshot.output ||
            snapshot.lastToolResultPreview ||
            snapshot.currentActivity ||
            message.content,
          MAX_RESULT_PREVIEW_CHARS,
        );
        if (preview) {
          resultPreviews.push({ sourceName: workerName, preview });
        }
        if (snapshot.output && snapshot.output.trim().length > 30) {
          updateLastSubstantiveResult(lastSubstantiveResultState, snapshot.output, workerName);
        }
      }

      for (const toolCall of message.toolCalls ?? []) {
        if (toolCall.name?.trim()) {
          toolsUsed.push(toolCall.name.trim());
        }

        const preview = summarizeFinalizationToolResultPreview(toolCall.result || toolCall.error);
        if (preview) {
          resultPreviews.push({
            sourceName: toolCall.name?.trim() || 'tool',
            preview,
          });
        }

        if (toolCall.result && toolCall.status !== 'failed' && toolCall.result.trim().length > 30) {
          updateLastSubstantiveResult(
            lastSubstantiveResultState,
            toolCall.result,
            toolCall.name?.trim() || 'tool',
          );
        }
      }
      continue;
    }

    if (message.role === 'tool') {
      const toolName = getToolNameForMessage(message);
      toolsUsed.push(toolName);
      const preview = summarizeFinalizationToolResultPreview(message.content);
      if (preview) {
        resultPreviews.push({ sourceName: toolName, preview });
      }
      if (!message.isError && message.content.trim().length > 30) {
        updateLastSubstantiveResult(lastSubstantiveResultState, message.content, toolName);
      }
    }
  }

  for (const snapshot of options?.liveSubAgentSnapshots ?? []) {
    if (seenSubAgentSessionIds.has(snapshot.sessionId)) {
      continue;
    }

    const workerName = snapshot.name?.trim() || snapshot.sessionId;
    const preview = normalizeFinalizationPreviewText(
      snapshot.output || snapshot.lastToolResultPreview || snapshot.currentActivity,
      MAX_RESULT_PREVIEW_CHARS,
    );
    if (preview) {
      resultPreviews.push({ sourceName: workerName, preview });
    }
    if (snapshot.output && snapshot.output.trim().length > 30) {
      updateLastSubstantiveResult(lastSubstantiveResultState, snapshot.output, workerName);
    }
    seenSubAgentSessionIds.add(snapshot.sessionId);
  }

  return {
    originalPrompt,
    transcriptMessages,
    lastNonEmptyAssistantContent,
    lastSubstantiveResult: lastSubstantiveResultState.value,
    lastSubstantiveResultSourceName: lastSubstantiveResultState.sourceName,
    resultPreviews,
    toolsUsed,
    iterations,
    hasIncompleteToolCalls,
  };
}

export function hasVerifiedFinalizationEvidence(evidence: AgentRunFinalizationEvidence): boolean {
  if (normalizeFinalizationOutputText(evidence.lastSubstantiveResult, OUTPUT_TRUNCATION)) {
    return true;
  }

  if (
    evidence.resultPreviews.some(
      (entry) => !!normalizeFinalizationPreviewText(entry.preview, MAX_RESULT_PREVIEW_CHARS),
    )
  ) {
    return true;
  }

  return false;
}

export function buildMissingFinalResponseFallback(
  status: Exclude<AgentRunStatus, 'running'>,
): string {
  switch (status) {
    case 'failed':
      return 'The run failed before it generated a final response.';
    case 'cancelled':
      return 'The run was cancelled before it generated a final response.';
    default:
      return 'The run completed, but no final response was generated.';
  }
}

function hasAssistantOnlyFinalizationEvidence(
  evidence: Pick<AgentRunFinalizationEvidence, 'lastNonEmptyAssistantContent'>,
): boolean {
  return evidence.lastNonEmptyAssistantContent.trim().length > 0;
}

export function canRecoverAgentRunFinalResponse(params: {
  evidence: AgentRunFinalizationEvidence;
  hasProviderContext: boolean;
  status: Exclude<AgentRunStatus, 'running'>;
}): boolean {
  if (hasVerifiedFinalizationEvidence(params.evidence)) {
    return true;
  }

  if (params.status !== 'completed') {
    return true;
  }

  return (
    params.hasProviderContext &&
    !params.evidence.hasIncompleteToolCalls &&
    hasAssistantOnlyFinalizationEvidence(params.evidence)
  );
}

export function hasCompletedExecutionRecoveryEvidence(params: {
  evidence: AgentRunFinalizationEvidence;
  liveSubAgentSnapshots?: ReadonlyArray<Pick<SubAgentSnapshot, 'status'>>;
  pendingAsyncOperationCount?: number;
}): boolean {
  if (!hasVerifiedFinalizationEvidence(params.evidence)) {
    return false;
  }

  if (params.evidence.hasIncompleteToolCalls) {
    return false;
  }

  if ((params.pendingAsyncOperationCount ?? 0) > 0) {
    return false;
  }

  if ((params.liveSubAgentSnapshots ?? []).some((snapshot) => snapshot.status === 'running')) {
    return false;
  }

  return true;
}

function getDedupedFinalizationPreviewLines(
  previews: ReadonlyArray<AgentRunResultPreview>,
  maxLines: number,
): string[] {
  const dedupedPreviewMap = new Map<string, string>();
  for (const entry of previews) {
    const preview = normalizeFinalizationPreviewText(entry.preview, MAX_RESULT_PREVIEW_CHARS);
    if (!preview) {
      continue;
    }
    dedupedPreviewMap.set(`${entry.sourceName}:${preview}`, `${entry.sourceName}: ${preview}`);
  }

  return Array.from(dedupedPreviewMap.values()).slice(-maxLines);
}

export function buildAgentRunToolResultFallback(params: {
  status: Exclude<AgentRunStatus, 'running'>;
  evidence: AgentRunFinalizationEvidence;
}): string | undefined {
  const sections: string[] = [];
  const baseText = normalizeFinalizationPreviewText(
    params.evidence.lastNonEmptyAssistantContent,
    OUTPUT_TRUNCATION,
  );
  if (baseText && params.status === 'completed') {
    sections.push(baseText);
  }

  const previewLines = getDedupedFinalizationPreviewLines(
    params.evidence.resultPreviews,
    MAX_FALLBACK_PREVIEW_LINES,
  );
  if (previewLines.length > 0) {
    const intro =
      params.status === 'cancelled'
        ? 'Latest verified findings before cancellation:'
        : params.status === 'failed'
          ? 'Latest verified findings before the failure:'
          : 'Latest verified findings:';
    sections.push([intro, ...previewLines.map((line) => `- ${line}`)].join('\n'));
  }

  if (
    sections.length === 0 &&
    params.status === 'completed' &&
    params.evidence.toolsUsed.length > 0
  ) {
    const uniqueTools = [...new Set(params.evidence.toolsUsed)];
    sections.push(
      params.status === 'completed'
        ? `[Agent run completed after ${params.evidence.iterations} tool iteration(s) using: ${uniqueTools.join(', ')}]`
        : `[Agent run ${params.status}: completed ${params.evidence.iterations} tool iteration(s) using: ${uniqueTools.join(', ')}]`,
    );
  }

  return sections.join('\n\n') || undefined;
}

export function buildAgentRunVisibleDraftRecoveryText(params: {
  status: Exclude<AgentRunStatus, 'running'>;
  visibleDraft: string;
  evidence: AgentRunFinalizationEvidence;
}): string {
  const normalizedVisibleDraft = normalizeFinalizationOutputText(
    params.visibleDraft,
    OUTPUT_TRUNCATION,
  );
  if (!normalizedVisibleDraft) {
    return (
      buildAgentRunToolResultFallback({
        status: params.status,
        evidence: params.evidence,
      }) || buildMissingFinalResponseFallback(params.status)
    );
  }

  const failureNoteIntro =
    params.status === 'cancelled'
      ? 'Note: the request was cancelled before the answer could finish.'
      : params.status === 'failed'
        ? 'Note: the response stream failed before the answer could finish.'
        : 'Note: the response stopped before the answer could finish.';
  const hasFailureNoteIntro = normalizedVisibleDraft.includes(failureNoteIntro);

  const fallbackText = buildAgentRunToolResultFallback({
    status: params.status,
    evidence: params.evidence,
  });
  if (!fallbackText) {
    return hasFailureNoteIntro
      ? normalizedVisibleDraft
      : [normalizedVisibleDraft, failureNoteIntro].join('\n\n');
  }

  if (
    fallbackText === normalizedVisibleDraft ||
    fallbackText.startsWith(normalizedVisibleDraft) ||
    normalizedVisibleDraft.startsWith(fallbackText)
  ) {
    const preferredText =
      normalizedVisibleDraft.length >= fallbackText.length ? normalizedVisibleDraft : fallbackText;
    return preferredText.includes(failureNoteIntro)
      ? preferredText
      : [preferredText, failureNoteIntro].join('\n\n');
  }

  const fallbackLines = fallbackText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const hasFallbackBodyBeyondIntro = fallbackLines.some(
    (line) => !/^latest verified findings/i.test(line),
  );
  if (!hasFallbackBodyBeyondIntro) {
    return hasFailureNoteIntro
      ? normalizedVisibleDraft
      : [normalizedVisibleDraft, failureNoteIntro].join('\n\n');
  }

  const getRecoveryComparisonVariants = (line: string): string[] => {
    const trimmedLine = line.trim().toLowerCase();
    if (!trimmedLine) {
      return [];
    }

    const variants = [trimmedLine];
    const headingNormalizedLine = trimmedLine
      .replace(/^here are\s+/, '')
      .replace(/^the\s+/, '')
      .trim();
    if (headingNormalizedLine && headingNormalizedLine !== trimmedLine) {
      variants.push(headingNormalizedLine);
    }
    const previewMatch = trimmedLine.match(/^-\s*[^:]+:\s*(.+)$/);
    if (previewMatch?.[1]) {
      variants.push(previewMatch[1].trim());
    }
    return variants;
  };

  const normalizedVisibleLines = new Set(
    normalizedVisibleDraft
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
      .flatMap((line) => getRecoveryComparisonVariants(line)),
  );

  const uniqueFallbackLines = fallbackLines.filter(
    (line) =>
      getRecoveryComparisonVariants(line).every((variant) => !normalizedVisibleLines.has(variant)),
  );
  if (uniqueFallbackLines.length === 0) {
    return hasFailureNoteIntro
      ? normalizedVisibleDraft
      : [normalizedVisibleDraft, failureNoteIntro].join('\n\n');
  }

  const failureNoteBody = uniqueFallbackLines.join('\n');
  const appendedNote = [failureNoteIntro, failureNoteBody].join('\n');
  return hasFailureNoteIntro
    ? [normalizedVisibleDraft, failureNoteBody].join('\n')
    : [normalizedVisibleDraft, appendedNote].join('\n\n');
}

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

      const toolName = getToolNameForMessage(message);
      const toolBody =
        truncateFinalizationText(message.content, MAX_TOOL_CONTENT_CHARS) || '[No tool output]';
      return `Tool result - ${toolName}:\n${toolBody}`;
    })
    .join('\n\n');

  const previewLines = getDedupedFinalizationPreviewLines(
    evidence.resultPreviews,
    MAX_PROMPT_PREVIEW_LINES,
  )
    .map((line) => `- ${truncateFinalizationText(line, MAX_RESULT_PREVIEW_CHARS) || line}`)
    .join('\n');

  const detailedResult = truncateFinalizationText(
    evidence.lastSubstantiveResult,
    MAX_DETAILED_RESULT_CHARS,
  );
  const toolSummary =
    evidence.toolsUsed.length > 0
      ? `Tool activity summary:\n- Iterations: ${evidence.iterations}\n- Tools used: ${[...new Set(evidence.toolsUsed)].join(', ')}`
      : undefined;
  const requiresSourceAttribution = RESEARCH_SOURCE_TASK_PATTERN.test(
    [
      evidence.originalPrompt,
      ...evidence.transcriptMessages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ].join('\n'),
  );

  return [
    'You are finalizing a completed agentic assistant run for the user.',
    `Original task:\n${truncateFinalizationText(evidence.originalPrompt, MAX_MESSAGE_CHARS) || '[No task provided]'}`,
    transcript ? `Execution transcript:\n${transcript}` : undefined,
    toolSummary,
    previewLines ? `Recent verified findings:\n${previewLines}` : undefined,
    detailedResult ? `Detailed result excerpt:\n${detailedResult}` : undefined,
    [
      'Write the final assistant answer now.',
      '- Start with the concrete outcome.',
      '- Include the key verified findings.',
      ...(requiresSourceAttribution
        ? [
            '- Attribute provider-specific research claims to named sources or URLs in the final answer.',
            '- Omit or clearly qualify any quantitative or superlative claim that is not directly supported by the verified evidence.',
          ]
        : []),
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
    ? `${systemPrompt}\n\n## Finalization Continuation Pass\nTools are unavailable for this pass. The previous final answer was cut off before completion. Continue the same answer from exactly where it stopped. Do not restart, do not repeat completed text, and finish the answer cleanly.`
    : `${systemPrompt}\n\n## Finalization Pass\nTools are unavailable for this pass. Produce the final assistant answer for the user using only the verified transcript and results provided. Return the final answer directly.`;
}

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
      const normalizedOutput = normalizeFinalizationOutputText(mergedOutput, OUTPUT_TRUNCATION);
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
