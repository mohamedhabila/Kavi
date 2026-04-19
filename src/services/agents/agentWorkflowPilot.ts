import type {
  AgentRun,
  AgentRunPilotControlAction,
  AgentRunPilotCriterionEvaluation,
  AgentRunPilotCriterionStatus,
  AgentRunPilotEvaluation,
  AgentRunPilotFallbackReason,
  AgentRunPilotRecommendedAction,
  AgentRunStatus,
  LlmProviderConfig,
  Message,
  SubAgentSnapshot,
  TokenUsage,
  ToolDefinition,
} from '../../types';
import { LlmService } from '../llm/LlmService';
import { CHARS_PER_TOKEN, SAFETY_MARGIN, estimateTokens, getWorkingContextWindow } from '../context/tokenCounter';
import { extractResponseTokenUsage } from '../usage/conversationUsage';
import { isAbortErrorLike, throwIfAbortSignalTriggered } from './agentRunCancellation';
import {
  hasVerifiedFinalizationEvidence,
  type AgentRunFinalizationEvidence,
} from './agentRunFinalization';
import {
  buildAgentRunEvidencePromptSection,
  normalizeAgentRunEvidenceEntries,
} from './evidence';
import { hasObservedDelegatedWork } from './delegationEvidence';
import { summarizeBackgroundWorkerRunOutcome } from './workflowState';
import {
  getConversationMemoryForSystemPrompt,
  getMemoryForSystemPrompt,
} from '../memory/store';
import {
  assessUserRequest,
  evaluateResponseAgainstRequestAssessment,
} from './requestAssessment';

export const PILOT_REVIEW_CHECKPOINT_TITLE = 'Pilot review queued';
export const PILOT_EVALUATOR_VERSION = 'pilot-v2';
export const PILOT_APPROVAL_SCORE_THRESHOLD = 16;
const PILOT_HEURISTIC_APPROVAL_SCORE_THRESHOLD = 18;

const PILOT_TOOL_NAME = 'pilot_report';
const PILOT_DIMENSION_MAX_SCORE = 5;
const PILOT_TOTAL_MAX_SCORE = 20;
const MAX_RESULT_PREVIEW_CHARS = 280;
const MAX_RESULT_PREVIEWS = 8;
const MAX_LIST_ITEMS = 6;
const MAX_SYSTEM_PROMPT_EXCERPT_CHARS = 1_600;
const MAX_REVIEW_HISTORY_ITEMS = 3;
const MAX_CHECKPOINT_DETAIL_CHARS = 360;
const MAX_PILOT_CONTINUE_CYCLES_WITHOUT_IMPROVEMENT = 3;
const MAX_PILOT_DRAFT_SIGNATURE_CHARS = 8_000;
const PILOT_PROMPT_CONTEXT_SHARE = 0.7;
const PILOT_PROMPT_RESERVED_TOKENS = 4_096;
const PILOT_PROMPT_DEFAULT_TOKENS = 12_000;
const PILOT_PROMPT_SECTION_MIN_TOKENS = 64;
const PILOT_DRAFT_SECTION_SHARE = 0.6;
const PILOT_RESULT_SECTION_SHARE = 0.45;
const PILOT_WORKER_SECTION_SHARE = 0.35;
const PILOT_FINDINGS_SECTION_SHARE = 0.2;
const PILOT_STRUCTURED_EVIDENCE_SECTION_SHARE = 0.25;
const PILOT_MEMORY_SECTION_SHARE = 0.12;
const PILOT_SUPERVISOR_SECTION_SHARE = 0.12;
const PILOT_RESPONSE_BASE_MAX_TOKENS = 1_200;
const PILOT_RESPONSE_PER_EXTRA_CRITERION_TOKENS = 160;
const PILOT_RESPONSE_RETRY_MIN_TOKENS = 1_000;
const PILOT_RESPONSE_RETRY_TOKEN_REDUCTION = 120;
const PILOT_RESPONSE_MAX_TOKENS_CAP = 3_000;
const MAX_STRUCTURED_EVIDENCE_SIGNATURE_ENTRIES = 16;
const PILOT_POLICY_SIGNATURE_VERSION = 'research-integrity-v1';
const PILOT_SESSION_ID_PATTERN = /\bsub-\d{4,}\b/gi;
const NON_SUBSTANTIVE_PILOT_PREVIEW_PATTERNS = [
  /^queued(?:\s+to\s+start)?\.?$/i,
  /^starting(?:\s+soon)?\.?$/i,
];
const RESEARCH_ATTRIBUTION_TASK_PATTERN = /\b(official|docs?|documentation|cite|citation|source|sources|cross[- ]reference|research|compare|comparison|providers?|benchmark|evaluate|latency|pricing)\b/i;
const PROVIDER_REFERENCE_PATTERN = /\b(openai|anthropic|claude|google|gemini)\b/i;
const SOURCE_ATTRIBUTION_PATTERN = /https?:\/\/\S+|\b(?:official\s+)?(?:source|sources|citation|citations)\s*:|\b(?:openai|anthropic|claude|google|gemini)\b[\s\S]{0,48}\b(?:docs?|documentation|guide|api|pricing|overview|reference|realtime|structured outputs|tool use|function calling|context caching)\b/i;
const PROVIDER_QUANTITATIVE_CLAIM_PATTERN = /(?:\b(?:openai|anthropic|claude|google|gemini)\b[\s\S]{0,120}\b\d+(?:\.\d+)?\s?(?:%|percent|x|ms|milliseconds?|seconds?|minutes?|hours?|days?|tokens?)(?!\w))|(?:\b\d+(?:\.\d+)?\s?(?:%|percent|x|ms|milliseconds?|seconds?|minutes?|hours?|days?|tokens?)(?!\w)[\s\S]{0,120}\b(?:openai|anthropic|claude|google|gemini)\b)/i;
const PROVIDER_SUPERLATIVE_CLAIM_PATTERN = /(?:\b(?:openai|anthropic|claude|google|gemini)\b[\s\S]{0,120}\b(?:undisputed|perfectly|ideal(?:ly)?|best|leader|dominates|superior|unmatched|clear winner|wins|best choice|clearly the best|aligns perfectly)\b)|(?:\b(?:undisputed|perfectly|ideal(?:ly)?|best|leader|dominates|superior|unmatched|clear winner|wins|best choice|clearly the best|aligns perfectly)\b[\s\S]{0,120}\b(?:openai|anthropic|claude|google|gemini)\b)/i;

type ResearchIntegrityAssessment = {
  requiresSourceAttribution: boolean;
  candidateMentionsProviders: boolean;
  hasExplicitAttribution: boolean;
  gaps: string[];
};

function getPilotRequestAssessment(params: Pick<PilotDecisionParams, 'run' | 'evidence'>) {
  const originalUserMessage = params.evidence.transcriptMessages.find((message) => message.role === 'user');
  return assessUserRequest(params.evidence.originalPrompt || params.run.goal, {
    hasAttachments: Boolean(originalUserMessage?.attachments?.length),
  });
}

function buildRequestGovernancePromptSection(params: Pick<PilotDecisionParams, 'run' | 'evidence'>): string | undefined {
  const assessment = getPilotRequestAssessment(params);
  if (assessment.action === 'proceed') {
    return undefined;
  }

  if (assessment.action === 'direct') {
    return [
      'Request governance assessment:',
      `- ${assessment.summary}`,
      ...assessment.reasons.map((reason) => `- ${reason}`),
      '- Approve only if the response answered the direct question succinctly, or asked only for the minimal missing context needed to complete it.',
      '- Do not require a multi-agent workflow, delegation, or ceremony for this request once the answer is available.',
    ].join('\n');
  }

  return [
    'Request governance assessment:',
    `- ${assessment.summary}`,
    ...assessment.reasons.map((reason) => `- ${reason}`),
    assessment.action === 'clarify'
      ? '- Approve only if the workflow stopped early and asked the user for the missing details without launching unnecessary work.'
      : '- Approve only if the response explicitly criticized the unreasonable ask and stated the smaller reasonable scope it chose instead.',
    assessment.narrowedScope ? `- Reasonable scope: ${assessment.narrowedScope}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

const PILOT_COMMON_SYSTEM_PROMPT_LINES = [
  'You are Pilot, the governance layer for a production multi-agent workflow.',
  'This agentic workflow is expected to run autonomously for long periods without user intervention.',
  'You have operator-level authority to issue user-equivalent control intents for the workflow.',
  'Your job is to evaluate whether the run has actually satisfied the user objective and explicit success criteria.',
  'If the user request is low-signal or underspecified, approve only when the workflow stopped early and asked for clarification instead of inventing work.',
  'If the user requested unreasonable effort or process for a simple task, approve only when the response explicitly criticized that mismatch and narrowed or rejected the unreasonable part.',
  'Do not reward blind compliance with unreasonable scope, impossible guarantees, or overkill workflow instructions.',
  'You score the run across four dimensions: task completion, task adherence, evidence quality, and process quality.',
  'You also score each success criterion individually.',
  'Use controlAction accept when you would accept the current result for delivery now.',
  'Use controlAction continue when the workflow should keep running autonomously without waiting for the user.',
  'Use controlAction block when autonomous progress should stop because the run is blocked or the approach is exhausted.',
  'Use controlAction cancel only when the workflow itself should be intentionally stopped.',
  'When you choose continue, preserve the current workflow run as the baseline: keep verified work, plan state, worker findings, and usable draft output.',
  'For non-trivial Agent mode runs, missing delegation is a process-quality gap. Penalize solo tool work when a focused worker should have been spawned.',
  'When you choose continue, nextActions must be delta-only correction instructions that extend, improve, or verify the existing run rather than restart it.',
  'When you choose continue, preserve transcript continuity by extending the existing answer instead of instructing the executor to replace it with a fresh standalone response.',
  'Do not recommend a replacement run, a full rewrite, or redoing unchanged work just to recreate already verified context.',
  'For research, comparison, or official-documentation tasks, treat provider-specific claims in the user-visible answer as incomplete unless they cite named sources or URLs.',
  'Uncited quantitative, pricing, latency, or superlative provider claims are evidence and adherence gaps that must block finalization until corrected.',
  'Recommend finalize only when every success criterion is materially satisfied, the evidence is verified, and the workflow is production-ready.',
  'Recommend continue when further autonomous work can close the remaining gaps.',
  'Recommend blocked only when a real blocker or repeated exhausted approach means more autonomous work is not justified.',
];

const PILOT_SYSTEM_PROMPT = [
  ...PILOT_COMMON_SYSTEM_PROMPT_LINES,
  'Do not use tools, do not write the user-facing final answer, and do not invent missing evidence.',
  'Return exactly one JSON object that matches the pilot_report schema and no free-form prose.',
  'Do not wrap the JSON in markdown fences or add explanatory text.',
].join('\n');

const PILOT_TOOL_CALL_SYSTEM_PROMPT = [
  ...PILOT_COMMON_SYSTEM_PROMPT_LINES,
  'Do not write the user-facing final answer and do not invent missing evidence.',
  'Call the pilot_report tool exactly once with the completed evaluation.',
  'Do not emit prose, markdown, or any text outside the tool call.',
].join('\n');

const PILOT_EVALUATION_SCHEMA: ToolDefinition['input_schema'] = {
  type: 'object',
  additionalProperties: false,
  properties: {
    controlAction: {
      type: 'string',
      enum: ['accept', 'continue', 'block', 'cancel'],
      description: 'Operator-level workflow command. accept means ship now, continue means keep working autonomously, block means stop because the workflow is blocked, cancel means intentionally stop the workflow.',
    },
    recommendedAction: {
      type: 'string',
      enum: ['finalize', 'continue', 'blocked'],
      description: 'Pilot decision: finalize only when the run is ready, continue when more work should be attempted, blocked when autonomous progress should stop.',
    },
    completionScore: {
      type: 'integer',
      enum: [0, 1, 2, 3, 4, 5],
      description: 'How well the run completed the requested task end-to-end.',
    },
    adherenceScore: {
      type: 'integer',
      enum: [0, 1, 2, 3, 4, 5],
      description: 'How well the run adhered to the user objective, explicit plan, and stop conditions.',
    },
    evidenceScore: {
      type: 'integer',
      enum: [0, 1, 2, 3, 4, 5],
      description: 'How strong and verified the evidence is for the claimed result.',
    },
    processScore: {
      type: 'integer',
      enum: [0, 1, 2, 3, 4, 5],
      description: 'How effective the workflow process was, including use of workers, retries, and validation.',
    },
    approved: {
      type: 'boolean',
      description: 'True only when finalization is approved for delivery now.',
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Confidence in the evaluation based on the available evidence.',
    },
    summary: {
      type: 'string',
      description: 'One concise sentence describing the pilot conclusion.',
    },
    rationale: {
      type: 'string',
      description: 'Short explanation of why the decision was reached.',
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key strengths or completed areas.',
    },
    gaps: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key gaps that still matter for completion approval.',
    },
    nextActions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Concrete next actions for the SuperAgent executor when more work is needed.',
    },
    criterionEvaluations: {
      type: 'array',
      description: 'One entry per success criterion.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          criterion: { type: 'string' },
          score: { type: 'integer', enum: [0, 1, 2, 3, 4, 5] },
          status: { type: 'string', enum: ['met', 'partial', 'unmet', 'blocked'] },
          rationale: { type: 'string' },
        },
        required: ['criterion', 'score', 'status', 'rationale'],
      },
    },
  },
  required: [
    'controlAction',
    'recommendedAction',
    'completionScore',
    'adherenceScore',
    'evidenceScore',
    'processScore',
    'approved',
    'confidence',
    'summary',
    'rationale',
    'strengths',
    'gaps',
    'nextActions',
    'criterionEvaluations',
  ],
};

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch?.[1]?.trim() || trimmed;
}

function extractPilotNestedTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!record) {
    return '';
  }

  if (typeof record.value === 'string') {
    return record.value;
  }

  if (typeof record.text === 'string') {
    return record.text;
  }

  return '';
}

function extractPilotTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => extractPilotTextValue(entry)).join('');
  }

  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  if (!record) {
    return '';
  }

  const textValue = extractPilotNestedTextValue(record.text);
  if (textValue) {
    return textValue;
  }
  const outputTextValue = extractPilotNestedTextValue(record.output_text);
  if (outputTextValue) {
    return outputTextValue;
  }
  const refusalValue = extractPilotNestedTextValue(record.refusal);
  if (refusalValue) {
    return refusalValue;
  }
  const reasoningValue = extractPilotNestedTextValue(record.reasoning_content);
  if (reasoningValue) {
    return reasoningValue;
  }
  if (typeof record.content === 'string') {
    return record.content;
  }
  if (record.content !== undefined) {
    const nestedContent = extractPilotTextValue(record.content);
    if (nestedContent) {
      return nestedContent;
    }
  }
  if (record.parts !== undefined) {
    const nestedParts = extractPilotTextValue(record.parts);
    if (nestedParts) {
      return nestedParts;
    }
  }
  if (
    typeof record.value === 'string'
    && (
      record.type === 'text'
      || record.type === 'output_text'
      || record.type === 'input_text'
      || Array.isArray(record.annotations)
    )
  ) {
    return record.value;
  }

  return '';
}

function hasPilotEvaluationShape(record: Record<string, unknown>): boolean {
  return 'recommendedAction' in record
    || 'controlAction' in record
    || 'completionScore' in record
    || 'criterionEvaluations' in record
    || 'approved' in record
    || 'summary' in record;
}

function tryParsePilotEvaluationPayload(value: unknown): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const extractedText = extractPilotTextValue(value);
    return extractedText ? tryParsePilotEvaluationPayload(extractedText) : undefined;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (record.name === PILOT_TOOL_NAME && record.arguments) {
      const nested = tryParsePilotEvaluationPayload(record.arguments);
      if (nested) {
        return nested;
      }
    }

    if (record.tool === PILOT_TOOL_NAME && record.input) {
      const nested = tryParsePilotEvaluationPayload(record.input);
      if (nested) {
        return nested;
      }
    }

    if (hasPilotEvaluationShape(record)) {
      return record;
    }

    const extractedText = extractPilotTextValue(record);
    return extractedText ? tryParsePilotEvaluationPayload(extractedText) : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = stripCodeFence(value);
  if (!normalized) {
    return undefined;
  }

  const candidates = [normalized];
  const firstBrace = normalized.indexOf('{');
  const lastBrace = normalized.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(normalized.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (record.name === PILOT_TOOL_NAME && record.arguments) {
          const nested = tryParsePilotEvaluationPayload(record.arguments);
          if (nested) {
            return nested;
          }
        }

        if (record.tool === PILOT_TOOL_NAME && record.input) {
          const nested = tryParsePilotEvaluationPayload(record.input);
          if (nested) {
            return nested;
          }
        }

        return record;
      }
    } catch {
      // Ignore malformed candidates and continue.
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function extractPilotEvaluationPayloadFromToolLike(value: unknown): Record<string, unknown> | undefined {
  const toolLike = asRecord(value);
  if (!toolLike) {
    return undefined;
  }

  const functionLike = asRecord(toolLike.function);
  const name = typeof functionLike?.name === 'string'
    ? functionLike.name
    : typeof toolLike.name === 'string'
      ? toolLike.name
      : '';

  if (name !== PILOT_TOOL_NAME) {
    return undefined;
  }

  return tryParsePilotEvaluationPayload(
    functionLike?.arguments
      ?? toolLike.arguments
      ?? toolLike.args
      ?? toolLike.input,
  );
}

function extractPilotEvaluationPayloadFromGeminiReplay(parts: unknown): Record<string, unknown> | undefined {
  const replayParts = Array.isArray(parts) ? parts : [];

  for (const part of replayParts) {
    const record = asRecord(part);
    if (!record) {
      continue;
    }

    const parsedFromFunction = extractPilotEvaluationPayloadFromToolLike(
      asRecord(record.functionCall) ?? asRecord(record.function_call),
    );
    if (parsedFromFunction) {
      return parsedFromFunction;
    }
  }

  for (const part of replayParts) {
    const record = asRecord(part);
    if (!record) {
      continue;
    }

    const parsedFromText = tryParsePilotEvaluationPayload(record.text);
    if (parsedFromText) {
      return parsedFromText;
    }
  }

  return undefined;
}

function extractPilotEvaluationPayloadFromOpenAIReplay(output: unknown): Record<string, unknown> | undefined {
  const replayOutput = Array.isArray(output) ? output : [];

  for (const item of replayOutput) {
    const parsedFromTool = extractPilotEvaluationPayloadFromToolLike(item);
    if (parsedFromTool) {
      return parsedFromTool;
    }
  }

  for (const item of replayOutput) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    const parsedFromText = tryParsePilotEvaluationPayload(
      record.text
        ?? record.output_text
        ?? record.content,
    );
    if (parsedFromText) {
      return parsedFromText;
    }
  }

  return undefined;
}

function extractPilotEvaluationPayloadFromOpenAIResponsesNative(response: unknown): Record<string, unknown> | undefined {
  const record = asRecord(response);
  if (!record) {
    return undefined;
  }

  const parsedFromOutputObject = tryParsePilotEvaluationPayload(record.output_parsed ?? record.output);
  if (parsedFromOutputObject) {
    return parsedFromOutputObject;
  }

  const parsedFromOutputArray = extractPilotEvaluationPayloadFromOpenAIReplay(record.output);
  if (parsedFromOutputArray) {
    return parsedFromOutputArray;
  }

  return tryParsePilotEvaluationPayload(record.output_text);
}

function extractPilotEvaluationPayloadFromGeminiNative(response: unknown): Record<string, unknown> | undefined {
  const record = asRecord(response);
  if (!record) {
    return undefined;
  }

  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    const candidateRecord = asRecord(candidate);
    const contentRecord = asRecord(candidateRecord?.content);
    const parsed = extractPilotEvaluationPayloadFromGeminiReplay(contentRecord?.parts);
    if (parsed) {
      return parsed;
    }
  }

  return undefined;
}

function extractPilotEvaluationPayloadFromAnthropicNative(response: unknown): Record<string, unknown> | undefined {
  const record = asRecord(response);
  if (!record) {
    return undefined;
  }

  return extractPilotEvaluationPayloadFromContentParts(record.content);
}

function extractPilotEvaluationPayloadFromNativeProviderResponse(response: any): Record<string, unknown> | undefined {
  const providerResponse = asRecord(response?.providerResponse);
  if (!providerResponse) {
    return undefined;
  }

  const provider = typeof providerResponse.provider === 'string' ? providerResponse.provider : '';
  const nativeResponse = providerResponse.response;

  switch (provider) {
    case 'openai-responses':
      return extractPilotEvaluationPayloadFromOpenAIResponsesNative(nativeResponse);
    case 'gemini':
      return extractPilotEvaluationPayloadFromGeminiNative(nativeResponse);
    case 'anthropic':
      return extractPilotEvaluationPayloadFromAnthropicNative(nativeResponse);
    default:
      return extractPilotEvaluationPayloadFromOpenAIResponsesNative(nativeResponse)
        ?? extractPilotEvaluationPayloadFromGeminiNative(nativeResponse)
        ?? extractPilotEvaluationPayloadFromAnthropicNative(nativeResponse);
  }
}

function extractPilotEvaluationPayloadFromContentParts(value: unknown): Record<string, unknown> | undefined {
  const pending: unknown[] = [value];
  const visited = new Set<unknown>();

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) {
      continue;
    }

    if (typeof current === 'object') {
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);
    }

    const parsedFromTool = extractPilotEvaluationPayloadFromToolLike(current);
    if (parsedFromTool) {
      return parsedFromTool;
    }

    const parsedPayload = tryParsePilotEvaluationPayload(current);
    if (parsedPayload) {
      return parsedPayload;
    }

    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }

    const record = asRecord(current);
    if (record) {
      pending.push(...Object.values(record));
    }
  }

  return undefined;
}

function buildPilotRetryAssistantMessage(response: any): Record<string, unknown> | undefined {
  const message = asRecord(response?.choices?.[0]?.message);
  if (!message) {
    return undefined;
  }

  const content = extractPilotTextValue(message.content);
  const reasoning = extractPilotTextValue(message.reasoning);
  const retryMessage: Record<string, unknown> = {
    role: 'assistant',
    content,
  };
  const providerReplay = asRecord(message.providerReplay);
  const openaiResponseId = typeof providerReplay?.openaiResponseId === 'string' && providerReplay.openaiResponseId.trim().length > 0
    ? providerReplay.openaiResponseId.trim()
    : typeof response?.id === 'string' && response.id.trim().length > 0
      ? response.id.trim()
      : '';

  if (reasoning.trim().length > 0) {
    retryMessage.reasoning = reasoning;
  }

  if (!openaiResponseId && Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    retryMessage.tool_calls = message.tool_calls;
  }

  if (openaiResponseId) {
    retryMessage.providerReplay = { openaiResponseId };
  } else if (providerReplay) {
    retryMessage.providerReplay = message.providerReplay;
  }

  return retryMessage;
}

function extractPilotEvaluationPayload(response: any): Record<string, unknown> | undefined {
  const parsedFromNativeProviderResponse = extractPilotEvaluationPayloadFromNativeProviderResponse(response);
  if (parsedFromNativeProviderResponse) {
    return parsedFromNativeProviderResponse;
  }

  const message = response?.choices?.[0]?.message;
  const toolCalls = Array.isArray(message?.tool_calls)
    ? message.tool_calls
    : [];

  for (const toolCall of toolCalls) {
    const parsed = extractPilotEvaluationPayloadFromToolLike(toolCall);
    if (parsed) {
      return parsed;
    }
  }

  const parsedFromLegacyFunctionCall = extractPilotEvaluationPayloadFromToolLike(
    asRecord(message?.function_call) ?? asRecord(message?.functionCall),
  );
  if (parsedFromLegacyFunctionCall) {
    return parsedFromLegacyFunctionCall;
  }

  const parsedFromGeminiReplay = extractPilotEvaluationPayloadFromGeminiReplay(
    message?.providerReplay?.geminiParts,
  );
  if (parsedFromGeminiReplay) {
    return parsedFromGeminiReplay;
  }

  const parsedFromOpenAIReplay = extractPilotEvaluationPayloadFromOpenAIReplay(
    message?.providerReplay?.openaiResponseOutput,
  );
  if (parsedFromOpenAIReplay) {
    return parsedFromOpenAIReplay;
  }

  const parsedFromAnthropicReplay = extractPilotEvaluationPayloadFromContentParts(
    message?.providerReplay?.anthropicBlocks,
  );
  if (parsedFromAnthropicReplay) {
    return parsedFromAnthropicReplay;
  }

  return extractPilotEvaluationPayloadFromContentParts(message?.parsed)
    ?? extractPilotEvaluationPayloadFromContentParts(message?.content)
    ?? extractPilotEvaluationPayloadFromContentParts(message?.reasoning);
}

function hasNonEmptyPilotString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPilotStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPilotScoreValue(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= 0
    && (value as number) <= PILOT_DIMENSION_MAX_SCORE;
}

function isPilotConfidenceValue(value: unknown): value is 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high';
}

function isPilotControlActionValue(value: unknown): value is AgentRunPilotControlAction {
  return value === 'accept'
    || value === 'continue'
    || value === 'block'
    || value === 'cancel';
}

function isPilotCriterionStatusValue(value: unknown): value is AgentRunPilotCriterionStatus {
  return value === 'met'
    || value === 'partial'
    || value === 'unmet'
    || value === 'blocked';
}

function isPilotCriterionEvaluationPayload(value: unknown): boolean {
  const record = asRecord(value);
  if (!record) {
    return false;
  }

  return hasNonEmptyPilotString(record.criterion)
    && isPilotScoreValue(record.score)
    && isPilotCriterionStatusValue(record.status)
    && hasNonEmptyPilotString(record.rationale);
}

function isCompletePilotEvaluationPayload(
  raw: Record<string, unknown> | undefined,
  successCriteria: string[],
): raw is Record<string, unknown> {
  const criterionEvaluations = Array.isArray(raw?.criterionEvaluations)
    ? raw.criterionEvaluations
    : undefined;

  if (!raw || !criterionEvaluations || criterionEvaluations.length < successCriteria.length) {
    return false;
  }

  return parseRecommendedAction(raw.recommendedAction) !== undefined
    && isPilotControlActionValue(raw.controlAction)
    && isPilotScoreValue(raw.completionScore)
    && isPilotScoreValue(raw.adherenceScore)
    && isPilotScoreValue(raw.evidenceScore)
    && isPilotScoreValue(raw.processScore)
    && typeof raw.approved === 'boolean'
    && isPilotConfidenceValue(raw.confidence)
    && hasNonEmptyPilotString(raw.summary)
    && hasNonEmptyPilotString(raw.rationale)
    && isPilotStringArray(raw.strengths)
    && isPilotStringArray(raw.gaps)
    && isPilotStringArray(raw.nextActions)
    && criterionEvaluations.slice(0, successCriteria.length).every((entry) => isPilotCriterionEvaluationPayload(entry));
}

function isRecoverablePilotEvaluationPayload(
  raw: Record<string, unknown> | undefined,
): raw is Record<string, unknown> {
  if (!raw) {
    return false;
  }

  const hasDecisionSignal = parseRecommendedAction(raw.recommendedAction) !== undefined
    || isPilotControlActionValue(raw.controlAction)
    || typeof raw.approved === 'boolean';
  const hasCoreScores = isPilotScoreValue(raw.completionScore)
    && isPilotScoreValue(raw.adherenceScore)
    && isPilotScoreValue(raw.evidenceScore)
    && isPilotScoreValue(raw.processScore);
  const hasSummaryText = hasNonEmptyPilotString(raw.summary) || hasNonEmptyPilotString(raw.rationale);

  return hasDecisionSignal && hasCoreScores && hasSummaryText;
}

function extractValidatedPilotEvaluationPayload(
  response: any,
  successCriteria: string[],
): Record<string, unknown> | undefined {
  const parsedPayload = extractPilotEvaluationPayload(response);
  return isCompletePilotEvaluationPayload(parsedPayload, successCriteria)
    ? parsedPayload
    : undefined;
}

const PILOT_STRUCTURED_OUTPUT = {
  name: PILOT_TOOL_NAME,
  mimeType: 'application/json',
  schema: PILOT_EVALUATION_SCHEMA,
  strict: true,
} as const;

const PILOT_EVALUATION_TOOL: ToolDefinition = {
  name: PILOT_TOOL_NAME,
  description: 'Return the Pilot evaluation as a structured tool call.',
  input_schema: PILOT_EVALUATION_SCHEMA,
  strict: true,
};

export interface AgentRunPilotProviderContext {
  provider: LlmProviderConfig;
  model: string;
  systemPromptText: string;
  conversationId?: string;
}

export interface AgentRunPilotDecision {
  action: 'resume' | 'finalize';
  outcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string };
  checkpointTitle: string;
  checkpointDetail: string;
  reviewPrompt?: string;
  reviewUserPrompt?: string;
  disableToolsOnResume?: boolean;
  evaluation: AgentRunPilotEvaluation;
}

interface PilotDecisionParams {
  run: Pick<AgentRun, 'goal' | 'plan' | 'checkpoints' | 'updatedAt' | 'summary' | 'latestPilotEvaluation' | 'evidence'>;
  evidence: AgentRunFinalizationEvidence;
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string };
  workers?: ReadonlyArray<SubAgentSnapshot>;
  providerContext?: AgentRunPilotProviderContext;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}

function truncateText(value: string | undefined, maxChars: number): string {
  const normalized = value?.trim() || '';
  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}...`;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function clampScore(value: unknown, maxScore = PILOT_DIMENSION_MAX_SCORE): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(maxScore, Math.max(0, Math.round(value as number)));
}

function normalizeCriterionStatus(value: unknown): AgentRunPilotCriterionStatus {
  switch (value) {
    case 'met':
    case 'partial':
    case 'blocked':
      return value;
    default:
      return 'unmet';
  }
}

function parseRecommendedAction(value: unknown): AgentRunPilotRecommendedAction | undefined {
  switch (value) {
    case 'finalize':
    case 'continue':
    case 'blocked':
      return value;
    default:
      return undefined;
  }
}

function derivePilotControlAction(params: {
  recommendedAction: AgentRunPilotRecommendedAction;
  approved: boolean;
  candidateStatus: Exclude<AgentRunStatus, 'running'>;
}): AgentRunPilotControlAction {
  if (params.candidateStatus === 'cancelled') {
    return 'cancel';
  }

  if (params.approved && params.recommendedAction === 'finalize') {
    return 'accept';
  }

  if (params.recommendedAction === 'continue') {
    return 'continue';
  }

  return 'block';
}

function normalizeControlAction(
  value: unknown,
  params: {
    recommendedAction: AgentRunPilotRecommendedAction;
    approved: boolean;
    candidateStatus: Exclude<AgentRunStatus, 'running'>;
  },
): AgentRunPilotControlAction {
  switch (value) {
    case 'accept':
    case 'continue':
    case 'block':
    case 'cancel':
      return value;
    default:
      return derivePilotControlAction(params);
  }
}

function normalizePilotDecisionSignals(params: {
  rawRecommendedAction: unknown;
  rawControlAction: unknown;
  rawApproved: unknown;
  overallScore: number;
  criterionEvaluations: AgentRunPilotCriterionEvaluation[];
  candidateStatus: Exclude<AgentRunStatus, 'running'>;
}): {
  approved: boolean;
  recommendedAction: AgentRunPilotRecommendedAction;
  controlAction: AgentRunPilotControlAction;
} {
  const parsedRecommendedAction = parseRecommendedAction(params.rawRecommendedAction);
  const parsedControlAction = normalizeControlAction(params.rawControlAction, {
    recommendedAction: parsedRecommendedAction ?? 'finalize',
    approved: Boolean(params.rawApproved),
    candidateStatus: params.candidateStatus,
  });
  const approved = Boolean(params.rawApproved)
    && (parsedRecommendedAction ?? 'finalize') === 'finalize'
    && parsedControlAction === 'accept'
    && params.overallScore >= PILOT_APPROVAL_SCORE_THRESHOLD
    && params.criterionEvaluations.every((criterion) => criterion.score >= 4);
  const requestedBlock = parsedRecommendedAction === 'blocked' || parsedControlAction === 'block';
  const requestedContinue = parsedRecommendedAction === 'continue' || parsedControlAction === 'continue';
  const requestedFinalize = parsedRecommendedAction === 'finalize'
    || parsedControlAction === 'accept'
    || Boolean(params.rawApproved);
  const recommendedAction: AgentRunPilotRecommendedAction = approved
    ? 'finalize'
    : params.candidateStatus === 'cancelled'
      ? 'blocked'
      : requestedBlock && !requestedContinue && !requestedFinalize
        ? 'blocked'
        : 'continue';

  return {
    approved,
    recommendedAction,
    controlAction: derivePilotControlAction({
      recommendedAction,
      approved,
      candidateStatus: params.candidateStatus,
    }),
  };
}

function getSuccessCriteria(
  run: Pick<AgentRun, 'goal' | 'plan'>,
): string[] {
  const criteria = run.plan?.successCriteria?.map((criterion) => criterion.trim()).filter(Boolean) || [];
  return criteria.length > 0 ? criteria : ['Produce the requested deliverable.', 'Verify the result before finalizing.'];
}

function mergeUniqueStringLists(...lists: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const merged: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const normalized = item.trim();
      if (normalized && !merged.includes(normalized)) {
        merged.push(normalized);
      }
    }
  }

  return merged;
}

function buildResearchIntegrityAssessment(params: {
  run: Pick<AgentRun, 'goal' | 'plan'>;
  evidence: AgentRunFinalizationEvidence;
}): ResearchIntegrityAssessment {
  const taskText = [
    params.run.goal,
    params.run.plan?.objective || '',
    ...params.evidence.transcriptMessages
      .filter((message) => message.role === 'user')
      .map((message) => message.content),
  ].join('\n');
  const candidateText = params.evidence.lastNonEmptyAssistantContent.trim()
    || params.evidence.lastSubstantiveResult.trim();
  const requiresSourceAttribution = RESEARCH_ATTRIBUTION_TASK_PATTERN.test(taskText);
  const candidateMentionsProviders = PROVIDER_REFERENCE_PATTERN.test(candidateText);
  const hasExplicitAttribution = SOURCE_ATTRIBUTION_PATTERN.test(candidateText);
  const gaps: string[] = [];

  if (!requiresSourceAttribution || !candidateText) {
    return {
      requiresSourceAttribution,
      candidateMentionsProviders,
      hasExplicitAttribution,
      gaps,
    };
  }

  if (candidateMentionsProviders && !hasExplicitAttribution) {
    gaps.push('The user-visible answer makes provider-specific research claims without citing named sources or URLs.');
  }

  if (PROVIDER_QUANTITATIVE_CLAIM_PATTERN.test(candidateText) && !hasExplicitAttribution) {
    gaps.push('The user-visible answer includes quantitative provider claims without direct source attribution.');
  }

  if (PROVIDER_SUPERLATIVE_CLAIM_PATTERN.test(candidateText) && !hasExplicitAttribution) {
    gaps.push('The user-visible answer includes absolute comparative language that is not grounded in cited evidence.');
  }

  return {
    requiresSourceAttribution,
    candidateMentionsProviders,
    hasExplicitAttribution,
    gaps: mergeUniqueStringLists(gaps),
  };
}

function normalizePilotToolName(toolName: string | undefined): string {
  return toolName?.trim().toLowerCase() || '';
}

function isSessionCoordinationToolName(toolName: string | undefined): boolean {
  return /^(sessions_(spawn|send|status|history|output|list|wait|cancel|yield)|wait)$/.test(normalizePilotToolName(toolName));
}

function hasDelegatedWorkEvidence(params: Pick<PilotDecisionParams, 'evidence' | 'workers'>): boolean {
  return hasObservedDelegatedWork({
    messages: params.evidence.transcriptMessages,
    workers: params.workers,
  });
}

function requiresDelegationForPilotReview(
  params: Pick<PilotDecisionParams, 'run' | 'evidence'>,
): boolean {
  const workstreamCount = params.run.plan?.workstreams?.length ?? 0;
  const successCriteriaCount = getSuccessCriteria(params.run).length;
  const nonSessionToolCount = params.evidence.toolsUsed
    .map((toolName) => normalizePilotToolName(toolName))
    .filter((toolName) => toolName.length > 0 && !isSessionCoordinationToolName(toolName))
    .length;

  return workstreamCount > 1
    || params.run.summary.startedTools >= 2
    || params.run.summary.assistantTurns >= 2
    || successCriteriaCount > 2
    || nonSessionToolCount > 0;
}

function countPilotReviewCheckpoints(run: Pick<AgentRun, 'checkpoints'>): number {
  return run.checkpoints.filter((checkpoint) => checkpoint.title === PILOT_REVIEW_CHECKPOINT_TITLE).length;
}

function getStructuredWorkflowEvidenceEntries(
  run: Pick<AgentRun, 'evidence'>,
) {
  return normalizeAgentRunEvidenceEntries(run.evidence);
}

function hasStructuredVerifiedWorkflowEvidence(
  run: Pick<AgentRun, 'evidence'>,
): boolean {
  return getStructuredWorkflowEvidenceEntries(run).some((entry) => (
    entry.status === 'verified' || entry.status === 'resolved'
  ));
}

function buildStructuredWorkflowEvidenceSignature(
  run: Pick<AgentRun, 'evidence'>,
): string {
  return getStructuredWorkflowEvidenceEntries(run)
    .slice(-MAX_STRUCTURED_EVIDENCE_SIGNATURE_ENTRIES)
    .map((entry) => [
      entry.kind,
      entry.status,
      entry.recorder,
      entry.title,
      truncateText(entry.content, MAX_RESULT_PREVIEW_CHARS),
      entry.sourceName || '',
      entry.toolName || '',
      entry.workerSessionId || '',
      entry.artifactWorkspacePath || '',
    ].join(':'))
    .join('|');
}

function summarizeStructuredWorkflowEvidence(
  run: Pick<AgentRun, 'evidence'>,
): { total: number; verified: number; open: number } {
  const entries = getStructuredWorkflowEvidenceEntries(run);
  return {
    total: entries.length,
    verified: entries.filter((entry) => entry.status === 'verified' || entry.status === 'resolved').length,
    open: entries.filter((entry) => entry.status === 'open').length,
  };
}

function getLatestPilotReviewTimestamp(run: Pick<AgentRun, 'checkpoints'>): number {
  return run.checkpoints.reduce(
    (latestTimestamp, checkpoint) => (
      checkpoint.title === PILOT_REVIEW_CHECKPOINT_TITLE
        ? Math.max(latestTimestamp, checkpoint.timestamp)
        : latestTimestamp
    ),
    0,
  );
}

function getRecentPilotReviewHistory(
  run: Pick<AgentRun, 'checkpoints'>,
  maxItems = MAX_REVIEW_HISTORY_ITEMS,
): string[] {
  const pilotCheckpoints = run.checkpoints.filter((checkpoint) => checkpoint.title === PILOT_REVIEW_CHECKPOINT_TITLE);
  const startIndex = Math.max(0, pilotCheckpoints.length - maxItems);

  return pilotCheckpoints.slice(startIndex).map((checkpoint, index) => {
    const cycleNumber = startIndex + index + 1;
    const detail = truncateText(checkpoint.detail?.trim() || '', MAX_CHECKPOINT_DETAIL_CHARS)
      || 'Pilot requested additional corrective work.';
    return `- Correction cycle ${cycleNumber}: ${detail}`;
  });
}

function getLatestWorkerTimestamp(workers: ReadonlyArray<SubAgentSnapshot>): number {
  return workers.reduce((latestTimestamp, worker) => Math.max(latestTimestamp, worker.updatedAt), 0);
}

function getLatestTranscriptTimestamp(messages: ReadonlyArray<Pick<Message, 'timestamp'>>): number {
  return messages.reduce((latestTimestamp, message) => Math.max(latestTimestamp, message.timestamp), 0);
}

function normalizePilotPreviewSignatureText(value: string | undefined): string {
  const preview = truncateText(value, MAX_RESULT_PREVIEW_CHARS);
  if (!preview) {
    return '';
  }

  const normalized = preview
    .replace(PILOT_SESSION_ID_PATTERN, 'sub-agent')
    .replace(/\s+/g, ' ')
    .trim();

  if (NON_SUBSTANTIVE_PILOT_PREVIEW_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return '';
  }

  return normalized;
}

function normalizePilotDraftSignatureText(value: string | undefined): string {
  const normalized = (value || '')
    .replace(PILOT_SESSION_ID_PATTERN, 'sub-agent')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  if (NON_SUBSTANTIVE_PILOT_PREVIEW_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return '';
  }

  if (normalized.length <= MAX_PILOT_DRAFT_SIGNATURE_CHARS) {
    return normalized;
  }

  return normalized.slice(0, MAX_PILOT_DRAFT_SIGNATURE_CHARS);
}

function fnv1aHash(str: string, seed = 0x811c9dc5): string {
  let hash = seed >>> 0;
  for (let index = 0; index < str.length; index += 1) {
    hash ^= str.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function hashPilotStateSignature(value: string): string {
  const normalized = value || 'empty';
  return `pilot-state-v1:${fnv1aHash(normalized)}${fnv1aHash(`${normalized}\u0000${normalized.length}`, 0x9e3779b1)}`;
}

function buildWorkerStateSignature(
  workers: ReadonlyArray<Pick<SubAgentSnapshot, 'name' | 'sessionId' | 'status' | 'output' | 'lastToolResultPreview' | 'currentActivity'>>,
): string {
  return [...workers]
    .map((worker) => {
      const preview = normalizePilotPreviewSignatureText(
        worker.output?.trim()
          || worker.lastToolResultPreview?.trim()
          || worker.currentActivity?.trim()
          || '',
      );
      const identity = worker.name?.trim() || worker.sessionId;

      return `${identity}:${worker.status}:${preview}`;
    })
    .sort()
    .join('|');
}

function buildPilotStateSignature(params: {
  run: Pick<AgentRun, 'evidence'>;
  evidence: AgentRunFinalizationEvidence;
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string };
  workers: ReadonlyArray<SubAgentSnapshot>;
}): string {
  const previewEntries = new Map<string, string>();
  for (const entry of params.evidence.resultPreviews) {
    const sourceName = entry.sourceName.trim();
    const normalizedSourceName = normalizePilotToolName(sourceName);
    if (normalizedSourceName && isSessionCoordinationToolName(normalizedSourceName)) {
      continue;
    }

    const preview = normalizePilotPreviewSignatureText(entry.preview);
    if (!sourceName || !preview) {
      continue;
    }

    previewEntries.set(`${sourceName}:${preview}`, `${sourceName}:${preview}`);
  }

  const previewSignature = Array.from(previewEntries.values())
    .slice(-MAX_RESULT_PREVIEWS)
    .sort()
    .join('|');
  const toolSignature = [...new Set(
    params.evidence.toolsUsed
      .map((toolName) => normalizePilotToolName(toolName))
      .filter((toolName) => toolName.length > 0 && !isSessionCoordinationToolName(toolName)),
  )]
    .sort()
    .join('|');

  return hashPilotStateSignature(JSON.stringify({
    policyVersion: PILOT_POLICY_SIGNATURE_VERSION,
    candidateStatus: params.candidateOutcome.status,
    workerState: buildWorkerStateSignature(params.workers),
    previewState: previewSignature,
    structuredEvidenceState: buildStructuredWorkflowEvidenceSignature(params.run),
    toolState: toolSignature,
    visibleDraftState: normalizePilotDraftSignatureText(params.evidence.lastNonEmptyAssistantContent),
    lastSubstantiveResult: normalizePilotPreviewSignatureText(params.evidence.lastSubstantiveResult),
  }));
}

function hasPilotReviewedCurrentState(
  run: Pick<AgentRun, 'checkpoints' | 'updatedAt' | 'latestPilotEvaluation' | 'evidence'>,
  workers: ReadonlyArray<SubAgentSnapshot>,
  evidence: AgentRunFinalizationEvidence,
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string },
): boolean {
  const currentStateSignature = buildPilotStateSignature({
    run,
    workers,
    evidence,
    candidateOutcome,
  });
  const cachedStateSignature = run.latestPilotEvaluation?.stateSignature?.trim();
  if (cachedStateSignature) {
    return cachedStateSignature === currentStateSignature;
  }

  const currentStateTimestamp = Math.max(
    run.updatedAt,
    getLatestWorkerTimestamp(workers),
    getLatestTranscriptTimestamp(evidence.transcriptMessages),
  );

  return getLatestPilotReviewTimestamp(run) >= currentStateTimestamp;
}

function isHeuristicPilotEvaluation(
  evaluation: Pick<AgentRunPilotEvaluation, 'evaluatorVersion' | 'source'> | undefined,
): boolean {
  return evaluation?.source === 'heuristic'
    || evaluation?.evaluatorVersion?.includes('heuristic')
    || false;
}

function isUnavailablePilotEvaluation(
  evaluation: Pick<AgentRunPilotEvaluation, 'evaluatorVersion' | 'source'> | undefined,
): boolean {
  return evaluation?.source === 'unavailable'
    || evaluation?.evaluatorVersion?.includes('unavailable')
    || false;
}

function shouldReuseCachedPilotEvaluation(params: {
  latestPilotEvaluation?: AgentRunPilotEvaluation;
  reviewedCurrentState: boolean;
  hasProviderContext: boolean;
}): params is {
  latestPilotEvaluation: AgentRunPilotEvaluation;
  reviewedCurrentState: true;
  hasProviderContext: boolean;
} {
  if (!params.reviewedCurrentState || !params.latestPilotEvaluation) {
    return false;
  }

  if (!params.hasProviderContext) {
    return true;
  }

  return !isHeuristicPilotEvaluation(params.latestPilotEvaluation)
    && !isUnavailablePilotEvaluation(params.latestPilotEvaluation);
}

function formatWorkerStatus(worker: Pick<SubAgentSnapshot, 'status'>): string {
  return worker.status === 'error' ? 'failed' : worker.status;
}

function buildWorkerOutcomeLines(
  workers: ReadonlyArray<Pick<SubAgentSnapshot, 'name' | 'sessionId' | 'status' | 'output' | 'lastToolResultPreview' | 'currentActivity'>>,
): string[] {
  return workers.slice(-MAX_LIST_ITEMS).map((worker) => {
    const name = worker.name?.trim() || worker.sessionId;
    const preview = truncateText(
      worker.output?.trim()
        || worker.lastToolResultPreview?.trim()
        || worker.currentActivity?.trim()
        || 'No verified details captured.',
      MAX_RESULT_PREVIEW_CHARS,
    ) || 'No verified details captured.';
    return `- ${name} (${formatWorkerStatus(worker)}): ${preview}`;
  });
}

function truncateTextToTokenBudget(value: string, maxTokens: number): string {
  const normalized = value.trim();
  if (!normalized || maxTokens <= 0) {
    return '';
  }

  if (estimateTokens(normalized) <= maxTokens) {
    return normalized;
  }

  const approxMaxChars = Math.max(1, Math.floor((maxTokens / SAFETY_MARGIN) * CHARS_PER_TOKEN));
  if (normalized.length <= approxMaxChars) {
    return normalized;
  }

  if (approxMaxChars <= 3) {
    return normalized.slice(0, approxMaxChars);
  }

  return `${normalized.slice(0, approxMaxChars - 3).trimEnd()}...`;
}

function resolvePilotPromptTokenBudget(model: string | undefined): number {
  if (!model?.trim()) {
    return PILOT_PROMPT_DEFAULT_TOKENS;
  }

  const workingContext = getWorkingContextWindow(model);
  const reservedTokens = Math.max(2_048, Math.min(PILOT_PROMPT_RESERVED_TOKENS, Math.floor(workingContext * 0.2)));
  const availableTokens = Math.max(2_048, workingContext - reservedTokens);
  return Math.max(2_048, Math.min(availableTokens, Math.floor(workingContext * PILOT_PROMPT_CONTEXT_SHARE)));
}

function appendBudgetedPromptSection(
  sections: string[],
  section: string | undefined,
  remainingTokens: { value: number },
  maxSectionTokens = remainingTokens.value,
): void {
  const normalized = section?.trim() || '';
  const availableTokens = Math.max(0, Math.min(remainingTokens.value, maxSectionTokens));
  if (!normalized || availableTokens < PILOT_PROMPT_SECTION_MIN_TOKENS) {
    return;
  }

  const sectionTokens = estimateTokens(normalized);
  if (sectionTokens <= availableTokens) {
    sections.push(normalized);
    remainingTokens.value = Math.max(0, remainingTokens.value - sectionTokens);
    return;
  }

  const truncated = truncateTextToTokenBudget(normalized, availableTokens);
  if (!truncated) {
    return;
  }

  sections.push(truncated);
  remainingTokens.value = Math.max(0, remainingTokens.value - estimateTokens(truncated));
}

function buildDetailedWorkerEvidenceSection(
  workers: ReadonlyArray<Pick<SubAgentSnapshot, 'name' | 'sessionId' | 'status' | 'updatedAt' | 'output' | 'lastToolResultPreview' | 'currentActivity'>>,
): string | undefined {
  const entries = [...workers]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((worker) => {
      const name = worker.name?.trim() || worker.sessionId;
      const detail = worker.output?.trim()
        || worker.lastToolResultPreview?.trim()
        || worker.currentActivity?.trim()
        || 'No verified details captured.';
      return `- ${name} (${formatWorkerStatus(worker)}):\n${detail}`;
    });

  return entries.length > 0
    ? ['Latest worker evidence:', ...entries].join('\n')
    : undefined;
}

function buildVerifiedFindingsSection(
  previews: ReadonlyArray<Pick<AgentRunFinalizationEvidence['resultPreviews'][number], 'sourceName' | 'preview'>>,
): string | undefined {
  const deduped = new Map<string, string>();
  for (const entry of previews) {
    const preview = entry.preview?.trim();
    if (!preview) {
      continue;
    }
    deduped.set(`${entry.sourceName}:${preview}`, `- ${entry.sourceName}: ${preview}`);
  }

  const lines = Array.from(deduped.values());
  return lines.length > 0
    ? ['Verified findings summary:', ...lines].join('\n')
    : undefined;
}

function formatPilotTranscriptEntry(message: Message): string {
  if (message.role === 'user') {
    return `User:\n${message.content.trim() || '[No content]'}`;
  }

  if (message.role === 'assistant') {
    if (message.subAgentEvent) {
      const snapshot = message.subAgentEvent.snapshot;
      const workerName = snapshot.name?.trim() || snapshot.sessionId;
      const body = snapshot.output?.trim()
        || snapshot.lastToolResultPreview?.trim()
        || snapshot.currentActivity?.trim()
        || message.content.trim()
        || '[No worker details]';
      return `Worker ${workerName} (${snapshot.status}):\n${body}`;
    }

    return `Assistant:\n${message.content.trim() || '[No visible assistant text]'}`;
  }

  const toolName = message.toolCalls?.[0]?.name?.trim() || message.toolCallId?.trim() || 'tool';
  return `Tool ${toolName}:\n${message.content.trim() || '[No tool output]'}`;
}

function buildBudgetedTranscriptSection(messages: Message[], maxTokens: number): string | undefined {
  if (maxTokens < PILOT_PROMPT_SECTION_MIN_TOKENS) {
    return undefined;
  }

  const heading = 'Execution transcript (most recent first):';
  let remainingTokens = Math.max(0, maxTokens - estimateTokens(heading));
  if (remainingTokens < PILOT_PROMPT_SECTION_MIN_TOKENS) {
    return truncateTextToTokenBudget(heading, maxTokens);
  }

  const selectedEntries: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = formatPilotTranscriptEntry(messages[index]);
    const entryTokens = estimateTokens(entry) + 2;
    if (entryTokens <= remainingTokens) {
      selectedEntries.push(entry);
      remainingTokens -= entryTokens;
      continue;
    }

    if (selectedEntries.length === 0 || remainingTokens >= PILOT_PROMPT_SECTION_MIN_TOKENS) {
      const truncatedEntry = truncateTextToTokenBudget(entry, remainingTokens);
      if (truncatedEntry) {
        selectedEntries.push(truncatedEntry);
      }
    }
    break;
  }

  return selectedEntries.length > 0
    ? [heading, ...selectedEntries].join('\n\n')
    : undefined;
}

function buildSuccessCriteriaSection(run: Pick<AgentRun, 'goal' | 'plan'>): string {
  const objective = run.plan?.objective?.trim() || run.goal.trim();
  const successCriteria = getSuccessCriteria(run);
  const stopConditions = run.plan?.stopConditions?.filter((condition) => condition.trim().length > 0) || [];

  const lines = [`Objective: ${objective || 'Complete the current task.'}`, 'Success Criteria:', ...successCriteria.map((criterion) => `- ${criterion}`)];

  if (stopConditions.length > 0) {
    lines.push('Stop Conditions:');
    lines.push(...stopConditions.map((condition) => `- ${condition}`));
  }

  return lines.join('\n');
}

function buildProcessSummary(params: {
  run: Pick<AgentRun, 'goal' | 'plan' | 'summary' | 'evidence'>;
  workers: ReadonlyArray<SubAgentSnapshot>;
  evidence: AgentRunFinalizationEvidence;
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string };
  delegationRequired: boolean;
  delegatedWorkObserved: boolean;
}): string {
  const researchIntegrity = buildResearchIntegrityAssessment({
    run: params.run,
    evidence: params.evidence,
  });
  const workerSummary = params.workers.length > 0
    ? `Workers: ${params.workers.length} total, ${params.workers.filter((worker) => worker.status === 'running').length} running, ${params.workers.filter((worker) => worker.status === 'completed').length} completed, ${params.workers.filter((worker) => worker.status === 'error' || worker.status === 'timeout').length} failed, ${params.workers.filter((worker) => worker.status === 'cancelled').length} cancelled.`
    : 'Workers: none.';
  const toolNames = [...new Set(params.evidence.toolsUsed)].slice(0, MAX_LIST_ITEMS);
  const toolSummary = toolNames.length > 0
    ? `Tools used: ${toolNames.join(', ')}.`
    : 'Tools used: none recorded.';
  const verificationSummary = hasVerifiedFinalizationEvidence(params.evidence)
    ? 'Verified evidence is available.'
    : 'Verified evidence is currently insufficient.';
  const structuredEvidenceSummary = summarizeStructuredWorkflowEvidence(params.run);
  const delegationSummary = params.delegatedWorkObserved
    ? 'Delegation: worker activity was observed for this run.'
    : params.delegationRequired
      ? 'Delegation: missing for a non-trivial Agent mode workflow. Treat this as a process-quality gap.'
      : 'Delegation: direct execution may be acceptable because the task appears trivial.';
  const researchIntegritySummary = researchIntegrity.requiresSourceAttribution
    ? researchIntegrity.gaps.length > 0
      ? `Research integrity: ${researchIntegrity.gaps.join(' ')}`
      : researchIntegrity.candidateMentionsProviders
        ? 'Research integrity: the current draft includes provider-specific claims with explicit attribution.'
        : 'Research integrity: citation-sensitive research task detected; no provider-specific claims were found in the current draft.'
    : undefined;

  return [
    `Candidate outcome: ${params.candidateOutcome.status}. ${params.candidateOutcome.summary}`,
    `Assistant turns: ${params.run.summary.assistantTurns}.`,
    `Tool activity: ${params.run.summary.completedTools}/${params.run.summary.startedTools} completed, ${params.run.summary.failedTools} failed.`,
    workerSummary,
    toolSummary,
    `Structured evidence ledger: ${structuredEvidenceSummary.total} entries, ${structuredEvidenceSummary.verified} verified/resolved, ${structuredEvidenceSummary.open} open.`,
    delegationSummary,
    researchIntegritySummary,
    verificationSummary,
  ].join('\n');
}

async function buildPilotMemoryContextSection(
  providerContext?: AgentRunPilotProviderContext,
): Promise<string | undefined> {
  const [conversationMemory, globalMemory] = await Promise.all([
    providerContext?.conversationId
      ? getConversationMemoryForSystemPrompt(providerContext.conversationId, 80)
      : Promise.resolve(null),
    getMemoryForSystemPrompt(80),
  ]);

  if (!conversationMemory && !globalMemory) {
    return undefined;
  }

  const sections = ['Shared memory context:'];
  if (conversationMemory) {
    sections.push(`Conversation memory (shared only within this conversation):\n${conversationMemory}`);
  }
  if (globalMemory) {
    sections.push(`Global memory (durable across conversations):\n${globalMemory}`);
  }
  return sections.join('\n\n');
}

async function buildPilotEvaluationPrompt(params: PilotDecisionParams): Promise<string> {
  const delegationRequired = requiresDelegationForPilotReview({
    run: params.run,
    evidence: params.evidence,
  });
  const delegatedWorkObserved = hasDelegatedWorkEvidence({
    evidence: params.evidence,
    workers: params.workers,
  });
  const researchIntegrity = buildResearchIntegrityAssessment({
    run: params.run,
    evidence: params.evidence,
  });
  const promptTokenBudget = resolvePilotPromptTokenBudget(params.providerContext?.model);
  const candidateDraft = params.evidence.lastNonEmptyAssistantContent.trim();
  const detailedResult = params.evidence.lastSubstantiveResult.trim();
  const structuredEvidenceSection = buildAgentRunEvidencePromptSection(params.run.evidence, {
    limit: 12,
    includeContent: true,
    heading: 'Structured workflow evidence:',
  });
  const memoryContextSection = await buildPilotMemoryContextSection(params.providerContext);
  const requestGovernanceSection = buildRequestGovernancePromptSection(params);
  const baseSections = [
    'Score this run using the following rubric:',
    '- 0: absent, wrong, or contradicted by evidence.',
    '- 1: very weak or mostly speculative.',
    '- 2: partially addressed but still materially incomplete.',
    '- 3: mostly addressed but missing verification or polish.',
    '- 4: strong and verified enough for production delivery.',
    '- 5: fully satisfied, verified, and production-ready.',
    '- Process quality must penalize non-trivial Agent mode work that stayed solo when delegation to a focused worker was warranted.',
    '- For research, comparison, or official-documentation tasks, provider-specific claims in the user-visible answer must cite named sources or URLs.',
    '- Treat uncited quantitative, pricing, latency, or superlative provider claims as evidence/adherence gaps that block finalization.',
    'Approval standard: finalize only when every success criterion is at least 4/5, overall score is at least 16/20, and no material blocker remains.',
    buildSuccessCriteriaSection(params.run),
    buildProcessSummary({
      run: params.run,
      workers: params.workers ?? [],
      evidence: params.evidence,
      candidateOutcome: params.candidateOutcome,
      delegationRequired,
      delegatedWorkObserved,
    }),
    requestGovernanceSection,
    researchIntegrity.gaps.length > 0
      ? ['Current research integrity gaps:', ...researchIntegrity.gaps.map((gap) => `- ${gap}`)].join('\n')
      : undefined,
  ];

  const sections = baseSections.filter((section): section is string => Boolean(section));
  const remainingTokens = {
    value: Math.max(
      0,
      promptTokenBudget - sections.reduce((total, section) => total + estimateTokens(section), 0),
    ),
  };

  appendBudgetedPromptSection(
    sections,
    candidateDraft ? `Latest assistant draft:\n${candidateDraft}` : undefined,
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_DRAFT_SECTION_SHARE),
  );
  appendBudgetedPromptSection(
    sections,
    detailedResult && detailedResult !== candidateDraft
      ? `Detailed verified result:\n${detailedResult}`
      : undefined,
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_RESULT_SECTION_SHARE),
  );
  appendBudgetedPromptSection(
    sections,
    params.workers?.length ? buildDetailedWorkerEvidenceSection(params.workers) : undefined,
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_WORKER_SECTION_SHARE),
  );
  appendBudgetedPromptSection(
    sections,
    buildVerifiedFindingsSection(params.evidence.resultPreviews),
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_FINDINGS_SECTION_SHARE),
  );
  appendBudgetedPromptSection(
    sections,
    structuredEvidenceSection,
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_STRUCTURED_EVIDENCE_SECTION_SHARE),
  );
  appendBudgetedPromptSection(
    sections,
    memoryContextSection,
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_MEMORY_SECTION_SHARE),
  );
  appendBudgetedPromptSection(
    sections,
    buildBudgetedTranscriptSection(params.evidence.transcriptMessages, remainingTokens.value),
    remainingTokens,
  );
  appendBudgetedPromptSection(
    sections,
    params.providerContext?.systemPromptText?.trim()
      ? `Supervisor charter excerpt:\n${params.providerContext.systemPromptText.trim()}`
      : undefined,
    remainingTokens,
    Math.floor(promptTokenBudget * PILOT_SUPERVISOR_SECTION_SHARE),
  );

  return sections.join('\n\n');
}

function resolvePilotEvaluatorTemperature(
  providerContext: AgentRunPilotProviderContext,
): number | undefined {
  const model = providerContext.model.trim().toLowerCase();
  return model.startsWith('gemini-3') ? undefined : 0;
}

function resolvePilotEvaluatorMaxTokens(
  successCriteriaCount: number,
  retry = false,
): number {
  const extraCriteriaCount = Math.max(0, successCriteriaCount - 2);
  const baseBudget = Math.min(
    PILOT_RESPONSE_MAX_TOKENS_CAP,
    PILOT_RESPONSE_BASE_MAX_TOKENS + (extraCriteriaCount * PILOT_RESPONSE_PER_EXTRA_CRITERION_TOKENS),
  );

  if (!retry) {
    return baseBudget;
  }

  return Math.max(PILOT_RESPONSE_RETRY_MIN_TOKENS, baseBudget - PILOT_RESPONSE_RETRY_TOKEN_REDUCTION);
}

type PilotEvaluatorAttemptName = 'structured_output' | 'repair_json' | 'raw_json' | 'tool_call';

interface PilotEvaluatorAttemptFailure {
  name: PilotEvaluatorAttemptName;
  outcome: 'request_failed' | 'response_unparseable';
  detail?: string;
}

interface PilotEvaluatorInvocationResult {
  payload?: Record<string, unknown>;
  failure?: {
    reason: Extract<AgentRunPilotFallbackReason, 'request_failed' | 'response_unparseable'>;
    detail?: string;
  };
}

function getPilotEvaluatorAttemptLabel(name: PilotEvaluatorAttemptName): string {
  switch (name) {
    case 'structured_output':
      return 'structured-output attempt';
    case 'repair_json':
      return 'machine-readable repair attempt';
    case 'raw_json':
      return 'raw-JSON fallback';
    case 'tool_call':
      return 'tool-call fallback';
    default:
      return 'pilot attempt';
  }
}

function buildPilotEvaluatorFailure(
  attempts: ReadonlyArray<PilotEvaluatorAttemptFailure>,
): PilotEvaluatorInvocationResult['failure'] {
  if (attempts.length === 0) {
    return { reason: 'response_unparseable' };
  }

  const reason = attempts.some((attempt) => attempt.outcome === 'response_unparseable')
    ? 'response_unparseable'
    : 'request_failed';
  const detail = attempts
    .map((attempt) => {
      const label = getPilotEvaluatorAttemptLabel(attempt.name);
      if (attempt.outcome === 'response_unparseable') {
        return `${label} returned no schema-complete ${PILOT_TOOL_NAME} payload.`;
      }

      const errorDetail = truncateText(attempt.detail?.trim(), 220);
      return errorDetail
        ? `${label} failed: ${errorDetail}`
        : `${label} failed before returning a response.`;
    })
    .join(' ')
    .trim();

  return {
    reason,
    ...(detail ? { detail } : {}),
  };
}

async function invokePilotEvaluator(params: Required<Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'providerContext'>> & {
  workers: ReadonlyArray<SubAgentSnapshot>;
  signal?: AbortSignal;
  onUsage?: (usage: TokenUsage) => void;
}): Promise<PilotEvaluatorInvocationResult> {
  const llm = new LlmService(params.providerContext.provider);
  const evaluationPrompt = await buildPilotEvaluationPrompt(params);
  const successCriteria = getSuccessCriteria(params.run);
  const temperature = resolvePilotEvaluatorTemperature(params.providerContext);
  const initialMaxTokens = resolvePilotEvaluatorMaxTokens(successCriteria.length);
  const retryMaxTokens = resolvePilotEvaluatorMaxTokens(successCriteria.length, true);
  const requestMessages = [
    { role: 'system', content: PILOT_SYSTEM_PROMPT },
    { role: 'user', content: evaluationPrompt },
  ];
  let recoverablePayload: Record<string, unknown> | undefined;
  const requestOptions = {
    model: params.providerContext.model,
    maxTokens: initialMaxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    signal: params.signal,
    structuredOutput: PILOT_STRUCTURED_OUTPUT,
  };
  const attempts: PilotEvaluatorAttemptFailure[] = [];
  const reportUsage = (response: unknown): void => {
    const usage = extractResponseTokenUsage(response, params.providerContext.model);
    if (usage) {
      params.onUsage?.(usage);
    }
  };

  const performAttempt = async (
    name: PilotEvaluatorAttemptName,
    requestFactory: () => Promise<any>,
  ): Promise<any | undefined> => {
    try {
      const response = await requestFactory();
      reportUsage(response);
      return response;
    } catch (error) {
      if (isAbortErrorLike(error, params.signal)) {
        throw error;
      }

      attempts.push({
        name,
        outcome: 'request_failed',
        detail: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };

  const parseAttemptResponse = (
    name: PilotEvaluatorAttemptName,
    response: any,
  ): Record<string, unknown> | undefined => {
    if (!response) {
      return undefined;
    }

    const parsed = extractValidatedPilotEvaluationPayload(response, successCriteria);
    if (parsed) {
      return parsed;
    }

    const recoverable = extractPilotEvaluationPayload(response);
    if (isRecoverablePilotEvaluationPayload(recoverable)) {
      recoverablePayload = recoverable;
    }

    attempts.push({ name, outcome: 'response_unparseable' });
    return undefined;
  };

  const response = await performAttempt('structured_output', () => llm.sendMessage(requestMessages, requestOptions));
  const parsedResponse = parseAttemptResponse('structured_output', response);
  if (parsedResponse) {
    return { payload: parsedResponse };
  }

  const retryAssistantMessage = response ? buildPilotRetryAssistantMessage(response) : undefined;
  if (retryAssistantMessage) {
    const retryResponse = await performAttempt(
      'repair_json',
      () => llm.sendMessage(
        [
          ...requestMessages,
          retryAssistantMessage as any,
          {
            role: 'user',
            content: 'Your previous reply was not machine-readable. Return only one raw JSON object matching the pilot_report schema now. Do not include prose, markdown, or code fences.',
          },
        ],
        {
          ...requestOptions,
          maxTokens: retryMaxTokens,
        },
      ),
    );
    const parsedRetryResponse = parseAttemptResponse('repair_json', retryResponse);
    if (parsedRetryResponse) {
      return { payload: parsedRetryResponse };
    }
  }

  const jsonFallbackResponse = await performAttempt(
    'raw_json',
    () => llm.sendMessage(
      [
        {
          role: 'system',
          content: `${PILOT_SYSTEM_PROMPT}\nIf structured output is not enforced by the transport, return the pilot_report JSON object as raw JSON with no prose or markdown fences.`,
        },
        {
          role: 'user',
          content: `${evaluationPrompt}\n\nYour previous replies were not machine-readable. Return only the pilot_report JSON object as raw JSON now.`,
        },
      ],
      {
        model: params.providerContext.model,
        maxTokens: retryMaxTokens,
        signal: params.signal,
        ...(temperature !== undefined ? { temperature } : {}),
      },
    ),
  );
  const parsedJsonFallbackResponse = parseAttemptResponse('raw_json', jsonFallbackResponse);
  if (parsedJsonFallbackResponse) {
    return { payload: parsedJsonFallbackResponse };
  }

  const toolFallbackResponse = await performAttempt(
    'tool_call',
    () => llm.sendMessage(
      [
        {
          role: 'system',
          content: PILOT_TOOL_CALL_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: `${evaluationPrompt}\n\nCall the pilot_report tool exactly once now. Do not include prose or markdown.`,
        },
      ],
      {
        model: params.providerContext.model,
        maxTokens: retryMaxTokens,
        signal: params.signal,
        ...(temperature !== undefined ? { temperature } : {}),
        tools: [PILOT_EVALUATION_TOOL],
        toolChoice: {
          type: 'tool',
          name: PILOT_TOOL_NAME,
          disableParallelToolUse: true,
        },
      },
    ),
  );
  const parsedToolFallbackResponse = parseAttemptResponse('tool_call', toolFallbackResponse);
  if (parsedToolFallbackResponse) {
    return { payload: parsedToolFallbackResponse };
  }

  if (recoverablePayload) {
    return { payload: recoverablePayload };
  }

  return { failure: buildPilotEvaluatorFailure(attempts) };
}

function buildHeuristicCriterionEvaluations(params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'workers'>): AgentRunPilotCriterionEvaluation[] {
  const successCriteria = getSuccessCriteria(params.run);
  const hasVerifiedEvidence = hasVerifiedFinalizationEvidence(params.evidence)
    || hasStructuredVerifiedWorkflowEvidence(params.run);
  const researchIntegrity = buildResearchIntegrityAssessment({
    run: params.run,
    evidence: params.evidence,
  });
  const hasResearchIntegrityGaps = researchIntegrity.gaps.length > 0;
  const hasPilotReadyEvidence = hasVerifiedEvidence && !hasResearchIntegrityGaps;
  const hasIncompleteReviewWork = params.evidence.hasIncompleteToolCalls
    || (params.workers ?? []).some((worker) => worker.status === 'running');

  return successCriteria.map((criterion) => {
    const score = params.candidateOutcome.status === 'completed'
      ? hasPilotReadyEvidence
        ? hasIncompleteReviewWork ? 3 : 4
        : hasResearchIntegrityGaps
          ? 2
        : 2
      : 1;

    return {
      criterion,
      score,
      maxScore: PILOT_DIMENSION_MAX_SCORE,
      status: score >= 4 ? 'met' : score >= 2 ? 'partial' : params.candidateOutcome.status === 'completed' ? 'unmet' : 'blocked',
      rationale: params.candidateOutcome.status === 'completed'
        ? hasPilotReadyEvidence
          ? hasIncompleteReviewWork
            ? 'Verified evidence exists, but in-flight work still remains, so the run is not ready for final delivery.'
            : 'Verified evidence exists and the run appears complete enough for heuristic approval.'
          : hasResearchIntegrityGaps
            ? 'The workflow produced a draft, but the user-visible answer still contains uncited or unsupported research claims.'
          : 'The workflow reached a completion attempt without enough verified evidence.'
        : 'The workflow ended unsuccessfully and needs another recovery attempt or a blocker report.',
    };
  });
}

function buildHeuristicPilotEvaluation(params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'workers'>): AgentRunPilotEvaluation {
  const hasVerifiedEvidence = hasVerifiedFinalizationEvidence(params.evidence)
    || hasStructuredVerifiedWorkflowEvidence(params.run);
  const researchIntegrity = buildResearchIntegrityAssessment({
    run: params.run,
    evidence: params.evidence,
  });
  const hasResearchIntegrityGaps = researchIntegrity.gaps.length > 0;
  const hasPilotReadyEvidence = hasVerifiedEvidence && !hasResearchIntegrityGaps;
  const hasIncompleteReviewWork = params.evidence.hasIncompleteToolCalls
    || (params.workers ?? []).some((worker) => worker.status === 'running');
  const delegationRequired = requiresDelegationForPilotReview({
    run: params.run,
    evidence: params.evidence,
  });
  const delegatedWorkObserved = hasDelegatedWorkEvidence({
    evidence: params.evidence,
    workers: params.workers,
  });
  const missingDelegation = delegationRequired && !delegatedWorkObserved;
  const completionScore = params.candidateOutcome.status === 'completed'
    ? hasPilotReadyEvidence
      ? hasIncompleteReviewWork ? 3 : 5
      : hasResearchIntegrityGaps
        ? 3
      : 2
    : 1;
  const adherenceScore = params.candidateOutcome.status === 'cancelled'
    ? 1
    : params.candidateOutcome.status === 'completed' && !hasIncompleteReviewWork
      ? hasResearchIntegrityGaps
        ? 2
        : missingDelegation ? 3 : 4
      : 3;
  const evidenceScore = hasPilotReadyEvidence ? 5 : hasVerifiedEvidence ? 2 : 1;
  const processScore = params.candidateOutcome.status === 'completed'
    ? hasIncompleteReviewWork ? 2 : hasResearchIntegrityGaps ? 2 : missingDelegation ? 2 : 4
    : 2;
  const criterionEvaluations = buildHeuristicCriterionEvaluations(params);
  const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
  const approved = params.candidateOutcome.status === 'completed'
    && hasPilotReadyEvidence
    && !hasIncompleteReviewWork
    && !missingDelegation
    && criterionEvaluations.every((criterion) => criterion.score >= 4)
    && overallScore >= PILOT_HEURISTIC_APPROVAL_SCORE_THRESHOLD;
  const recommendedAction: AgentRunPilotRecommendedAction = approved
    ? 'finalize'
    : params.candidateOutcome.status === 'cancelled'
      ? 'blocked'
      : 'continue';
  const controlAction = derivePilotControlAction({
    recommendedAction,
    approved,
    candidateStatus: params.candidateOutcome.status,
  });
  const gaps = approved
    ? []
    : mergeUniqueStringLists(
        hasIncompleteReviewWork
          ? ['In-flight work still remains, so final delivery would be premature.']
          : [],
        missingDelegation
          ? ['Agent mode expected a focused worker for this non-trivial task before final delivery.']
          : [],
        researchIntegrity.gaps,
        !hasIncompleteReviewWork && !missingDelegation && !hasResearchIntegrityGaps
          ? ['Pilot approval requires stronger criterion-by-criterion verification.']
          : [],
      );
  const nextActions = approved
    ? []
    : mergeUniqueStringLists(
        hasIncompleteReviewWork
          ? ['Preserve the current outputs and continue monitoring incomplete workers or tool activity until they reach a terminal state before finalizing.']
          : [],
        missingDelegation
          ? ['Keep the current plan and verified findings, then delegate the remaining gap-closing work to a focused sub-agent instead of finishing solo.']
          : [],
        hasResearchIntegrityGaps
          ? [
              'Revise the existing draft to cite named official sources or URLs for each provider-specific claim.',
              'Remove or clearly qualify any quantitative, pricing, latency, or superlative claim that is not directly supported by cited evidence.',
            ]
          : [],
        !hasIncompleteReviewWork && !missingDelegation && !hasResearchIntegrityGaps
          ? params.candidateOutcome.status === 'completed'
            ? ['Preserve the current workflow artifacts, close the unmet criteria with targeted corrective work, and strengthen verification before finalizing.']
            : ['Preserve any verified findings from this run, diagnose the failing step, and continue with a materially different corrective approach instead of restarting from scratch.']
          : [],
      );

  return {
    evaluatorVersion: `${PILOT_EVALUATOR_VERSION}-heuristic`,
    evaluatedAt: Date.now(),
    objective: params.run.plan?.objective?.trim() || params.run.goal.trim() || 'Complete the current task.',
    completionScore,
    adherenceScore,
    evidenceScore,
    processScore,
    overallScore,
    maxOverallScore: PILOT_TOTAL_MAX_SCORE,
    approvalThreshold: PILOT_HEURISTIC_APPROVAL_SCORE_THRESHOLD,
    approved,
    recommendedAction,
    controlAction,
    confidence: hasVerifiedEvidence && delegatedWorkObserved && !hasIncompleteReviewWork ? 'medium' : 'low',
    summary: approved
      ? 'Heuristic pilot approval: the run appears complete, delegated appropriately, and verified.'
      : params.candidateOutcome.status === 'cancelled'
        ? 'Heuristic pilot review cancelled further autonomous work.'
      : hasResearchIntegrityGaps
        ? 'Heuristic pilot review found uncited or unsupported research claims before final delivery.'
      : missingDelegation
        ? 'Heuristic pilot review found a delegation gap before final delivery.'
      : params.candidateOutcome.status === 'completed' && hasIncompleteReviewWork
        ? 'Heuristic pilot review found in-flight work, so final delivery is not ready yet.'
      : params.candidateOutcome.status === 'completed'
        ? 'Heuristic pilot review found remaining gaps before final delivery.'
        : 'Heuristic pilot review found a failed or cancelled outcome that needs recovery or a blocker report.',
    rationale: approved
      ? 'Verified evidence exists, the workflow reached a strong completion signal, and delegation expectations were satisfied.'
      : params.candidateOutcome.status === 'cancelled'
        ? 'The workflow was cancelled, so Pilot should not continue autonomous execution.'
      : hasResearchIntegrityGaps
        ? `Verified work exists, but the current draft still has research-integrity problems. ${researchIntegrity.gaps.join(' ')}`
      : missingDelegation
        ? 'The workflow gathered evidence, but it stayed solo on a non-trivial Agent mode task that should have been delegated before approval.'
      : params.candidateOutcome.status === 'completed' && hasIncompleteReviewWork
        ? 'Verified evidence exists, but Pilot should wait for the remaining in-flight work to reach a terminal state before approving final delivery.'
      : 'The heuristic fallback does not have enough verified evidence or a successful enough outcome to approve finalization.',
    source: 'heuristic',
    stateSignature: buildPilotStateSignature({
      run: params.run,
      evidence: params.evidence,
      candidateOutcome: params.candidateOutcome,
      workers: params.workers ?? [],
    }),
    strengths: approved ? ['Verified evidence was captured.', 'No in-flight work remained at review time.', 'Delegated worker activity supported the final result.'] : [],
    gaps,
    nextActions,
    criterionEvaluations,
  };
}

function buildPilotUnavailableRationale(params: {
  reason: AgentRunPilotFallbackReason;
  providerContext?: AgentRunPilotProviderContext;
  detail?: string;
}): string {
  switch (params.reason) {
    case 'no_provider_context':
      return 'No enabled provider/model with a usable API key was available for the live pilot review.';
    case 'request_failed':
      return params.detail?.trim()
        ? `The live pilot request failed before a structured assessment could be returned. ${params.detail.trim()}`
        : 'The live pilot request failed before a structured assessment could be returned.';
    case 'response_unparseable':
    default:
      return params.providerContext
        ? `The live pilot model (${params.providerContext.provider.name} / ${params.providerContext.model}) did not return a machine-readable ${PILOT_TOOL_NAME} JSON payload after all retries.`
        : 'The live pilot model did not return a machine-readable JSON assessment payload.';
  }
}

function buildPilotUnavailableNextAction(reason: AgentRunPilotFallbackReason): string {
  return reason === 'no_provider_context'
    ? 'Restore an enabled provider/model/API key for the conversation and rerun the pilot review before final delivery.'
    : reason === 'request_failed'
      ? 'Retry the pilot review once provider connectivity and credentials are healthy; do not treat this run as approved until the live pilot returns a structured report.'
      : 'Retry the pilot review after confirming structured-output compatibility; do not treat this run as approved until the live pilot returns a structured report.';
}

function buildHeuristicPilotFallbackEvaluation(
  params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'workers'> & {
    reason: AgentRunPilotFallbackReason;
    providerContext?: AgentRunPilotProviderContext;
    detail?: string;
  },
): AgentRunPilotEvaluation {
  const heuristicEvaluation = buildHeuristicPilotEvaluation(params);
  const unavailableRationale = buildPilotUnavailableRationale({
    reason: params.reason,
    providerContext: params.providerContext,
    detail: params.detail,
  });

  return {
    ...heuristicEvaluation,
    evaluatorVersion: `${PILOT_EVALUATOR_VERSION}-heuristic-fallback`,
    summary: `Heuristic fallback used because the live pilot assessment was unavailable. ${heuristicEvaluation.summary}`,
    rationale: `${unavailableRationale} ${heuristicEvaluation.rationale}`,
    fallbackReason: params.reason,
  };
}

function buildLivePilotUnavailableFallbackEvaluation(
  params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'workers'> & {
    reason: AgentRunPilotFallbackReason;
    providerContext?: AgentRunPilotProviderContext;
    detail?: string;
  },
): AgentRunPilotEvaluation {
  return buildHeuristicPilotFallbackEvaluation(params);
}

function buildPilotUnavailableEvaluation(params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'workers'> & {
  reason: AgentRunPilotFallbackReason;
  providerContext?: AgentRunPilotProviderContext;
  detail?: string;
}): AgentRunPilotEvaluation {
  const objective = params.run.plan?.objective?.trim() || params.run.goal.trim() || 'Complete the current task.';
  const rationale = buildPilotUnavailableRationale({
    reason: params.reason,
    providerContext: params.providerContext,
    detail: params.detail,
  });
  const nextAction = buildPilotUnavailableNextAction(params.reason);
  const criterionEvaluations = getSuccessCriteria(params.run).map((criterion) => ({
    criterion,
    score: 0,
    maxScore: PILOT_DIMENSION_MAX_SCORE,
    status: 'blocked' as const,
    rationale,
  }));

  return {
    evaluatorVersion: `${PILOT_EVALUATOR_VERSION}-unavailable`,
    evaluatedAt: Date.now(),
    objective,
    completionScore: 0,
    adherenceScore: 0,
    evidenceScore: 0,
    processScore: 0,
    overallScore: 0,
    maxOverallScore: PILOT_TOTAL_MAX_SCORE,
    approvalThreshold: PILOT_APPROVAL_SCORE_THRESHOLD,
    approved: false,
    recommendedAction: 'blocked',
    controlAction: params.candidateOutcome.status === 'cancelled' ? 'cancel' : 'block',
    confidence: 'low',
    summary: params.reason === 'no_provider_context'
      ? 'Pilot evaluation unavailable because no live provider context was available.'
      : 'Pilot evaluation unavailable because the live provider did not return a machine-readable assessment.',
    rationale,
    source: 'unavailable',
    fallbackReason: params.reason,
    stateSignature: buildPilotStateSignature({
      run: params.run,
      evidence: params.evidence,
      candidateOutcome: params.candidateOutcome,
      workers: params.workers ?? [],
    }),
    strengths: [],
    gaps: ['A real pilot assessment was not produced, so final delivery must remain blocked.'],
    nextActions: [nextAction],
    criterionEvaluations,
  };
}

function applyResearchIntegrityPilotGuardrails(
  evaluation: AgentRunPilotEvaluation,
  params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome'>,
): AgentRunPilotEvaluation {
  if (params.candidateOutcome.status !== 'completed') {
    return evaluation;
  }

  const researchIntegrity = buildResearchIntegrityAssessment({
    run: params.run,
    evidence: params.evidence,
  });
  if (researchIntegrity.gaps.length === 0) {
    return evaluation;
  }

  const recommendedAction: AgentRunPilotRecommendedAction = 'continue';
  const approved = false;
  const completionScore = Math.min(evaluation.completionScore, 3);
  const adherenceScore = Math.min(evaluation.adherenceScore, 3);
  const evidenceScore = Math.min(evaluation.evidenceScore, 2);
  const processScore = Math.min(evaluation.processScore, 3);
  const overallScore = completionScore + adherenceScore + evidenceScore + processScore;

  return {
    ...evaluation,
    completionScore,
    adherenceScore,
    evidenceScore,
    processScore,
    overallScore,
    approved,
    recommendedAction,
    controlAction: derivePilotControlAction({
      recommendedAction,
      approved,
      candidateStatus: params.candidateOutcome.status,
    }),
    confidence: evaluation.confidence === 'high' ? 'medium' : 'low',
    summary: 'Pilot found uncited or unsupported research claims that must be corrected before final delivery.',
    rationale: `${evaluation.rationale} Research integrity gap: ${researchIntegrity.gaps.join(' ')}`.trim(),
    gaps: mergeUniqueStringLists(evaluation.gaps, researchIntegrity.gaps).slice(0, MAX_LIST_ITEMS),
    nextActions: mergeUniqueStringLists(
      [
        'Revise the existing draft to cite named official sources or URLs for each provider-specific claim.',
        'Remove or clearly qualify any quantitative, pricing, latency, or superlative claim that is not directly supported by cited evidence.',
      ],
      evaluation.nextActions,
    ).slice(0, MAX_LIST_ITEMS),
    criterionEvaluations: evaluation.criterionEvaluations.map((criterion) => ({
      ...criterion,
      score: Math.min(criterion.score, 3),
      status: criterion.score >= 4 ? 'partial' : criterion.status,
      rationale: criterion.score >= 4
        ? `${criterion.rationale} Research integrity gap: cite the supporting source or remove unsupported provider claims before final delivery.`
        : criterion.rationale,
    })),
  };
}

function applyRequestAssessmentPilotGuardrails(
  evaluation: AgentRunPilotEvaluation,
  params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'candidateOutcome' | 'workers'>,
): AgentRunPilotEvaluation {
  const assessment = getPilotRequestAssessment(params);
  if (assessment.action === 'proceed') {
    return evaluation;
  }

  const candidateText = assessment.action === 'direct'
    ? params.evidence.lastNonEmptyAssistantContent.trim()
    : params.evidence.lastNonEmptyAssistantContent.trim() || params.evidence.lastSubstantiveResult.trim();
  const responseEvaluation = evaluateResponseAgainstRequestAssessment(assessment, candidateText, {
    usedWorkflow: params.run.summary.startedTools > 0
      || params.evidence.toolsUsed.length > 0
      || (params.workers ?? []).length > 0,
  });
  const hasVerifiedEvidence = hasVerifiedFinalizationEvidence(params.evidence);

  if (assessment.action === 'direct') {
    if (responseEvaluation.handled && (responseEvaluation.askedForClarification || hasVerifiedEvidence)) {
      const completionScore = Math.max(evaluation.completionScore, responseEvaluation.askedForClarification ? 4 : 5);
      const adherenceScore = Math.max(evaluation.adherenceScore, 5);
      const evidenceScore = responseEvaluation.askedForClarification
        ? Math.max(evaluation.evidenceScore, 4)
        : Math.max(evaluation.evidenceScore, hasVerifiedEvidence ? 5 : 4);
      const processScore = Math.max(
        evaluation.processScore,
        params.run.summary.startedTools > 0 || params.evidence.toolsUsed.length > 0 || (params.workers ?? []).length > 0
          ? 3
          : 5,
      );
      const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
      const approved = overallScore >= evaluation.approvalThreshold;
      const recommendedAction: AgentRunPilotRecommendedAction = approved ? 'finalize' : 'continue';

      return {
        ...evaluation,
        completionScore,
        adherenceScore,
        evidenceScore,
        processScore,
        overallScore,
        approved,
        recommendedAction,
        controlAction: derivePilotControlAction({
          recommendedAction,
          approved,
          candidateStatus: params.candidateOutcome.status,
        }),
        confidence: evaluation.confidence === 'low' ? 'medium' : evaluation.confidence,
        summary: responseEvaluation.askedForClarification
          ? 'Pilot approved the direct-lookup clarification response.'
          : 'Pilot approved the direct lookup answer from verified evidence.',
        rationale: responseEvaluation.askedForClarification
          ? 'The request was a trivial direct lookup, but an essential detail was still missing. The response asked only for that missing context and avoided unnecessary workflow work.'
          : 'The request was a trivial direct lookup. The response answered it directly once verified evidence was available, so additional autonomous workflow work is not justified.',
        strengths: mergeUniqueStringLists(responseEvaluation.strengths, evaluation.strengths).slice(0, MAX_LIST_ITEMS),
        gaps: [],
        nextActions: [],
        criterionEvaluations: evaluation.criterionEvaluations.map((criterion) => ({
          ...criterion,
          score: Math.max(criterion.score, 4),
          status: 'met',
          rationale: responseEvaluation.askedForClarification
            ? 'For a trivial direct lookup with missing context, the correct response is a concise clarification request with no workflow ceremony.'
            : 'For a trivial direct lookup, the correct response is a direct answer grounded in the verified result rather than another workflow cycle.',
        })),
      };
    }

    if (hasVerifiedEvidence) {
      const completionScore = Math.min(evaluation.completionScore, 3);
      const adherenceScore = Math.min(evaluation.adherenceScore, 3);
      const evidenceScore = Math.max(evaluation.evidenceScore, 4);
      const processScore = Math.min(evaluation.processScore, 2);
      const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
      const approved = false;
      const recommendedAction: AgentRunPilotRecommendedAction = 'continue';

      return {
        ...evaluation,
        completionScore,
        adherenceScore,
        evidenceScore,
        processScore,
        overallScore,
        approved,
        recommendedAction,
        controlAction: derivePilotControlAction({
          recommendedAction,
          approved,
          candidateStatus: params.candidateOutcome.status,
        }),
        confidence: evaluation.confidence === 'high' ? 'medium' : 'low',
        summary: 'Pilot found that the direct lookup already has verified evidence, but the user-facing answer was not delivered directly.',
        rationale: `${evaluation.rationale} The request is a trivial direct lookup. Verified evidence is already available, so the next step must be a direct user answer rather than another tool or delegation cycle.`.trim(),
        strengths: mergeUniqueStringLists(responseEvaluation.strengths, evaluation.strengths).slice(0, MAX_LIST_ITEMS),
        gaps: mergeUniqueStringLists(
          evaluation.gaps,
          responseEvaluation.gaps,
          ['Verified evidence already exists, but the response still did not answer the user directly.'],
        ).slice(0, MAX_LIST_ITEMS),
        nextActions: [
          'Do not call tools again.',
          'Answer the user directly from the verified evidence already captured for this request.',
        ],
        criterionEvaluations: evaluation.criterionEvaluations.map((criterion) => ({
          ...criterion,
          score: Math.min(Math.max(criterion.score, 2), 3),
          status: criterion.score >= 4 ? 'partial' : criterion.status,
          rationale: 'The direct lookup already has verified evidence. The remaining work is to answer the user directly without repeating tool calls.',
        })),
      };
    }
  }

  if (assessment.action === 'clarify' && responseEvaluation.handled && evaluation.source !== 'unavailable') {
    const completionScore = Math.max(evaluation.completionScore, 4);
    const adherenceScore = Math.max(evaluation.adherenceScore, 5);
    const evidenceScore = Math.max(evaluation.evidenceScore, 4);
    const processScore = Math.max(evaluation.processScore, 5);
    const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
    const approved = overallScore >= evaluation.approvalThreshold;
    const recommendedAction: AgentRunPilotRecommendedAction = approved ? 'finalize' : 'continue';

    return {
      ...evaluation,
      completionScore,
      adherenceScore,
      evidenceScore,
      processScore,
      overallScore,
      approved,
      recommendedAction,
      controlAction: derivePilotControlAction({
        recommendedAction,
        approved,
        candidateStatus: params.candidateOutcome.status,
      }),
      confidence: evaluation.confidence === 'low' ? 'medium' : evaluation.confidence,
      summary: 'Pilot approved the early stop: the request was low-signal and the response correctly asked for clarification.',
      rationale: 'The user input did not provide a meaningful task. The response stopped early, asked for the missing details, and avoided unnecessary workflow work.',
      strengths: mergeUniqueStringLists(
        responseEvaluation.strengths,
        [
          'The workflow stopped early instead of manufacturing work from a low-signal request.',
        ],
        evaluation.strengths,
      ).slice(0, MAX_LIST_ITEMS),
      gaps: [],
      nextActions: [],
      criterionEvaluations: evaluation.criterionEvaluations.map((criterion) => ({
        ...criterion,
        score: Math.max(criterion.score, 4),
        status: 'met',
        rationale: 'For a low-signal request, the correct deliverable was a concise clarification request that stopped the workflow early.',
      })),
    };
  }

  if (assessment.action === 'clarify') {
    const completionScore = Math.min(evaluation.completionScore, 2);
    const adherenceScore = Math.min(evaluation.adherenceScore, 2);
    const evidenceScore = Math.min(evaluation.evidenceScore, 2);
    const processScore = Math.min(evaluation.processScore, 2);
    const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
    const approved = false;
    const recommendedAction: AgentRunPilotRecommendedAction = 'continue';

    return {
      ...evaluation,
      completionScore,
      adherenceScore,
      evidenceScore,
      processScore,
      overallScore,
      approved,
      recommendedAction,
      controlAction: derivePilotControlAction({
        recommendedAction,
        approved,
        candidateStatus: params.candidateOutcome.status,
      }),
      confidence: 'low',
      summary: 'Pilot found a low-signal request that should have been stopped early.',
      rationale: `${evaluation.rationale} ${assessment.reasons.join(' ')} ${responseEvaluation.gaps.join(' ')}`.trim(),
      strengths: mergeUniqueStringLists(evaluation.strengths, responseEvaluation.strengths).slice(0, MAX_LIST_ITEMS),
      gaps: mergeUniqueStringLists(
        evaluation.gaps,
        assessment.reasons,
        responseEvaluation.gaps,
      ).slice(0, MAX_LIST_ITEMS),
      nextActions: mergeUniqueStringLists(
        [
          'Stop the workflow now and ask the user for the concrete task or missing details instead of continuing autonomously.',
        ],
        evaluation.nextActions,
      ).slice(0, MAX_LIST_ITEMS),
      criterionEvaluations: evaluation.criterionEvaluations.map((criterion) => ({
        ...criterion,
        score: Math.min(criterion.score, 2),
        status: criterion.status === 'blocked' ? 'blocked' : 'unmet',
        rationale: 'The request was too low-signal for autonomous execution. The correct response is to ask the user for concrete details.',
      })),
    };
  }

  if (responseEvaluation.handled) {
    return {
      ...evaluation,
      strengths: mergeUniqueStringLists(responseEvaluation.strengths, evaluation.strengths).slice(0, MAX_LIST_ITEMS),
    };
  }

  const completionScore = Math.min(evaluation.completionScore, 3);
  const adherenceScore = Math.min(evaluation.adherenceScore, 2);
  const evidenceScore = Math.min(evaluation.evidenceScore, 3);
  const processScore = Math.min(evaluation.processScore, 2);
  const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
  const approved = false;
  const recommendedAction: AgentRunPilotRecommendedAction = 'continue';

  return {
    ...evaluation,
    completionScore,
    adherenceScore,
    evidenceScore,
    processScore,
    overallScore,
    approved,
    recommendedAction,
    controlAction: derivePilotControlAction({
      recommendedAction,
      approved,
      candidateStatus: params.candidateOutcome.status,
    }),
    confidence: evaluation.confidence === 'high' ? 'medium' : 'low',
    summary: 'Pilot found an unreasonable-scope request that the response followed too literally.',
    rationale: `${evaluation.rationale} ${assessment.reasons.join(' ')} ${responseEvaluation.gaps.join(' ')}`.trim(),
    strengths: mergeUniqueStringLists(evaluation.strengths, responseEvaluation.strengths).slice(0, MAX_LIST_ITEMS),
    gaps: mergeUniqueStringLists(
      evaluation.gaps,
      assessment.reasons,
      responseEvaluation.gaps,
    ).slice(0, MAX_LIST_ITEMS),
    nextActions: mergeUniqueStringLists(
      [
        'Criticize the unreasonable effort or process request explicitly and state the smaller reasonable scope you will handle instead.',
        assessment.narrowedScope || 'Proceed only with the smallest sensible scope that matches the core task.',
      ],
      evaluation.nextActions,
    ).slice(0, MAX_LIST_ITEMS),
    criterionEvaluations: evaluation.criterionEvaluations.map((criterion) => ({
      ...criterion,
      score: Math.min(criterion.score, 3),
      status: criterion.score >= 4 ? 'partial' : criterion.status,
      rationale: 'The response should have challenged the unreasonable scope or process and narrowed the task before proceeding.',
    })),
  };
}

function normalizeCriterionEvaluations(
  value: unknown,
  successCriteria: string[],
): AgentRunPilotCriterionEvaluation[] {
  const rawList = Array.isArray(value) ? value : [];
  const result: AgentRunPilotCriterionEvaluation[] = [];

  for (let index = 0; index < successCriteria.length; index += 1) {
    const rawEntry = rawList[index] as Record<string, unknown> | undefined;
    const criterion = successCriteria[index];
    const score = clampScore(rawEntry?.score, PILOT_DIMENSION_MAX_SCORE);
    const status = normalizeCriterionStatus(rawEntry?.status);
    result.push({
      criterion,
      score,
      maxScore: PILOT_DIMENSION_MAX_SCORE,
      status: rawEntry?.criterion && typeof rawEntry.criterion === 'string' && rawEntry.criterion.trim().length > 0
        ? status
        : status === 'blocked' ? 'blocked' : score >= 4 ? 'met' : score >= 2 ? 'partial' : 'unmet',
      rationale: typeof rawEntry?.rationale === 'string' && rawEntry.rationale.trim().length > 0
        ? rawEntry.rationale.trim()
        : 'No pilot rationale recorded for this criterion.',
    });
  }

  return result;
}

function normalizePilotEvaluation(
  raw: Record<string, unknown> | undefined,
  params: Pick<PilotDecisionParams, 'run' | 'candidateOutcome' | 'evidence' | 'workers'>,
): AgentRunPilotEvaluation {
  if (!raw) {
    throw new Error('Missing pilot evaluation payload.');
  }

  const successCriteria = getSuccessCriteria(params.run);
  const completionScore = clampScore(raw.completionScore, PILOT_DIMENSION_MAX_SCORE);
  const adherenceScore = clampScore(raw.adherenceScore, PILOT_DIMENSION_MAX_SCORE);
  const evidenceScore = clampScore(raw.evidenceScore, PILOT_DIMENSION_MAX_SCORE);
  const processScore = clampScore(raw.processScore, PILOT_DIMENSION_MAX_SCORE);
  const criterionEvaluations = normalizeCriterionEvaluations(raw.criterionEvaluations, successCriteria);
  const overallScore = completionScore + adherenceScore + evidenceScore + processScore;
  const normalizedSignals = normalizePilotDecisionSignals({
    rawRecommendedAction: raw.recommendedAction,
    rawControlAction: raw.controlAction,
    rawApproved: raw.approved,
    overallScore,
    criterionEvaluations,
    candidateStatus: params.candidateOutcome.status,
  });
  const { recommendedAction, controlAction, approved } = normalizedSignals;
  const objective = params.run.plan?.objective?.trim() || params.run.goal.trim() || 'Complete the current task.';
  const summary = typeof raw.summary === 'string' && raw.summary.trim().length > 0
    ? raw.summary.trim()
    : approved
      ? 'Pilot approved finalization.'
      : controlAction === 'cancel'
        ? 'Pilot cancelled further autonomous work.'
      : recommendedAction === 'continue'
        ? 'Pilot found remaining gaps that require more work.'
        : 'Pilot determined the workflow is blocked.';

  const normalizedEvaluation: AgentRunPilotEvaluation = {
    evaluatorVersion: PILOT_EVALUATOR_VERSION,
    evaluatedAt: Date.now(),
    objective,
    completionScore,
    adherenceScore,
    evidenceScore,
    processScore,
    overallScore,
    maxOverallScore: PILOT_TOTAL_MAX_SCORE,
    approvalThreshold: PILOT_APPROVAL_SCORE_THRESHOLD,
    approved,
    recommendedAction,
    controlAction,
    confidence: raw.confidence === 'low' || raw.confidence === 'high' ? raw.confidence : 'medium',
    summary,
    rationale: typeof raw.rationale === 'string' && raw.rationale.trim().length > 0
      ? raw.rationale.trim()
      : summary,
    source: 'provider',
    stateSignature: buildPilotStateSignature({
      run: params.run,
      evidence: params.evidence,
      candidateOutcome: params.candidateOutcome,
      workers: params.workers ?? [],
    }),
    strengths: normalizeStringList(raw.strengths),
    gaps: normalizeStringList(raw.gaps),
    nextActions: normalizeStringList(raw.nextActions),
    criterionEvaluations,
  };

  return applyResearchIntegrityPilotGuardrails(normalizedEvaluation, params);
}

function buildPilotScorecard(evaluation: AgentRunPilotEvaluation): string {
  const metCriteria = evaluation.criterionEvaluations.filter((criterion) => criterion.score >= 4).length;
  const fallbackSuffix = evaluation.source === 'heuristic' || evaluation.evaluatorVersion.includes('heuristic')
    ? ' using heuristic fallback'
    : evaluation.source === 'unavailable' || evaluation.evaluatorVersion.includes('unavailable')
      ? ' because the live pilot assessment was unavailable'
      : '';
  return `Pilot score ${evaluation.overallScore}/${evaluation.maxOverallScore} (threshold ${evaluation.approvalThreshold}) with ${metCriteria}/${evaluation.criterionEvaluations.length} success criteria verified${fallbackSuffix}.`;
}

function countMetPilotCriteria(evaluation: Pick<AgentRunPilotEvaluation, 'criterionEvaluations'>): number {
  return evaluation.criterionEvaluations.filter((criterion) => criterion.score >= 4).length;
}

function hasMaterialPilotImprovement(
  previous: Pick<AgentRunPilotEvaluation, 'approved' | 'recommendedAction' | 'overallScore' | 'evidenceScore' | 'processScore' | 'criterionEvaluations' | 'gaps'>,
  current: Pick<AgentRunPilotEvaluation, 'approved' | 'recommendedAction' | 'overallScore' | 'evidenceScore' | 'processScore' | 'criterionEvaluations' | 'gaps'>,
): boolean {
  return (current.approved && !previous.approved)
    || (current.recommendedAction === 'finalize' && previous.recommendedAction !== 'finalize')
    || current.overallScore > previous.overallScore
    || current.evidenceScore > previous.evidenceScore
    || current.processScore > previous.processScore
    || countMetPilotCriteria(current) > countMetPilotCriteria(previous)
    || current.gaps.length < previous.gaps.length;
}

function resolvePilotContinueCycleBudget(
  params: Pick<PilotDecisionParams, 'run' | 'evidence'>,
): number {
  const assessment = getPilotRequestAssessment(params);
  if (assessment.action === 'direct') {
    return 1;
  }

  return MAX_PILOT_CONTINUE_CYCLES_WITHOUT_IMPROVEMENT;
}

function shouldForceTextOnlyPilotResume(params: Pick<PilotDecisionParams, 'run' | 'evidence' | 'workers' | 'candidateOutcome'>): boolean {
  const workers = params.workers ?? [];
  const assessment = getPilotRequestAssessment(params);
  if (assessment.action !== 'direct') {
    return false;
  }

  if (!hasVerifiedFinalizationEvidence(params.evidence) || workers.length > 0 || params.candidateOutcome.status !== 'completed') {
    return false;
  }

  const responseEvaluation = evaluateResponseAgainstRequestAssessment(assessment, params.evidence.lastNonEmptyAssistantContent.trim(), {
    usedWorkflow: params.run.summary.startedTools > 0
      || params.evidence.toolsUsed.length > 0
      || workers.length > 0,
  });

  return !responseEvaluation.answeredDirectly && !responseEvaluation.askedForClarification;
}

function buildPilotContinuationExhaustionEvaluation(params: {
  evaluation: AgentRunPilotEvaluation;
  priorReviewCount: number;
  candidateStatus: Exclude<AgentRunStatus, 'running'>;
}): AgentRunPilotEvaluation {
  const cycleLabel = params.priorReviewCount === 1 ? 'cycle' : 'cycles';
  return {
    ...params.evaluation,
    approved: false,
    recommendedAction: 'blocked',
    controlAction: params.candidateStatus === 'cancelled' ? 'cancel' : 'block',
    confidence: params.evaluation.confidence === 'high' ? 'medium' : 'low',
    summary: `Pilot stopped autonomous correction after ${params.priorReviewCount} prior review ${cycleLabel} without material improvement.`,
    rationale: `${params.evaluation.rationale} Pilot observed repeated correction cycles without meaningful improvement in score, satisfied criteria, or verified evidence. Continuing would likely repeat the same verification path and burn tokens without adding value.`,
    gaps: mergeUniqueStringLists(
      params.evaluation.gaps,
      ['Repeated pilot correction cycles did not materially improve verification coverage or completion quality.'],
    ).slice(0, MAX_LIST_ITEMS),
    nextActions: [
      'Stop autonomous retries, preserve the current verified findings, and report the remaining blocker or uncertainty instead of re-running the same verification.',
    ],
  };
}

function buildPilotResumePrompt(params: {
  run: Pick<AgentRun, 'goal' | 'plan' | 'checkpoints' | 'evidence'>;
  workers: ReadonlyArray<SubAgentSnapshot>;
  evidence: AgentRunFinalizationEvidence;
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string };
  evaluation: AgentRunPilotEvaluation;
  disableToolsOnResume?: boolean;
}): string {
  const correctionCycle = countPilotReviewCheckpoints(params.run) + 1;
  const priorReviewHistory = getRecentPilotReviewHistory(params.run);
  const criterionLines = params.evaluation.criterionEvaluations.map((criterion) => (
    `- ${criterion.criterion} (${criterion.status}, ${criterion.score}/${criterion.maxScore}): ${criterion.rationale}`
  ));
  const verifiedFindings = params.evidence.resultPreviews
    .slice(-MAX_RESULT_PREVIEWS)
    .map((entry) => `- ${entry.sourceName}: ${truncateText(entry.preview, MAX_RESULT_PREVIEW_CHARS) || entry.preview}`);
  const structuredEvidenceSection = buildAgentRunEvidencePromptSection(params.run.evidence, {
    limit: 10,
    includeContent: true,
    heading: 'Structured workflow evidence:',
  });
  const workerLines = params.workers.length > 0 ? buildWorkerOutcomeLines(params.workers) : [];
  const existingDraftExcerpt = truncateText(
    params.evidence.lastNonEmptyAssistantContent,
    MAX_SYSTEM_PROMPT_EXCERPT_CHARS,
  );

  return [
    '## Pilot Review',
    'Pilot is the governance layer. You are the SuperAgent executor resuming the workflow after pilot review.',
    'Pilot is acting with user-level workflow authority and is instructing you to continue autonomously without waiting for the user.',
    'Continue this existing workflow run from its current state.',
    params.disableToolsOnResume
      ? 'Tool use is disabled for this continuation. Answer from the verified evidence already captured instead of repeating tool work.'
      : undefined,
    `Pilot correction cycle: ${correctionCycle}. This is a continuation of the same workflow run, not a new run.`,
    'Do not restart from scratch, open a replacement run, or discard prior verified work.',
    'Preserve the existing draft/output and extend, correct, or improve only the parts needed to satisfy the review findings.',
    'If the transcript already contains user-visible answer text, treat your next answer as a continuation of that same answer rather than a replacement response.',
    'Append missing evidence, corrections, and richer detail smoothly. Do not emit a fresh standalone answer that supersedes the earlier draft.',
    'If the visible draft already contains section headings, numbering, or bullet groups, continue within that structure instead of starting those sections over.',
    'Do not repeat or paraphrase an already-present section just to improve it; add only the missing clarification, evidence, or correction.',
    'Treat the existing plan, worker outputs, tool results, and verified findings as the baseline state for this turn.',
    'Do not redo unchanged steps solely to recreate context or re-prove already verified work.',
    'Prefer continuing existing work with focused follow-up instructions, targeted verification, draft revision, or additive workers before replacing prior work.',
    'Only replace prior work when it is invalid, contradicted by new evidence, or the approach is clearly exhausted.',
    'Every new action in this turn must close a named pilot gap, improve verification, or strengthen the final deliverable.',
    'If a prior pilot cycle already retried the same verification path without improving the score or satisfied criteria, do not run that same verification again; surface the blocker instead.',
    'This workflow is not approved for final delivery yet.',
    buildPilotScorecard(params.evaluation),
    `Pilot control action: continue. Pilot decision: continue. ${params.evaluation.summary}`,
    'Close the listed gaps, gather stronger verification, and avoid repeating the same failed or weak approach.',
    'Do not produce the final user-facing answer until the success criteria are actually verified.',
    priorReviewHistory.length > 0 ? ['Prior pilot review history:', ...priorReviewHistory].join('\n') : undefined,
    buildSuccessCriteriaSection(params.run),
    ['Pilot criterion review:', ...criterionLines].join('\n'),
    params.evaluation.gaps.length > 0 ? ['Remaining gaps:', ...params.evaluation.gaps.map((gap) => `- ${gap}`)].join('\n') : undefined,
    params.evaluation.nextActions.length > 0 ? ['Required next actions:', ...params.evaluation.nextActions.map((action) => `- ${action}`)].join('\n') : undefined,
    workerLines.length > 0 ? ['Latest worker outcomes:', ...workerLines].join('\n') : undefined,
    verifiedFindings.length > 0 ? ['Verified findings so far:', ...verifiedFindings].join('\n') : undefined,
    structuredEvidenceSection,
    existingDraftExcerpt ? ['Existing user-visible draft/output to continue:', existingDraftExcerpt].join('\n') : undefined,
    `Latest candidate outcome: ${params.candidateOutcome.status}. ${params.candidateOutcome.summary}`,
  ].filter((section): section is string => Boolean(section)).join('\n\n');
}

function buildPilotResumeUserPrompt(params: {
  evidence: AgentRunFinalizationEvidence;
  evaluation: AgentRunPilotEvaluation;
  disableToolsOnResume?: boolean;
}): string {
  const existingDraftExcerpt = truncateText(
    params.evidence.lastNonEmptyAssistantContent,
    MAX_SYSTEM_PROMPT_EXCERPT_CHARS,
  );
  const verifiedFindings = params.evidence.resultPreviews
    .slice(-Math.min(4, MAX_RESULT_PREVIEWS))
    .map((entry) => `- ${entry.sourceName}: ${truncateText(entry.preview, MAX_RESULT_PREVIEW_CHARS) || entry.preview}`);

  return [
    'Continue the already-visible answer for this same user turn.',
    params.disableToolsOnResume
      ? 'Tools are disabled for this continuation. Use only the verified evidence already captured in the workflow.'
      : undefined,
    'Treat the visible answer as fixed baseline content that has already been shown to the user.',
    'Write only the net-new text that should be appended to improve that answer.',
    'Do not restart the answer, do not restate earlier sections, and do not produce a competing standalone response.',
    'If the visible answer already has headings, numbered parts, or bullets, preserve that structure and continue from the first missing idea instead of reintroducing those headings again.',
    'If an existing section needs refinement, append a concise addendum or clarification rather than rewriting the full section.',
    'If an earlier statement needs correction, append a concise update or clarification instead of rewriting the full answer.',
    'Blend the addition naturally so the combined answer reads like one response.',
    existingDraftExcerpt
      ? ['Visible answer already shown to the user (do not repeat it verbatim):', existingDraftExcerpt].join('\n')
      : undefined,
    params.evaluation.gaps.length > 0
      ? ['Open pilot gaps to close with this continuation:', ...params.evaluation.gaps.map((gap) => `- ${gap}`)].join('\n')
      : undefined,
    params.evaluation.nextActions.length > 0
      ? [
          'Append only the material needed to satisfy these required next actions:',
          ...params.evaluation.nextActions.map((action) => `- ${action}`),
        ].join('\n')
      : undefined,
    verifiedFindings.length > 0
      ? ['Verified findings available for the continuation:', ...verifiedFindings].join('\n')
      : undefined,
  ].filter((section): section is string => Boolean(section)).join('\n\n');
}

function resolveFinalOutcomeStatus(
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'> },
  evaluation: AgentRunPilotEvaluation,
): Exclude<AgentRunStatus, 'running'> {
  if (evaluation.controlAction === 'cancel' || candidateOutcome.status === 'cancelled') {
    return 'cancelled';
  }

  // A Pilot block is a deliberate stop condition, not an execution failure.
  // This repo has no dedicated "blocked" terminal status, so map it to the
  // existing non-error stop state.
  if (evaluation.controlAction === 'block') {
    return 'cancelled';
  }

  if (evaluation.controlAction === 'accept' && evaluation.approved) {
    return 'completed';
  }

  if (candidateOutcome.status !== 'completed') {
    return 'failed';
  }

  return evaluation.approved ? 'completed' : 'failed';
}

function buildResumeCheckpointDetail(evaluation: AgentRunPilotEvaluation): string {
  return `${buildPilotScorecard(evaluation)} ${evaluation.summary}`;
}

function buildFinalOutcomeSummary(
  finalStatus: Exclude<AgentRunStatus, 'running'>,
  evaluation: AgentRunPilotEvaluation,
  candidateOutcome: { status: Exclude<AgentRunStatus, 'running'>; summary: string },
): string {
  if (finalStatus === 'completed') {
    return `${buildPilotScorecard(evaluation)} ${evaluation.summary}`;
  }

  if (candidateOutcome.status === 'cancelled') {
    return `${buildPilotScorecard(evaluation)} Workflow cancelled before pilot could approve final delivery.`;
  }

  return `${buildPilotScorecard(evaluation)} ${evaluation.summary}`;
}

function buildPilotDecision(
  params: Omit<PilotDecisionParams, 'providerContext' | 'signal'> & {
    workers: ReadonlyArray<SubAgentSnapshot>;
    evaluation: AgentRunPilotEvaluation;
  },
): AgentRunPilotDecision {
  const priorReviewCount = countPilotReviewCheckpoints(params.run);
  const continueCycleBudget = resolvePilotContinueCycleBudget(params);
  const effectiveEvaluation = params.evaluation.controlAction === 'continue'
    && !params.evaluation.approved
    && !!params.run.latestPilotEvaluation
    && priorReviewCount >= continueCycleBudget
    && !hasMaterialPilotImprovement(params.run.latestPilotEvaluation, params.evaluation)
      ? buildPilotContinuationExhaustionEvaluation({
          evaluation: params.evaluation,
          priorReviewCount,
          candidateStatus: params.candidateOutcome.status,
        })
      : params.evaluation;
  const reviewedCurrentState = hasPilotReviewedCurrentState(
    params.run,
    params.workers,
    params.evidence,
    params.candidateOutcome,
  );
  const shouldResume = effectiveEvaluation.controlAction === 'continue'
    && !effectiveEvaluation.approved
    && !reviewedCurrentState;
  const disableToolsOnResume = shouldResume
    ? shouldForceTextOnlyPilotResume({
        run: params.run,
        workers: params.workers,
        evidence: params.evidence,
        candidateOutcome: params.candidateOutcome,
      })
    : false;

  if (shouldResume) {
    const checkpointDetail = buildResumeCheckpointDetail(effectiveEvaluation);
    return {
      action: 'resume',
      outcome: params.candidateOutcome,
      checkpointTitle: PILOT_REVIEW_CHECKPOINT_TITLE,
      checkpointDetail,
      reviewPrompt: buildPilotResumePrompt({
        run: params.run,
        workers: params.workers,
        evidence: params.evidence,
        candidateOutcome: params.candidateOutcome,
        evaluation: effectiveEvaluation,
        disableToolsOnResume,
      }),
      reviewUserPrompt: buildPilotResumeUserPrompt({
        evidence: params.evidence,
        evaluation: effectiveEvaluation,
        disableToolsOnResume,
      }),
      disableToolsOnResume,
      evaluation: effectiveEvaluation,
    };
  }

  const finalStatus = resolveFinalOutcomeStatus(params.candidateOutcome, effectiveEvaluation);
  const checkpointTitle = effectiveEvaluation.controlAction === 'block'
    ? 'Pilot blocked finalization'
    : finalStatus === 'completed'
    ? 'Pilot approved finalization'
    : finalStatus === 'cancelled'
      ? 'Pilot cancelled workflow'
    : effectiveEvaluation.recommendedAction === 'blocked'
      ? 'Pilot blocked finalization'
      : 'Pilot finalized with remaining gaps';
  const checkpointDetail = buildFinalOutcomeSummary(finalStatus, effectiveEvaluation, params.candidateOutcome);

  return {
    action: 'finalize',
    outcome: {
      status: finalStatus,
      summary: checkpointDetail,
    },
    checkpointTitle,
    checkpointDetail,
    evaluation: effectiveEvaluation,
  };
}

export function decideAgentRunPilotAfterBackgroundWorkers(params: {
  run: Pick<AgentRun, 'goal' | 'plan' | 'checkpoints' | 'updatedAt' | 'summary' | 'latestPilotEvaluation' | 'evidence'>;
  workers: ReadonlyArray<SubAgentSnapshot>;
  evidence: AgentRunFinalizationEvidence;
}): AgentRunPilotDecision {
  const candidateOutcome = summarizeBackgroundWorkerRunOutcome([...params.workers]);
  const evaluation = applyRequestAssessmentPilotGuardrails(buildHeuristicPilotEvaluation({
    run: params.run,
    workers: params.workers,
    evidence: params.evidence,
    candidateOutcome,
  }), {
    run: params.run,
    workers: params.workers,
    evidence: params.evidence,
    candidateOutcome,
  });

  return buildPilotDecision({
    run: params.run,
    workers: params.workers,
    evidence: params.evidence,
    candidateOutcome,
    evaluation,
  });
}

export async function evaluateAgentRunWithPilot(
  params: PilotDecisionParams,
): Promise<AgentRunPilotDecision> {
  const workers = params.workers ?? [];
  const cachedPilotEvaluation = params.run.latestPilotEvaluation;
  const reviewedCurrentState = hasPilotReviewedCurrentState(
    params.run,
    workers,
    params.evidence,
    params.candidateOutcome,
  );

  if (shouldReuseCachedPilotEvaluation({
    latestPilotEvaluation: cachedPilotEvaluation,
    reviewedCurrentState,
    hasProviderContext: !!params.providerContext,
  })) {
    return buildPilotDecision({
      run: params.run,
      workers,
      evidence: params.evidence,
      candidateOutcome: params.candidateOutcome,
      evaluation: cachedPilotEvaluation!,
    });
  }

  let evaluation: AgentRunPilotEvaluation | undefined;
  let unavailableReason: AgentRunPilotFallbackReason | undefined;
  let unavailableDetail: string | undefined;

  if (params.providerContext) {
    throwIfAbortSignalTriggered(params.signal);

    try {
      const pilotResult = await invokePilotEvaluator({
        run: params.run,
        evidence: params.evidence,
        candidateOutcome: params.candidateOutcome,
        workers,
        providerContext: params.providerContext,
        signal: params.signal,
        onUsage: params.onUsage,
      });

      throwIfAbortSignalTriggered(params.signal);

      if (pilotResult.payload) {
        evaluation = normalizePilotEvaluation(pilotResult.payload, {
          run: params.run,
          candidateOutcome: params.candidateOutcome,
          evidence: params.evidence,
          workers,
        });
      } else {
        unavailableReason = pilotResult.failure?.reason ?? 'response_unparseable';
        unavailableDetail = pilotResult.failure?.detail;
      }
    } catch (error) {
      if (isAbortErrorLike(error, params.signal)) {
        throw error;
      }

      unavailableReason = 'request_failed';
      unavailableDetail = error instanceof Error ? error.message : String(error);
    }
  }

  const fallbackReason = unavailableReason ?? 'no_provider_context';
  const fallbackEvaluation = params.providerContext && fallbackReason !== 'no_provider_context'
    ? buildLivePilotUnavailableFallbackEvaluation({
        run: params.run,
        workers,
        evidence: params.evidence,
        candidateOutcome: params.candidateOutcome,
        reason: fallbackReason,
        providerContext: params.providerContext,
        detail: unavailableDetail,
      })
    : buildPilotUnavailableEvaluation({
        run: params.run,
        workers,
        evidence: params.evidence,
        candidateOutcome: params.candidateOutcome,
        reason: fallbackReason,
        providerContext: params.providerContext,
        detail: unavailableDetail,
      });

  return buildPilotDecision({
    run: params.run,
    workers,
    evidence: params.evidence,
    candidateOutcome: params.candidateOutcome,
    evaluation: applyRequestAssessmentPilotGuardrails(evaluation ?? fallbackEvaluation, {
      run: params.run,
      workers,
      evidence: params.evidence,
      candidateOutcome: params.candidateOutcome,
    }),
  });
}