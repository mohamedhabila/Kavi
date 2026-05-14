// ---------------------------------------------------------------------------
// Kavi — Orchestrator Engine
// ---------------------------------------------------------------------------
// Manages the agentic loop: sends messages to LLM, handles tool calls,
// iterates until the model produces a final text response or hits limits.
// Integrates: MCP, Skills, Context Compaction, Loop Detection, Failover,
// Thinking, Memory, Events, Slash Commands, Personas.

import { LlmService } from '../services/llm/LlmService';
import { looksLikeGeminiProvider } from '../constants/api';
import { isOnDeviceLlmProvider, supportsOnDeviceLlmTools } from '../services/localLlm/runtime';
import { buildToolDefinitions } from './tools/definitions';
import { executeTool, normalizeToolName } from './tools/index';
import {
  selectToolsForRequest,
  detectRelevantCategories,
  buildDeferredToolCatalog,
  estimateAllToolTokens,
  compressToolDescription,
  resolveToolProviderFamily,
  ON_DEVICE_TOOL_TOKEN_BUDGET,
} from './tools/toolManager';
import {
  filterToolsByRuntimeAvailability,
  getRuntimeToolAvailabilityContext,
  resolveRuntimeFallbackToolName,
} from './tools/runtimeAvailability';
import {
  applyTrackedAsyncToolResult,
  buildPendingAsyncOperationJoinNote,
  clonePendingTrackedAsyncOperations,
  getPendingTrackedAsyncOperations,
  getPendingTrackedAsyncOperationToolNames,
  TrackedAsyncOperation,
} from './pendingAsyncOperations';
import { enforceContextBudget, inspectContextBudget } from '../services/context/budgetManager';
import {
  Attachment,
  AssistantCompletionMetadata,
  AssistantMessageMetadata,
  AgentRunAsyncOperation,
  Message,
  MessageProviderReplay,
  ToolCall,
  ToolDefinition,
  LlmProviderConfig,
  OrchestratorState,
  TokenUsage,
} from '../types';
import { buildAssistantMessageMetadata } from '../utils/assistantMessageMetadata';
import { createLogger } from '../utils/logger';
import {
  PYTHON_EXTENSION_EXAMPLES,
  PYTHON_EXTENSION_POLICY,
  PYTHON_EXTENSION_WHEN_NEEDED,
} from '../services/python/guidance';

// ── Integrations ─────────────────────────────────────────────────────────
import { runLinkUnderstanding } from '../services/links/service';
import { runMediaUnderstanding } from '../services/media/service';
import { buildImageAttachmentDataUri } from '../services/media/attachmentPayloads';
import {
  detectLoops,
  shouldBlockToolCall,
  recordToolCall,
  hashResult,
  ToolCallRecord,
} from './loopDetection';
import {
  enforceToolResultBudget,
  compactToolResults,
  isApproachingContextOverflow,
} from './toolResultGuard';
import { ensureToolResultPairing, deduplicateToolResults } from './toolResultPairingGuard';
import {
  buildFailoverChain,
  createFailoverState,
  getNextAvailableModel,
  recordFailure,
  recordSuccess,
  FailoverState,
} from './failover';
import { getThinkingParams, ThinkingLevel } from './thinking';
import { DefaultContextEngine, clearOldToolResults } from '../services/context/compaction';
import type {
  CompactResult,
  CompactionTier,
  ForcedCompactionTier,
} from '../services/context/types';
import {
  estimateTokens,
  estimateMessageTokens,
  getCompactionWorkingContextWindow,
  getCompactionThresholds,
  getWorkingContextWindow,
} from '../services/context/tokenCounter';
import {
  buildPromptCachingPlan,
  getEscalatedFinalizationMaxTokens,
  planIterationModel,
  ResponseBudgetProfile,
  resolveFinalizationMaxTokens,
  resolveSubAgentMaxTokens,
} from '../services/context/tokenOptimization';
import {
  buildLivingMemorySections,
  type LivingMemoryBridgeOutput,
} from '../services/memory/livingMemoryBridge';
import { canReadLongTermMemory } from '../services/memory/policy';
import { useSettingsStore } from '../store/useSettingsStore';
import { mcpManager } from '../services/mcp/manager';
import {
  getAllLoadedSkills,
  getSkillToolDefinitions,
  getSkillSystemPrompts,
  filterToolsByInvocationPolicy,
} from '../services/skills/manager';
import { isSlashCommand, parseCommand } from '../services/commands/parser';
import { getCommand } from '../services/commands/builtins';
import { emitSessionEvent, emitAgentEvent } from '../services/events/bus';
import { recordUsage } from '../services/usage/tracker';
import { getProviderApiKey } from '../services/storage/SecureStorage';
import {
  resolvePersonaSystemPrompt,
  resolvePersonaModel,
  AgentPersona,
  SUPER_AGENT_PERSONA_ID,
} from '../services/agents/personas';
import { getPersona } from '../services/agents/registry';
import { assessUserRequest, type RequestAssessment } from '../services/agents/requestAssessment';
import { resolveProviderModelSelection } from '../services/llm/providerSupport';
import { isContextOverflowProviderError } from '../services/llm/requestErrors';
import { hasObservedDelegatedWork } from '../services/agents/delegationEvidence';
import {
  buildIncompleteTextContinuationNote,
  isResumableIncompleteTextCompletion,
  isTokenBudgetExhaustedCompletion,
  MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES,
} from '../services/llm/completionRecovery';
import { findMatchingToolCallIndexWithinMessage } from '../utils/toolCallMatching';
import {
  filterModelVisibleAttachments,
  hasModelVisibleAttachments,
} from '../utils/messageAttachments';

export const MAX_TOOL_ITERATIONS = 25;
export const MAX_TOOL_ITERATIONS_SUPERAGENT = 40;
export const MAX_IDENTICAL_TOOL_CALLS = 3;
const MAX_INCOMPLETE_TOOL_PLANNING_RETRIES = 2;
const MAX_PROVIDER_OVERFLOW_RETRIES = 1;
const MIN_PROVIDER_OVERFLOW_RETRY_MAX_TOKENS = 1024;
const logger = createLogger('Orchestrator');

type ForcedTextTurnReason =
  | 'incomplete_delivery_continuation'
  | 'loop_recovery'
  | 'request_governance'
  | 'yield_finalization';

type SystemPromptSection = {
  text: string;
  cacheable?: boolean;
};

export interface OrchestratorCompactionEvent {
  notice: string;
  messages: Message[];
  tier: Exclude<CompactionTier, 'none'>;
  tokensBefore?: number;
  tokensAfter?: number;
}

export interface OrchestratorCallbacks {
  onStateChange: (state: OrchestratorState) => void;
  onToken: (token: string) => void;
  onReasoning?: (token: string) => void;
  onAssistantStreamReset?: () => void;
  onUserMessageEnriched?: (messageId: string, enrichedContent: string) => void;
  onToolCallQueued?: (toolCall: ToolCall) => void;
  onToolCallStart: (toolCall: ToolCall) => void;
  onToolCallComplete: (toolCall: ToolCall) => void;
  onPendingAsyncOperationsChange?: (operations: TrackedAsyncOperation[]) => void;
  onAssistantMessage: (
    content: string,
    toolCalls?: ToolCall[],
    providerReplay?: MessageProviderReplay,
    assistantCompletion?: AssistantMessageMetadata,
  ) => void;
  onToolMessage: (toolCallId: string, result: string) => void;
  onError: (error: Error) => void;
  onUsage?: (usage: TokenUsage) => void;
  onDone: () => void;
  onCommandResult?: (result: { response?: string; action?: string }) => void;
  onCompaction?: (event: OrchestratorCompactionEvent) => void;
}

export interface OrchestratorOptions {
  provider: LlmProviderConfig;
  model: string;
  allowModelDowngrade?: boolean;
  conversationId: string;
  usageConversationId?: string;
  workspaceConversationId?: string;
  workspaceReadFallbackConversationId?: string;
  systemPrompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortController;
  thinkingLevel?: ThinkingLevel;
  personaId?: string;
  allProviders?: LlmProviderConfig[];
  enableCompaction?: boolean;
  enableFailover?: boolean;
  linkUnderstandingEnabled?: boolean;
  mediaUnderstandingEnabled?: boolean;
  maxLinks?: number;
  /** Optional filter — return false to block a tool from executing (sub-agent sandbox). */
  toolFilter?: (toolName: string) => boolean;
  /** Preferred tool names to force into the active set (used by sub-agents to inherit parent tool selection). */
  preferredTools?: string[];
  /** Count of trailing user-role control prompts injected by the app that should not drive request assessment or tool selection. */
  internalUserMessageCount?: number;
  /** Optional response-budget tuning for specialized agent flows such as sub-agents. */
  responseBudgetProfile?: ResponseBudgetProfile;
  initialPendingAsyncOperations?: AgentRunAsyncOperation[];
}

function getRequestContextUserMessages(
  messages: Message[],
  internalUserMessageCount = 0,
): Message[] {
  const userMessages = messages.filter((message) => message.role === 'user');
  const normalizedInternalUserMessageCount = Number.isFinite(internalUserMessageCount)
    ? Math.max(0, Math.floor(internalUserMessageCount))
    : 0;

  if (
    normalizedInternalUserMessageCount <= 0 ||
    userMessages.length <= normalizedInternalUserMessageCount
  ) {
    return userMessages;
  }

  return userMessages.slice(0, userMessages.length - normalizedInternalUserMessageCount);
}

function upsertPendingToolCall(
  pendingToolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
    raw?: Record<string, any>;
  }>,
  nextToolCall: { id: string; name: string; arguments: string; raw?: Record<string, any> },
): { id: string; name: string; arguments: string; raw?: Record<string, any> } {
  const normalizedName = normalizeToolName(nextToolCall.name);
  const rawToolCall =
    nextToolCall.raw && typeof nextToolCall.raw === 'object' && !Array.isArray(nextToolCall.raw)
      ? nextToolCall.raw
      : undefined;
  const rawFunction =
    rawToolCall?.function &&
    typeof rawToolCall.function === 'object' &&
    !Array.isArray(rawToolCall.function)
      ? rawToolCall.function
      : undefined;
  const normalizedToolCall = {
    ...nextToolCall,
    name: normalizedName,
    ...(rawToolCall
      ? {
          raw: {
            ...rawToolCall,
            function: {
              ...(rawFunction || {}),
              name: normalizedName,
              arguments:
                typeof rawFunction?.arguments === 'string'
                  ? rawFunction.arguments
                  : nextToolCall.arguments,
            },
          },
        }
      : {}),
  };
  const existingIndex = findMatchingToolCallIndexWithinMessage(
    pendingToolCalls,
    normalizedToolCall,
  );
  const existingToolCall = existingIndex >= 0 ? pendingToolCalls[existingIndex] : undefined;
  const mergedToolCall = {
    ...existingToolCall,
    ...normalizedToolCall,
    raw: normalizedToolCall.raw ?? existingToolCall?.raw,
  };

  if (existingIndex >= 0) {
    pendingToolCalls[existingIndex] = mergedToolCall;
  } else {
    pendingToolCalls.push(mergedToolCall);
  }

  return mergedToolCall;
}

function applyResolvedToolName(
  toolCall: { id: string; name: string; arguments: string; raw?: Record<string, any> },
  resolvedName: string,
): { id: string; name: string; arguments: string; raw?: Record<string, any> } {
  if (resolvedName === toolCall.name) {
    return toolCall;
  }

  const rawToolCall =
    toolCall.raw && typeof toolCall.raw === 'object' && !Array.isArray(toolCall.raw)
      ? toolCall.raw
      : undefined;
  const rawFunction =
    rawToolCall?.function &&
    typeof rawToolCall.function === 'object' &&
    !Array.isArray(rawToolCall.function)
      ? rawToolCall.function
      : undefined;

  return {
    ...toolCall,
    name: resolvedName,
    ...(rawToolCall
      ? {
          raw: {
            ...rawToolCall,
            function: {
              ...(rawFunction || {}),
              name: resolvedName,
              arguments:
                typeof rawFunction?.arguments === 'string'
                  ? rawFunction.arguments
                  : toolCall.arguments,
            },
          },
        }
      : {}),
  };
}

async function yieldToUiFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function formatUtcOffset(offsetMinutesWestOfUtc: number): string {
  const totalMinutes = -offsetMinutesWestOfUtc;
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absoluteMinutes / 60)
    .toString()
    .padStart(2, '0');
  const minutes = (absoluteMinutes % 60).toString().padStart(2, '0');
  return `UTC${sign}${hours}:${minutes}`;
}

function buildRuntimePromptSection(): string {
  return `## Runtime
Platform: mobile (React Native / Expo). Channel: mobile-app.
The active user turn may include a <runtime_context> block with the authoritative request timestamp and timezone.
If that block is present, treat it as authoritative for time-sensitive reasoning in this request.
In every analysis, consider timing, recency, deadlines, and whether the task needs up-to-date data.
When freshness matters, verify with tools or live data instead of relying on stale assumptions or model memory.`;
}

function buildRuntimeContextNote(now: Date = new Date()): string {
  const currentTimeIso = now.toISOString();

  return `<runtime_context>
request_timestamp_utc: ${currentTimeIso}
device_local_timezone_offset: ${formatUtcOffset(now.getTimezoneOffset())}
Treat this runtime context as authoritative for time-sensitive reasoning in this request.
</runtime_context>`;
}

function stripRuntimeContextFromUserContent(content: string | undefined): string {
  if (typeof content !== 'string') {
    return '';
  }

  return content
    .replace(/\s*<runtime_context>[\s\S]*?<\/runtime_context>\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getUserMessagePromptContent(
  message: Pick<Message, 'content' | 'enrichedContent'>,
): string {
  const sanitizedEnrichedContent = stripRuntimeContextFromUserContent(message.enrichedContent);
  if (sanitizedEnrichedContent.length > 0) {
    return sanitizedEnrichedContent;
  }

  return stripRuntimeContextFromUserContent(message.content);
}

function appendRuntimeContextToUserContent(content: string, runtimeContext: string): string {
  const strippedContent = stripRuntimeContextFromUserContent(content);
  return strippedContent.length > 0 ? `${strippedContent}\n\n${runtimeContext}` : runtimeContext;
}

function appendSystemPromptSection(
  sections: SystemPromptSection[],
  text: string | null | undefined,
  options: { cacheable?: boolean } = {},
): void {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return;
  }

  sections.push({
    text,
    ...(options.cacheable ? { cacheable: true } : {}),
  });
}

function orderSystemPromptSectionsForCaching(
  sections: SystemPromptSection[],
): SystemPromptSection[] {
  if (sections.length <= 1) {
    return sections;
  }

  const cacheableSections: SystemPromptSection[] = [];
  const dynamicSections: SystemPromptSection[] = [];

  for (const section of sections) {
    if (section.cacheable) {
      cacheableSections.push(section);
      continue;
    }

    dynamicSections.push(section);
  }

  if (cacheableSections.length === 0 || dynamicSections.length === 0) {
    return sections;
  }

  // Keep the reusable prefix byte-stable across providers by moving all
  // volatile sections behind the cacheable prefix boundary.
  return [...cacheableSections, ...dynamicSections];
}

function joinSystemPromptSections(sections: SystemPromptSection[]): string {
  return sections.map((section) => section.text).join('\n\n');
}

function buildRequestGovernancePromptSection(
  assessment: RequestAssessment | undefined,
): string | undefined {
  if (!assessment || assessment.action === 'proceed') {
    return undefined;
  }

  const reasonLines = assessment.reasons.map((reason) => `- ${reason}`);

  if (assessment.action === 'clarify') {
    return [
      '## Request Governance',
      assessment.summary,
      ...reasonLines,
      'Stop before planning, delegation, or tool use.',
      'Do not invent missing requirements or guess the user objective.',
      'Reply with one concise clarification request that tells the user exactly what is missing.',
    ].join('\n');
  }

  if (assessment.action === 'direct') {
    return [
      '## Request Governance',
      assessment.summary,
      ...reasonLines,
      'Do not plan, do not delegate, and do not create a multi-agent workflow for this request.',
      'If a single focused tool call can answer the question with up-to-date data, use that tool once and then answer directly.',
      'If essential context like location is missing, ask one concise clarification question instead of starting workflow work.',
    ].join('\n');
  }

  return [
    '## Request Governance',
    assessment.summary,
    ...reasonLines,
    'Do not follow the unreasonable part of the request blindly.',
    'Criticize the mismatch explicitly, state the narrower reasonable scope you will actually handle, and proceed only with that reduced scope.',
    assessment.narrowedScope ? `Reasonable scope: ${assessment.narrowedScope}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

// ── System prompt assembly ───────────────────────────────────────────────

function buildSystemPromptSections(
  systemPrompt: string,
  conversationMemory: string | null,
  globalMemory: string | null,
  skillsPrompt?: string,
  deferredToolCatalog?: string,
  toolSummaries?: string,
  canvasWorkflowPrompt?: string,
  expoWorkflowPrompt?: string,
  capabilityDiscoveryPrompt?: string,
  isSuperAgent?: boolean,
  toolingEnabled = true,
): SystemPromptSection[] {
  const prompt =
    systemPrompt || 'You are a personal AI assistant running inside Kavi on a mobile device.';
  const normalizedSkillsPrompt = typeof skillsPrompt === 'string' ? skillsPrompt : '';
  const sections: SystemPromptSection[] = [];

  const toolSection = toolSummaries
    ? `## Tooling\nTool availability (filtered by policy). Tool names are case-sensitive.\n${toolSummaries}`
    : '';

  const toolCallStyleSection = `## Tool Call Style
Default: call routine, low-risk tools without narration.
Narrate only for multi-step work, sensitive actions, or when the user explicitly asks.
When a first-class tool exists, use it instead of asking the user to run equivalent CLI or slash commands.
${PYTHON_EXTENSION_WHEN_NEEDED}
${PYTHON_EXTENSION_POLICY}
For normal Q&A, explanations, brainstorming, or summaries, answer directly. Do not create files, canvases, or other artifacts unless the user asked for a concrete deliverable, preview, persistence, or export.
Do not create a canvas for ordinary conversational answers.
If the user's intent is clear, act first and ask only when ambiguity blocks safe execution.
For engineering/debugging work, use inspect -> act -> verify and keep taking the next best step until the task is complete.
When modifying an existing workspace file, read it first and prefer file_edit with ordered focused edits; reserve write_file for new files or intentional whole-file replacements.
Prefer one tool call at a time when choosing a direction. Only issue multiple tool calls together when they are clearly independent read-only lookups that can run in parallel.
When a tool reports in-progress work, keep monitoring with the relevant status or wait tools until you reach a terminal result or a concrete blocker.
If repository inspection tools show the current conversation workspace is empty or a search returns no matches, do not repeat list_files or glob_search with the same arguments. Reuse the result, state the limitation clearly, and move on.
If a tool fails, do not retry the same call blindly. Analyze the error, switch approach, and after 2 identical failures explain the blocker.
If you see [SYSTEM WARNING], stop the current approach immediately.`;

  const textOnlyLocalSection = toolingEnabled
    ? ''
    : `## Current Execution Limits
You are running through Kavi's current on-device local runtime for this request.
No tools are registered with the model and no tool execution loop is available here.
If other instructions mention tools, skills, sessions, delegation, or workflow automation, ignore those instructions for this request.
Do not emit tool calls, function-call blocks, or Gemma tool fences such as <|tool_call>...<tool_call|>.
Answer directly from the visible conversation context only.
If the user asks for file access, browsing, device actions, or any other tool-driven work, state that the current on-device mode in this build cannot execute tools and continue with the best direct text answer you can provide.`;

  const agentModeSection = isSuperAgent
    ? `## Agent Mode (ACTIVE — applies to EVERY user message)
You are operating in Agent mode. The user explicitly chose this mode to see multi-agent orchestration.
OVERRIDE the "answer directly" guidance above — instead, follow the SuperAgent execution protocol at the top of this system prompt.
Available orchestration tools: sessions_spawn, sessions_status, sessions_wait, sessions_output, sessions_surface_output, sessions_list, sessions_send, sessions_history, sessions_cancel, sessions_yield, wait.
Workflow: present your plan → use sessions_spawn to delegate → use sessions_wait when you need worker output before proceeding and sessions_status when you need live inspection → treat completed sessions_wait results as already containing the same outputs that sessions_output would return, use sessions_output only when you need to fetch or recall a terminal worker deliverable without waiting, use sessions_surface_output when that deliverable should become the visible user answer directly, and use sessions_history only when you need transcript or reasoning trace → use sessions_cancel plus a refined re-spawn when a worker drifts → synthesize results.
Only launch multiple sessions_spawn calls together when every worker is independent at launch time. Never launch workers together when one depends on another worker in the same batch or on unfinished prerequisite work.
When a structured plan exists, pass workstreamId on each plan-linked sessions_spawn call so the runtime can enforce dependency order. Use dependsOnWorkstreams only for ad hoc workers that must wait on prior work.
For non-trivial tasks, prefer spawning at least 1 sub-agent rather than answering directly.
Exception: trivial single-fact lookups and short live-information questions (for example time, weather, or a one-shot current-status check) should bypass delegation. Handle those directly, optionally with one focused tool call, and do not create a multi-agent plan.
If the current user input is low-signal or underspecified, stop the workflow immediately, do not plan, do not delegate, and ask for clarification instead.
If the user asks for unreasonable effort, worker count, or process for a simple task, criticize that mismatch explicitly and switch to the smallest reasonable scope instead of obeying it literally.
Do not duplicate substantive work. If a direct tool pass already closed the task or a workstream, use that result and move to final delivery or the next named gap instead of launching a worker to repeat the same research, verification, or summary.
Do not delegate merely for ceremony. If direct tool work already completed the substantive task or closed the remaining named gaps, finalize directly. Delegate only when a named remaining gap benefits from worker execution or the user explicitly requires delegated execution.

CRITICAL: Apply this protocol to EVERY new user message in this conversation, not just the first one.
Do NOT shortcut the agentic flow just because you handled previous requests with sub-agents.
Each new user request deserves its own Assess → Plan → Spawn → Monitor → Synthesize cycle.
When spawning sub-agents, pass a focused 'tools' array in sessions_spawn so the sub-agent has access to the specific tools it needs for its task (e.g., ['web_search', 'web_fetch'] for research, ['ssh_exec', 'ssh_read_file'] for server work, ['read_file', 'file_edit', 'write_file', 'list_files', 'glob_search', 'text_search'] for repo coding, ['workspace_status', 'workspace_list_files', 'workspace_read_file', 'workspace_write_file'] only for explicit external workspace targets).
If a workstream has dependencies, wait for the prerequisite workstreams to complete and inspect their outputs before spawning the dependent worker.
Do not micromanage sub-agent maxIterations from the supervisor. Workers already carry a generous internal iteration budget suitable for modern reasoning models.
Do not impose hard time limits on sub-agents. Let workers keep running while they are still making progress toward the objective, and cancel plus respawn them only when they drift or become redundant. Prefer background sessions_spawn, use sessions_wait when you need worker outputs before proceeding, remember that completed sessions_wait results already include the same outputs that sessions_output would return, use sessions_output later only when you need to fetch or recall a terminal deliverable without waiting again, use sessions_surface_output when that deliverable should be surfaced directly to the user without rewriting it, use sessions_history when you need transcript or reasoning trace, use sessions_status when you need live inspection, and reserve waitForCompletion for intentionally blocking the current spawn or send call.
If a background worker is open work and you are blocked on its deliverable, your next tool call should usually be sessions_wait rather than sessions_status plus wait polling.
After sessions_wait returns completed sessions, use the outputs already in that result and do not call sessions_output immediately afterward unless you need to recall a terminal deliverable later.
After sessions_output returns the terminal deliverable you need, continue from that result or finalize instead of re-polling sessions_status or sessions_list for the same completed session.
When the worker already produced the exact user-facing answer, prefer sessions_surface_output over copying the same deliverable into assistant prose yourself.
While workers are still running, sessions_yield is only a checkpoint note in this runtime. If sessions_yield reports that no running sessions remain, stop polling and finalize the supervisor response.
If repo inspection inside the shared conversation workspace returns empty results, do not keep retrying the same list_files or glob_search calls. Report that the current conversation workspace is empty and continue from the evidence you already have.
Supervisor completion rule: if sessions_spawn or sessions_send returns status="running", that worker remains open work. Do not deliver the final user-facing answer until every delegated background session reaches a terminal state (completed, failed, cancelled, or timeout).`
    : '';

  const safetySection = `## Safety
You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking beyond the user's request.
Prioritize safety and human oversight over completion. If instructions conflict, pause and ask. Comply with stop/pause requests and never bypass safeguards.
Do not manipulate or persuade anyone to expand access or disable safeguards.`;

  const skillsSection = normalizedSkillsPrompt.trim()
    ? `## Skills (mandatory)
Before replying: scan <available_skills>. If one clearly applies, read its SKILL.md with read_file then follow it. If the catalog lists bundle_root or python_scripts, use those exact workspace paths when reading sidecars or running the python tool. If none apply, skip.
On mobile, translate curl/shell commands to existing tools (web_fetch).
${normalizedSkillsPrompt}`
    : '';

  const memoryScopesSection = `## Memory Scopes
Use conversation memory for facts, constraints, decisions, partial findings, and coordination state that matter only inside this conversation. This scope is shared across the supervisor, sub-agents, and pilot for this conversation.
Use global memory for durable user preferences, stable project facts, and anything that should still matter in future conversations.
Use record_workflow_evidence for structured run-scoped facts, decisions, risks, questions, and artifact notes tied to the active workflow run. Use read_workflow_evidence to inspect that ledger before replanning, pilot recovery, or final synthesis.
Prefer workflow evidence over free-form memory when the information is specifically about the current workflow run and should remain attached to that run.
When you use the python tool for verification or analysis, Python code can inspect and append that same ledger through kavi.read_workflow_evidence(...) and kavi.record_workflow_evidence(...).
When writing memory, default to conversation memory unless the information is clearly reusable beyond this conversation.
When reading memory, use read_memory or memory_search with scope="all" when you need the full picture, or specify scope="conversation" or scope="global" when you only need one layer.`;

  const conversationMemorySection = conversationMemory
    ? `<conversation_memory>
${conversationMemory}
</conversation_memory>`
    : '';

  const globalMemorySection = globalMemory
    ? `<global_memory>
${globalMemory}
</global_memory>`
    : '';

  appendSystemPromptSection(sections, prompt, { cacheable: true });
  appendSystemPromptSection(sections, buildRuntimePromptSection(), { cacheable: true });
  appendSystemPromptSection(sections, toolSection);
  appendSystemPromptSection(
    sections,
    toolingEnabled ? toolCallStyleSection : textOnlyLocalSection,
    { cacheable: true },
  );
  appendSystemPromptSection(sections, toolingEnabled ? agentModeSection : '', { cacheable: true });
  appendSystemPromptSection(sections, canvasWorkflowPrompt);
  appendSystemPromptSection(sections, expoWorkflowPrompt);
  appendSystemPromptSection(sections, capabilityDiscoveryPrompt);
  appendSystemPromptSection(sections, safetySection, { cacheable: true });
  appendSystemPromptSection(sections, toolingEnabled ? skillsSection : '');
  appendSystemPromptSection(sections, toolingEnabled ? memoryScopesSection : '', {
    cacheable: true,
  });
  appendSystemPromptSection(sections, conversationMemorySection);
  appendSystemPromptSection(sections, globalMemorySection);
  appendSystemPromptSection(sections, deferredToolCatalog);
  return orderSystemPromptSectionsForCaching(sections);
}

function buildSystemPromptWithMemory(
  systemPrompt: string,
  conversationMemory: string | null,
  globalMemory: string | null,
  skillsPrompt?: string,
  deferredToolCatalog?: string,
  toolSummaries?: string,
  canvasWorkflowPrompt?: string,
  expoWorkflowPrompt?: string,
  capabilityDiscoveryPrompt?: string,
  isSuperAgent?: boolean,
): string {
  return joinSystemPromptSections(
    buildSystemPromptSections(
      systemPrompt,
      conversationMemory,
      globalMemory,
      skillsPrompt,
      deferredToolCatalog,
      toolSummaries,
      canvasWorkflowPrompt,
      expoWorkflowPrompt,
      capabilityDiscoveryPrompt,
      isSuperAgent,
    ),
  );
}

function buildExpoWorkflowPrompt(
  selectedTools: ToolDefinition[],
  relevantCategories: Set<string>,
): string {
  const hasLoadedExpoTools = selectedTools.some((tool) => tool.name.startsWith('expo_eas_'));
  const hasRelevantExpoTools =
    relevantCategories.has('expo') ||
    relevantCategories.has('expo_manual_actions') ||
    hasLoadedExpoTools;

  if (!hasRelevantExpoTools || !hasLoadedExpoTools) {
    return '';
  }

  return `## Expo / EAS
For GitHub-linked Expo projects, default to repository-driven EAS Workflows instead of manual Expo action tools.
Preferred flow: inspect or edit the repository, ensure .eas/workflows/deploy.yml or another required .eas/workflows/*.yml file exists on the target branch, push a commit, then monitor the automatically triggered run with expo_eas_workflow_runs, expo_eas_workflow_status, or expo_eas_workflow_wait.
Call expo_eas_list_projects once to discover project ids, then reuse the returned id/fullName in expo_eas_status or expo_eas_probe. Do not repeat expo_eas_list_projects with the same arguments unless you intentionally need refresh=true or switched accounts.
Use expo_eas_status and expo_eas_probe to verify the repo link, workflow file, and branch readiness before waiting on runs.
Reserve expo_eas_build, expo_eas_update, expo_eas_submit, and expo_eas_deploy_web for explicit manual reruns, backfills, or cases where commit-triggered automation is unavailable.
When authoring custom EAS workflows, prefer the built-in EAS steps such as eas/checkout and eas/install_node_modules before build commands, and fix the repository or workflow so the next commit passes.`;
}

function buildCanvasWorkflowPrompt(
  selectedTools: ToolDefinition[],
  relevantCategories: Set<string>,
): string {
  const hasLoadedCanvasTools = selectedTools.some((tool) => tool.name.startsWith('canvas_'));
  const hasRelevantCanvasTools = relevantCategories.has('canvas') || hasLoadedCanvasTools;

  if (!hasRelevantCanvasTools || !hasLoadedCanvasTools) {
    return '';
  }

  return `## Canvas (Interactive Preview)
For HTML/UI artifacts, call canvas_create for new surfaces. When editing an existing surface, inspect first with canvas_list if needed and canvas_read for stored content or the live DOM instead of guessing.
For HTML-mode canvases, prefer canvas_update with contentEdits so only the changed sections are patched; use full content only for resets or broad rewrites.
For component-mode canvases, prefer componentOperations or dataOperations for focused updates and reserve full components replacement for broad rewrites.
After canvas_create or canvas_update, call canvas_eval on the returned surfaceId so the preview opens inline or refreshes.
Use canvas_eval for JavaScript execution or DOM changes, not routine inspection.
When editing an existing canvas and the surfaceId is not already in the current turn, call canvas_list first and prefer updating the existing surface instead of creating duplicates.
Use canvas tools only for actual previews or UI artifacts, not for ordinary explanations or summaries.`;
}

// ── Message formatting ───────────────────────────────────────────────────

function formatAttachmentPromptSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  if (size < 1024) {
    return `${Math.round(size)} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function buildAttachmentPromptLine(attachment: Attachment): string {
  const label =
    attachment.name?.trim() ||
    (attachment.type === 'image'
      ? 'Attached image'
      : attachment.type === 'audio'
        ? 'Voice note'
        : 'Attached file');
  const metadata = [
    attachment.mimeType?.trim() || null,
    formatAttachmentPromptSize(attachment.size),
    attachment.workspacePath?.trim() ? `workspace: ${attachment.workspacePath.trim()}` : null,
  ].filter((value): value is string => Boolean(value));
  return metadata.length > 0 ? `${label} (${metadata.join(', ')})` : label;
}

async function formatMessagesForApi(
  systemPrompt: string,
  messages: Message[],
  options?: { geminiTarget?: boolean; anthropicTarget?: boolean },
): Promise<
  Array<{
    role: string;
    content: string | any[];
    tool_call_id?: string;
    name?: string;
    providerReplay?: MessageProviderReplay;
  }>
> {
  const anthropicTarget = options?.anthropicTarget === true;
  const apiMessages: Array<{
    role: string;
    content: string | any[];
    tool_call_id?: string;
    name?: string;
    providerReplay?: MessageProviderReplay;
  }> = [{ role: 'system', content: systemPrompt }];

  const isPlainRecord = (value: unknown): value is Record<string, any> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const buildApiToolCall = (toolCall: ToolCall): Record<string, any> => {
    const rawToolCall = isPlainRecord(toolCall.raw) ? toolCall.raw : undefined;
    const rawFunction = isPlainRecord(rawToolCall?.function) ? rawToolCall.function : undefined;
    const normalizedName = normalizeToolName(
      typeof rawFunction?.name === 'string' && rawFunction.name.length > 0
        ? rawFunction.name
        : toolCall.name,
    );

    const apiToolCall: Record<string, any> = {
      ...(rawToolCall || {}),
      id:
        typeof rawToolCall?.id === 'string' && rawToolCall.id.length > 0
          ? rawToolCall.id
          : toolCall.id,
      type:
        typeof rawToolCall?.type === 'string' && rawToolCall.type.length > 0
          ? rawToolCall.type
          : 'function',
      function: {
        ...(rawFunction || {}),
        name: normalizedName,
        arguments:
          typeof rawFunction?.arguments === 'string' ? rawFunction.arguments : toolCall.arguments,
      },
    };

    return apiToolCall;
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      // Injected system messages (loop warnings, compaction summaries) are
      // converted to user messages so they reach the LLM.  The initial
      // system prompt is already prepended separately above.
      apiMessages.push({ role: 'user', content: msg.content });
      continue;
    }
    const messageContent = msg.role === 'user' ? msg.enrichedContent || msg.content : msg.content;

    if (msg.role === 'tool') {
      // Gemini rejects: empty tool_call_id (400 "Name cannot be empty"),
      // missing/non-string content (400), and orphaned tool results (no
      // matching assistant tool_call).  Guard all three.
      const toolCallId = msg.toolCallId || msg.toolCalls?.[0]?.id || '';
      if (!toolCallId) {
        // Skip tool messages with no valid tool_call_id — they will cause
        // a 400 from Gemini's OpenAI-compat endpoint.
        continue;
      }
      apiMessages.push({
        role: 'tool',
        content:
          typeof messageContent === 'string' && messageContent.length > 0
            ? messageContent
            : 'No output.',
        tool_call_id: toolCallId,
        name: msg.toolCalls?.[0]?.name,
        ...(msg.isError ? { is_error: true } : {}),
      } as any);
      continue;
    }

    if (msg.role === 'assistant') {
      const anthropicAssistantBlocks = getAnthropicReplayAssistantBlocks(
        msg.providerReplay,
        msg.toolCalls,
      );
      if (Array.isArray(anthropicAssistantBlocks) && anthropicAssistantBlocks.length > 0) {
        const assistantContent =
          anthropicAssistantBlocks.length === 1 &&
          isPlainRecord(anthropicAssistantBlocks[0]) &&
          anthropicAssistantBlocks[0].type === 'text' &&
          typeof anthropicAssistantBlocks[0].text === 'string'
            ? anthropicAssistantBlocks[0].text
            : anthropicAssistantBlocks;
        apiMessages.push({ role: 'assistant', content: assistantContent });
        continue;
      }
    }

    if (msg.role === 'assistant' && msg.toolCalls?.length) {
      apiMessages.push({
        role: 'assistant',
        content: messageContent || '',
        ...(msg.providerReplay ? { providerReplay: msg.providerReplay } : {}),
        ...(msg.toolCalls.length > 0
          ? {
              tool_calls: msg.toolCalls.map((tc) => buildApiToolCall(tc)),
            }
          : {}),
      } as any);
      continue;
    }

    const modelVisibleAttachments = filterModelVisibleAttachments(msg.attachments);

    if (msg.role === 'user' && modelVisibleAttachments?.length) {
      const parts: any[] = [];
      if (typeof messageContent === 'string' && messageContent.trim().length > 0) {
        parts.push({ type: 'text', text: messageContent });
      }

      const summarizedAttachments: string[] = [];
      for (const att of modelVisibleAttachments) {
        if (att.type === 'image') {
          const dataUri = await buildImageAttachmentDataUri(att);
          if (dataUri) {
            parts.push({
              type: 'image_url',
              image_url: { url: dataUri },
            });
            continue;
          }
        }

        if (att.type === 'image') {
          parts.push({
            type: 'text',
            text: `Attached image: ${buildAttachmentPromptLine(att)}`,
          });
          continue;
        }

        summarizedAttachments.push(buildAttachmentPromptLine(att));
      }

      if (summarizedAttachments.length > 0) {
        parts.push({
          type: 'text',
          text: `Attached files:\n${summarizedAttachments.map((line) => `- ${line}`).join('\n')}`,
        });
      }

      apiMessages.push({ role: 'user', content: parts });
      continue;
    }

    apiMessages.push({
      role: msg.role,
      content: messageContent,
      ...(msg.role === 'assistant' && msg.providerReplay
        ? { providerReplay: msg.providerReplay }
        : {}),
    });
  }

  return apiMessages;
}

function estimateWorkingMessageTokens(messages: Message[]): number {
  return estimateMessageTokens(
    messages.map((message) => ({
      role: message.role,
      content:
        message.role === 'user' ? message.enrichedContent || message.content : message.content,
    })),
  );
}

function applyCompactionResultToWorkingMessages(
  messages: Message[],
  compactResult: CompactResult,
): OrchestratorCompactionEvent {
  if (!compactResult.compacted || !compactResult.result) {
    return {
      notice: '',
      messages,
      tier: 'tool_clearing',
    };
  }

  const tier: Exclude<CompactionTier, 'none'> =
    compactResult.tier === 'tool_clearing' || compactResult.tier === 'aggressive'
      ? compactResult.tier
      : 'selective';
  if (tier === 'tool_clearing') {
    const { messages: cleared } = clearOldToolResults(messages);
    return {
      notice: `Cleared ${compactResult.result.clearedToolResults ?? 0} old tool results`,
      messages: cleared,
      tier,
      tokensBefore: compactResult.result.tokensBefore,
      tokensAfter: compactResult.result.tokensAfter,
    };
  }

  const summary = compactResult.result.summary || '';
  const firstKeptId = compactResult.result.firstKeptEntryId;
  const keptIdx = firstKeptId ? messages.findIndex((message) => message.id === firstKeptId) : -1;
  const kept = keptIdx >= 0 ? messages.slice(keptIdx) : messages.slice(-4);

  return {
    notice:
      summary || (tier === 'aggressive' ? 'Context compacted aggressively' : 'Context compacted'),
    messages: [
      {
        id: `compact_${Date.now()}`,
        role: 'system' as const,
        content: summary,
        timestamp: Date.now(),
      },
      ...kept,
    ],
    tier,
    tokensBefore: compactResult.result.tokensBefore,
    tokensAfter: compactResult.result.tokensAfter,
  };
}

function shouldRequireToolUse(
  lastUserMessage: string | undefined,
  tools: ToolDefinition[],
): boolean {
  if (!lastUserMessage || tools.length === 0) {
    return false;
  }

  const normalized = lastUserMessage.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/^(hi|hello|hey|thanks|thank you|good morning|good evening)\b/.test(normalized)) {
    return false;
  }

  if (
    /(fix|debug|investigate|inspect|check|review|analy[sz]e|search|find|read|open|list|show|trace|run|execute|test|build|fetch|browse|scan|edit|update|modify|change|create|add|remove|delete|rename|refactor|implement|write|compare)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (
    /(repo|repository|workspace|project|branch|commit|pull request|pr|workflow|pipeline|test suite|codebase|file|directory|folder|screen|component|service)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  if (/(tool|tools|skill|skills|mcp|server|capabilit)/.test(normalized)) {
    return true;
  }

  return /(^|\s)(src\/|app\/|ios\/|android\/|__tests__\/|[\w./-]+\.(ts|tsx|js|jsx|json|md|py|kt|swift|java|yml|yaml))\b/.test(
    normalized,
  );
}

const EXPLICIT_WORKER_EXECUTION_NEGATION_PATTERN =
  /\b(?:don't|do not|avoid|without|no)\b[\s\S]{0,18}\b(?:delegate|spawn|launch|use|run|start|assign)?\s*(?:sub-?agents?|workers?)\b/i;
const EXPLICIT_WORKER_EXECUTION_PATTERN =
  /\b(?:delegate|spawn|launch|use|run|start|assign|orchestrate)\b[\s\S]{0,24}\b(?:sub-?agents?|workers?)\b|\b(?:with|using|via)\s+(?:a|an|one)?\s*(?:sub-?agent|worker)\b|\bsessions_spawn\b/i;

function explicitlyRequiresWorkerExecution(lastUserMessage: string | undefined): boolean {
  if (typeof lastUserMessage !== 'string' || lastUserMessage.trim().length === 0) {
    return false;
  }

  if (EXPLICIT_WORKER_EXECUTION_NEGATION_PATTERN.test(lastUserMessage)) {
    return false;
  }

  return EXPLICIT_WORKER_EXECUTION_PATTERN.test(lastUserMessage);
}

function isSessionCoordinationToolCallName(name: string | undefined): boolean {
  const normalized = normalizeToolName(name || '')
    .trim()
    .toLowerCase();
  return /^(sessions_(spawn|send|status|list|history|output|surface_output|wait|cancel|yield)|wait)$/.test(
    normalized,
  );
}

function getDelegationEnforcementReason(params: {
  isSuperAgent: boolean;
  workingMessages: Message[];
  fullContent: string;
  forceTextThisTurn: boolean;
  lastUserMessageText?: string;
  requestAssessment?: RequestAssessment;
}): 'explicit_worker_request' | undefined {
  if (!params.isSuperAgent || params.forceTextThisTurn || params.fullContent.trim().length === 0) {
    return undefined;
  }

  const delegatedWorkObserved = hasObservedDelegatedWork({
    messages: params.workingMessages,
  });
  if (delegatedWorkObserved) {
    return undefined;
  }

  if (explicitlyRequiresWorkerExecution(params.lastUserMessageText)) {
    return 'explicit_worker_request';
  }

  return undefined;
}

function formatCountSummary(items: string[], label: string, maxVisible = 4): string {
  if (items.length === 0) {
    return `${label}: none.`;
  }

  const visible = items.slice(0, maxVisible).join(', ');
  const hiddenCount = items.length - Math.min(items.length, maxVisible);
  return hiddenCount > 0
    ? `${label}: ${visible}, and ${hiddenCount} more.`
    : `${label}: ${visible}.`;
}

function mapRelevantCategoryToToolCatalogCategory(category: string): string | null {
  const mapping: Record<string, string> = {
    workspace_search: 'files',
    code: 'code',
    web_research: 'web',
    browser: 'browser',
    canvas: 'canvas',
    ssh: 'ssh',
    calendar: 'calendar',
    contacts: 'contacts',
    expo: 'expo',
    expo_manual_actions: 'expo',
    sessions: 'sessions',
    agents: 'agents',
    media: 'media',
    device: 'native',
    communication: 'interaction',
    workspace_files: 'workspace',
    pdf: 'pdf',
    cron: 'automation',
    memory_search: 'memory',
  };

  return mapping[category] ?? null;
}

function describeToolCatalogCategory(category: string): string {
  const descriptions: Record<string, string> = {
    files: 'files (repo search/read/edit)',
    web: 'web (online docs/research)',
    browser: 'browser (interactive website automation)',
    workspace: 'workspace (configured external workspaces)',
    canvas: 'canvas (session previews)',
    ssh: 'ssh (remote server access)',
    expo: 'expo (EAS projects and workflows)',
    sessions: 'sessions (sub-agents and waiting)',
    agents: 'agents (agent and persona management)',
    calendar: 'calendar (device calendars and events)',
    contacts: 'contacts (device contact search)',
    native: 'native (device, clipboard, notifications, location)',
    media: 'media (camera, audio, image, speech)',
    memory: 'memory (read/write/search persisted memory)',
    automation: 'automation (cron, scheduled tasks, notifications)',
    pdf: 'pdf (document reading)',
    interaction: 'interaction (polls and message effects)',
    mcp: 'mcp (connected external tool servers)',
    skills: 'skills (installed instruction packs and skill tools)',
    code: 'code (computation and transformation)',
  };

  return descriptions[category] ?? category;
}

function resolveLikelyToolCatalogCategories(relevantCategories: Set<string>): string[] {
  return Array.from(
    new Set(
      Array.from(relevantCategories)
        .map((category) => mapRelevantCategoryToToolCatalogCategory(category))
        .filter((category): category is string => !!category),
    ),
  );
}

function buildToolSummaryLine(tool: ToolDefinition): string {
  const compressedDescription = compressToolDescription(tool.description || '')
    .replace(/\s+/g, ' ')
    .trim();

  return compressedDescription ? `- ${tool.name}: ${compressedDescription}` : `- ${tool.name}`;
}

type ToolDiscoveryState = {
  discoveredToolNames: Set<string>;
  focusedToolNames: Set<string>;
  supportingFocusedToolNames: Set<string>;
  focusedCategory?: string;
  focusedGuidance?: string;
  focusedQuery?: string;
  sawFullCatalog: boolean;
};

function clearFocusedToolSelection(discoveryState: ToolDiscoveryState): void {
  discoveryState.focusedToolNames.clear();
  discoveryState.supportingFocusedToolNames.clear();
  discoveryState.focusedCategory = undefined;
  discoveryState.focusedGuidance = undefined;
  discoveryState.focusedQuery = undefined;
}

function parseJsonValue(value: string | undefined): unknown {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function extractCatalogToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) {
      names.push(entry.trim());
      continue;
    }

    if (
      entry &&
      typeof entry === 'object' &&
      typeof (entry as { name?: unknown }).name === 'string'
    ) {
      const name = (entry as { name: string }).name.trim();
      if (name) {
        names.push(name);
      }
    }
  }

  return names;
}

function extractCatalogActivationToolNames(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return extractCatalogToolNames(
    (value as { recommendedToolNames?: unknown }).recommendedToolNames,
  );
}

function extractCatalogActivationSupportingToolNames(value: unknown): string[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return extractCatalogToolNames((value as { supportingToolNames?: unknown }).supportingToolNames);
}

function recordToolCatalogDiscovery(
  toolMessage: Message,
  discoveryState: ToolDiscoveryState,
): void {
  if (toolMessage.role !== 'tool' || !toolMessage.toolCalls?.length) {
    return;
  }

  for (const toolCall of toolMessage.toolCalls) {
    if (toolCall.name !== 'tool_catalog') {
      continue;
    }

    const parsedArgs = parseJsonValue(toolCall.arguments) as
      | { category?: unknown; query?: unknown }
      | undefined;
    const requestedCategory =
      typeof parsedArgs?.category === 'string' ? parsedArgs.category.trim().toLowerCase() : '';
    const requestedQuery = typeof parsedArgs?.query === 'string' ? parsedArgs.query.trim() : '';

    if (!requestedCategory && !requestedQuery) {
      clearFocusedToolSelection(discoveryState);
      discoveryState.sawFullCatalog = true;
    }

    const parsedResult = parseJsonValue(toolMessage.content) as
      | {
          tools?: unknown;
          matches?: unknown;
          activation?: unknown;
          guidance?: unknown;
        }
      | undefined;
    const activatedToolNames = extractCatalogActivationToolNames(parsedResult?.activation);
    const activationSupportingToolNames = extractCatalogActivationSupportingToolNames(
      parsedResult?.activation,
    );
    const listedToolNames = [
      ...extractCatalogToolNames(parsedResult?.tools),
      ...extractCatalogToolNames(parsedResult?.matches),
    ];
    const discoveredToolNames = Array.from(
      new Set([...activatedToolNames, ...activationSupportingToolNames, ...listedToolNames]),
    );
    const activationCategory =
      parsedResult?.activation &&
      typeof parsedResult.activation === 'object' &&
      typeof (parsedResult.activation as { category?: unknown }).category === 'string'
        ? ((parsedResult.activation as { category: string }).category || '').trim().toLowerCase()
        : '';
    const activationRationale =
      parsedResult?.activation &&
      typeof parsedResult.activation === 'object' &&
      typeof (parsedResult.activation as { rationale?: unknown }).rationale === 'string'
        ? ((parsedResult.activation as { rationale: string }).rationale || '').trim()
        : '';
    const guidance =
      typeof parsedResult?.guidance === 'string'
        ? parsedResult.guidance.trim()
        : activationRationale;

    for (const name of discoveredToolNames) {
      discoveryState.discoveredToolNames.add(name);
    }

    if ((requestedCategory || requestedQuery) && discoveredToolNames.length > 0) {
      const focusedToolNames =
        activatedToolNames.length > 0 ? activatedToolNames : discoveredToolNames;
      discoveryState.focusedToolNames = new Set(focusedToolNames);
      discoveryState.supportingFocusedToolNames = new Set(
        discoveredToolNames.filter((name) => !discoveryState.focusedToolNames.has(name)),
      );
      discoveryState.focusedCategory = requestedCategory || activationCategory || undefined;
      discoveryState.focusedGuidance = guidance || undefined;
      discoveryState.focusedQuery = requestedQuery || undefined;
    } else if (requestedCategory || requestedQuery) {
      clearFocusedToolSelection(discoveryState);
    }
  }
}

function buildLoadedToolSummary(
  selectedTools: ToolDefinition[],
  narrowToolTarget: boolean,
): string {
  const summaryAnchorNames = new Set([
    'tool_catalog',
    'canvas_list',
    'canvas_read',
    'canvas_create',
    'canvas_update',
    'canvas_eval',
    'sessions_spawn',
    'sessions_status',
    'sessions_wait',
    'sessions_output',
    'sessions_surface_output',
  ]);
  const summaryToolMap = new Map<string, ToolDefinition>();

  for (const tool of selectedTools.slice(0, 10)) {
    summaryToolMap.set(tool.name, tool);
  }

  for (const tool of selectedTools) {
    if (summaryAnchorNames.has(tool.name)) {
      summaryToolMap.set(tool.name, tool);
    }
  }

  const summaryTools = narrowToolTarget ? selectedTools : Array.from(summaryToolMap.values());
  return selectedTools.length <= summaryTools.length
    ? summaryTools.map((tool) => buildToolSummaryLine(tool)).join('\n')
    : `${summaryTools.map((tool) => buildToolSummaryLine(tool)).join('\n')}\n- ...and ${selectedTools.length - summaryTools.length} more loaded tools. Use tool_catalog if you need a loaded capability that is not listed above.`;
}

function buildCapabilityDiscoveryPrompt(params: {
  skillNames: string[];
  mcpConnected: Array<{ name: string; toolCount: number }>;
  mcpPending: string[];
  relevantCategories: Set<string>;
  focusedToolNames?: Iterable<string>;
  supportingFocusedToolNames?: Iterable<string>;
  focusedCategory?: string;
  focusedGuidance?: string;
  focusedQuery?: string;
  narrowToolTarget: boolean;
}): string {
  const focusedToolNames = Array.from(params.focusedToolNames ?? []).filter(Boolean);
  const supportingFocusedToolNames = Array.from(params.supportingFocusedToolNames ?? []).filter(
    Boolean,
  );
  const lines = [
    '## Capability Discovery',
    'If you are not sure which tool, skill, or MCP capability fits, call tool_catalog with a short natural-language query describing the needed capability instead of guessing.',
    'tool_catalog can search built-in tools plus connected MCP tools and installed skills by query, or browse them by category.',
    'Prefer tool_catalog query="what you need to do" when you know the task but not the exact tool name. Use category browsing mainly when you intentionally want to inspect an entire capability family.',
    'After tool_catalog reveals the right tools, switch to those discovered tools on the next turn instead of repeating tool_catalog.',
    'Before concluding that an action is impossible, inspect the available tools or connected MCP capabilities first.',
    `${PYTHON_EXTENSION_WHEN_NEEDED} ${PYTHON_EXTENSION_EXAMPLES}`,
    formatCountSummary(params.skillNames, 'Loaded skills'),
    params.mcpConnected.length
      ? `Connected MCP servers: ${params.mcpConnected
          .slice(0, 4)
          .map((server) => `${server.name} (${server.toolCount} tools)`)
          .join(
            ', ',
          )}${params.mcpConnected.length > 4 ? `, and ${params.mcpConnected.length - 4} more.` : '.'}`
      : 'Connected MCP servers: none.',
  ];

  const likelyCatalogCategories = resolveLikelyToolCatalogCategories(params.relevantCategories);
  if (likelyCatalogCategories.length > 0) {
    lines.push(
      `Likely tool_catalog categories for this request: ${likelyCatalogCategories.map((category) => describeToolCatalogCategory(category)).join('; ')}.`,
    );
  }

  if (focusedToolNames.length > 0) {
    lines.push(
      params.focusedQuery
        ? `Focused discovery query: "${params.focusedQuery}". Prefer these discovered tools next: ${focusedToolNames.join(', ')}.`
        : `Focused discovery results are active. Prefer these discovered tools next: ${focusedToolNames.join(', ')}.`,
    );
  }

  if (supportingFocusedToolNames.length > 0) {
    const visibleSupportingTools = supportingFocusedToolNames.slice(0, 6);
    const hiddenSupportCount = supportingFocusedToolNames.length - visibleSupportingTools.length;
    lines.push(
      hiddenSupportCount > 0
        ? `Supporting discovered tools also remain active for follow-up steps: ${visibleSupportingTools.join(', ')}, and ${hiddenSupportCount} more.`
        : `Supporting discovered tools also remain active for follow-up steps: ${visibleSupportingTools.join(', ')}.`,
    );
  }

  if (params.focusedCategory) {
    lines.push(
      `Focused discovered category: ${describeToolCatalogCategory(params.focusedCategory)}.`,
    );
  }

  if (params.focusedGuidance) {
    lines.push(`Discovery guidance: ${params.focusedGuidance}`);
  }

  if (params.mcpPending.length > 0) {
    lines.push(formatCountSummary(params.mcpPending, 'MCP servers awaiting auth or setup'));
  }

  if (params.narrowToolTarget) {
    lines.push(
      'This model works best with a narrow active tool set. The loaded tools listed above are the only tools you can call immediately.',
    );
    lines.push(
      'If the next step needs a different capability, call tool_catalog with a short query or the most relevant category instead of guessing or retrying the wrong tool.',
    );
    lines.push(
      'After tool_catalog, start with the recommended discovered tools and use the supporting discovered tools when the workflow naturally expands. Do not repeat tool_catalog for the same discovery result unless the plan changed or the earlier result was incomplete.',
    );
    lines.push(
      'For investigation work, prefer inspect -> compare -> act -> verify. Search before reading, read before editing, and stop calling tools once you have enough evidence to answer.',
    );
  }

  return lines.join('\n');
}

function parseYieldToolResult(
  toolName: string,
  result: string,
): {
  yielded: boolean;
  message?: string;
  forceFinalTextNextTurn?: boolean;
} {
  if (toolName !== 'sessions_yield') {
    return { yielded: false };
  }

  try {
    const parsed = JSON.parse(result) as unknown;
    if (!isPlainRecordValue(parsed)) {
      return { yielded: false };
    }

    const status = typeof parsed.status === 'string' ? parsed.status.trim().toLowerCase() : '';
    const message =
      typeof parsed.message === 'string' && parsed.message.trim()
        ? parsed.message.trim()
        : undefined;

    if (status === 'completed' && parsed.finalizeSupervisor === true) {
      return {
        yielded: false,
        message,
        forceFinalTextNextTurn: true,
      };
    }
  } catch {
    return { yielded: false };
  }

  return { yielded: false };
}

function buildSessionsYieldCompletionNote(message?: string): string {
  return [
    '[SYSTEM WORKFLOW READY TO FINALIZE]',
    'All background sub-agent sessions are already in terminal states.',
    message ? `Latest supervisor note: ${message}` : undefined,
    'Do not call wait, sessions_wait, or sessions_yield again. Produce the final user-facing answer now.',
  ]
    .filter(Boolean)
    .join('\n');
}

function trimPendingToolCallsAfterYield(
  pendingToolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
    raw?: Record<string, any>;
  }>,
): Array<{ id: string; name: string; arguments: string; raw?: Record<string, any> }> {
  const firstYieldIndex = pendingToolCalls.findIndex(
    (toolCall) => normalizeToolName(toolCall.name) === 'sessions_yield',
  );
  if (firstYieldIndex < 0) {
    return pendingToolCalls;
  }

  return pendingToolCalls.slice(0, firstYieldIndex + 1);
}

function findAssistantContinuationOverlap(existingText: string, incomingText: string): number {
  const maxOverlap = Math.min(existingText.length, incomingText.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (existingText.slice(-overlapLength) === incomingText.slice(0, overlapLength)) {
      return overlapLength;
    }
  }

  return 0;
}

function mergeAssistantContinuationText(existingText: string, incomingText: string): string {
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

  const overlapLength = findAssistantContinuationOverlap(existingText, incomingText);
  if (overlapLength > 0) {
    return `${existingText}${incomingText.slice(overlapLength)}`;
  }

  return `${existingText}${incomingText}`;
}

function getLastExecutedToolCall(messages: Message[]): ToolCall | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== 'tool' || !message.toolCalls?.length) {
      continue;
    }
    return message.toolCalls[message.toolCalls.length - 1];
  }
  return undefined;
}

function collectRecentToolNames(messages: Message[], limit = 4): Set<string> {
  const recentToolNames = new Set<string>();
  let userBoundariesSeen = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') {
      userBoundariesSeen += 1;
      if (userBoundariesSeen > 1) {
        break;
      }
      continue;
    }

    if (!message.toolCalls?.length) {
      continue;
    }

    for (let toolIndex = message.toolCalls.length - 1; toolIndex >= 0; toolIndex -= 1) {
      const normalizedName = normalizeToolName(message.toolCalls[toolIndex]?.name || '').trim();
      if (!normalizedName) {
        continue;
      }
      recentToolNames.add(normalizedName);
      if (recentToolNames.size >= limit) {
        return recentToolNames;
      }
    }
  }

  return recentToolNames;
}

function shouldForceToolChoice(params: {
  iteration: number;
  actionableRequest: boolean;
  lastExecutedTool?: ToolCall;
}): boolean {
  if (!params.actionableRequest) {
    return false;
  }

  if (params.iteration === 1) {
    return true;
  }

  const toolName = params.lastExecutedTool?.name?.trim().toLowerCase();
  if (!toolName) {
    return false;
  }

  // Only force tool choice after specific "inspection-then-act" tools.
  // IMPORTANT: Do NOT use broad suffix patterns like /_status$/ or /_runs$/
  // because they match terminal tools (e.g. expo_eas_workflow_status) and
  // trap the model in an infinite loop where it can never respond with text.
  return /^(tool_catalog|wait|sessions_(spawn|send|list|status|history))$/.test(toolName);
}

function isParallelizableToolName(name: string): boolean {
  if (!name) {
    return false;
  }

  // Dynamic MCP and skill tools stay sequential until they advertise a
  // concrete read-only contract. Prefix-only parallelism is unsafe.
  return /^(read_file|list_files|glob_search|text_search|javascript|python|tool_catalog|web_search|web_fetch|memory_search|read_workflow_evidence|pdf_read|canvas_list|workspace_status|workspace_read_file|workspace_list_files|ssh_read_file|ssh_list_directory|ssh_background_job_(status|wait)|sessions_list|sessions_status|sessions_history|sessions_output|wait|expo_eas_(status|probe|workflow_status|workflow_runs|workflow_wait)|browser_(status|snapshot|screenshot|console|errors|network|cookies|pdf))$/.test(
    name,
  );
}

function shouldExecuteToolBatchInParallel(toolCalls: Array<{ name: string }>): boolean {
  return (
    toolCalls.length > 1 && toolCalls.every((toolCall) => isParallelizableToolName(toolCall.name))
  );
}

function isDirectAnthropicProvider(provider: LlmProviderConfig): boolean {
  const baseUrl = (provider.baseUrl || '').toLowerCase();
  return baseUrl.includes('anthropic.com');
}

function isPlainRecordValue(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getAnthropicReplayAssistantBlocks(
  providerReplay: Message['providerReplay'] | undefined,
  toolCalls: ToolCall[] | undefined,
): any[] | undefined {
  const replayBlocks = Array.isArray(providerReplay?.anthropicBlocks)
    ? providerReplay.anthropicBlocks
    : undefined;
  const hasToolCalls =
    Array.isArray(toolCalls) &&
    toolCalls.some((toolCall) => {
      const id = typeof toolCall?.id === 'string' ? toolCall.id.trim() : '';
      const name = typeof toolCall?.name === 'string' ? toolCall.name.trim() : '';
      return id.length > 0 && name.length > 0;
    });

  const normalizeReplayBlocks = (blocks: any[]): any[] => {
    const normalizedBlocks = blocks.map((block) => {
      if (
        !isPlainRecordValue(block) ||
        block.type !== 'tool_use' ||
        typeof block.name !== 'string'
      ) {
        return block;
      }

      return {
        ...block,
        name: normalizeToolName(block.name),
      };
    });

    return hasToolCalls
      ? normalizedBlocks
      : normalizedBlocks.filter(
          (block) =>
            !isPlainRecordValue(block) ||
            (block.type !== 'thinking' && block.type !== 'redacted_thinking'),
        );
  };

  if (replayBlocks && replayBlocks.length > 0) {
    const normalizedReplayBlocks = normalizeReplayBlocks(replayBlocks);
    return normalizedReplayBlocks.length > 0 ? normalizedReplayBlocks : undefined;
  }

  if (!Array.isArray(toolCalls)) {
    return undefined;
  }

  for (const toolCall of toolCalls) {
    const rawToolCall = isPlainRecordValue(toolCall.raw) ? toolCall.raw : undefined;
    const extraContent = isPlainRecordValue(rawToolCall?.extra_content)
      ? rawToolCall.extra_content
      : undefined;
    const anthropicContent = isPlainRecordValue(extraContent?.anthropic)
      ? extraContent.anthropic
      : undefined;
    const assistantBlocks = Array.isArray(anthropicContent?.assistant_blocks)
      ? anthropicContent.assistant_blocks
      : Array.isArray(anthropicContent?.assistantBlocks)
        ? anthropicContent.assistantBlocks
        : undefined;

    if (assistantBlocks && assistantBlocks.length > 0) {
      const normalizedAssistantBlocks = normalizeReplayBlocks(assistantBlocks);
      return normalizedAssistantBlocks.length > 0 ? normalizedAssistantBlocks : undefined;
    }
  }

  return undefined;
}

function isAnthropicReplayableThinkingBlock(block: unknown): boolean {
  if (!isPlainRecordValue(block)) {
    return false;
  }

  if (block.type === 'thinking') {
    return typeof block.signature === 'string' && block.signature.length > 0;
  }

  return (
    block.type === 'redacted_thinking' && typeof block.data === 'string' && block.data.length > 0
  );
}

function canContinueAnthropicThinking(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'system' || message.role === 'tool') {
      continue;
    }
    if (message.role === 'user') {
      return false;
    }
    if (message.role === 'assistant') {
      const assistantBlocks = getAnthropicReplayAssistantBlocks(
        message.providerReplay,
        message.toolCalls,
      );
      return (
        Array.isArray(assistantBlocks) && assistantBlocks.some(isAnthropicReplayableThinkingBlock)
      );
    }
  }

  return false;
}

function isToolLoopInProgress(messages: Message[]): boolean {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === 'system') {
      continue;
    }
    if (message.role === 'user') {
      return false;
    }
    if (message.role === 'tool') {
      return true;
    }
    if (message.role === 'assistant') {
      return (message.toolCalls?.length || 0) > 0;
    }
  }

  return false;
}

async function hydrateProviderApiKey(provider: LlmProviderConfig): Promise<LlmProviderConfig> {
  const apiKey = (await getProviderApiKey(provider.id)) || provider.apiKey;
  return apiKey === provider.apiKey ? provider : { ...provider, apiKey };
}

function shouldFailoverOnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = message.match(/LLM API error\s+(\d{3})/i);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  return /network request failed|failed to fetch|fetch failed|timeout|timed out|econn|enotfound/i.test(
    message,
  );
}

function isIncompleteAssistantCompletion(completion?: AssistantCompletionMetadata): boolean {
  return completion?.completionStatus === 'incomplete';
}

function buildPendingAsyncOperationSignature(
  trackedAsyncOperations: ReadonlyMap<string, TrackedAsyncOperation>,
): string {
  return JSON.stringify(
    getPendingTrackedAsyncOperations(trackedAsyncOperations)
      .map((operation) => ({
        kind: operation.kind,
        resourceId: operation.resourceId,
        status: operation.status,
        waitToolName: operation.waitToolName,
        waitArgs: operation.waitArgs ? JSON.stringify(operation.waitArgs) : '',
      }))
      .sort((left, right) => {
        const leftKey = `${left.kind}:${left.resourceId}`;
        const rightKey = `${right.kind}:${right.resourceId}`;
        return leftKey.localeCompare(rightKey);
      }),
  );
}

function shouldResumeIncompleteFinalTextTurn(params: {
  completion?: AssistantCompletionMetadata;
  fullContent: string;
  recoveryCount: number;
}): boolean {
  if (params.recoveryCount >= MAX_RESUMABLE_INCOMPLETE_TEXT_RECOVERIES) {
    return false;
  }

  if (params.fullContent.trim().length === 0) {
    return false;
  }

  return isResumableIncompleteTextCompletion(params.completion);
}

function buildForcedTextOnlyTurnPrompt(reason?: ForcedTextTurnReason): string {
  switch (reason) {
    case 'yield_finalization':
      return '## Final Delivery\nTool use is disabled for this turn because the workflow is complete. Produce the final user-facing answer now. Do not call tools, do not ask the user to wait, and do not restart the answer.';
    case 'incomplete_delivery_continuation':
      return '## Continue Final Answer\nTool use is disabled for this turn because the previous final answer was interrupted before completion. Continue the same answer from exactly where it stopped. Do not restart, do not repeat completed text, and finish cleanly.';
    case 'request_governance':
      return '## Clarify Request\nTool use is disabled for this turn because the latest user input is too low-signal or underspecified for safe execution. Do not plan, do not delegate, do not call tools, and do not invent missing details. Ask the user for the concrete information needed.';
    case 'loop_recovery':
    default:
      return '## Loop Recovery\nTool use is disabled for this turn because the previous tool strategy stalled. Do not call any tools. Answer directly from the gathered evidence, or clearly explain the blocker and what is missing.';
  }
}

function getEscalatedToolPlanningMaxTokens(currentMaxTokens: number, model: string): number {
  const retryCeiling = resolveSubAgentMaxTokens(model);
  const retryFloor = Math.max(resolveFinalizationMaxTokens(model), 8192);
  if (currentMaxTokens >= retryCeiling) {
    return currentMaxTokens;
  }

  return Math.min(retryCeiling, Math.max(currentMaxTokens * 2, retryFloor));
}

function getProviderOverflowRetryMaxTokens(currentMaxTokens: number, model: string): number {
  if (currentMaxTokens <= MIN_PROVIDER_OVERFLOW_RETRY_MAX_TOKENS) {
    return currentMaxTokens;
  }

  return Math.max(
    MIN_PROVIDER_OVERFLOW_RETRY_MAX_TOKENS,
    Math.min(resolveFinalizationMaxTokens(model), Math.floor(currentMaxTokens * 0.75)),
  );
}

// ── Main orchestrator ────────────────────────────────────────────────────

export async function runOrchestrator(
  options: OrchestratorOptions,
  callbacks: OrchestratorCallbacks,
): Promise<void> {
  const {
    provider,
    model,
    allowModelDowngrade = false,
    conversationId,
    usageConversationId = conversationId,
    systemPrompt,
    messages,
    maxTokens = 16384,
    temperature,
    signal,
    thinkingLevel = 'off',
    personaId,
    allProviders,
    enableCompaction = true,
    enableFailover = true,
    linkUnderstandingEnabled = false,
    mediaUnderstandingEnabled = false,
    maxLinks = 3,
    preferredTools,
    internalUserMessageCount = 0,
    responseBudgetProfile = 'default',
  } = options;

  // ── Slash command interception ─────────────────────────────────────
  let lastUserMessageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserMessageIndex = index;
      break;
    }
  }

  const lastUserMsg = lastUserMessageIndex >= 0 ? messages[lastUserMessageIndex] : undefined;
  if (lastUserMsg && isSlashCommand(lastUserMsg.content)) {
    const parsed = parseCommand(lastUserMsg.content);
    if (parsed) {
      const cmd = getCommand(parsed.name);
      if (cmd) {
        const result = await cmd.handler({
          conversationId,
          args: parsed.args,
        });
        callbacks.onCommandResult?.({
          response: result.response,
          action: result.action,
        });
        if (result.response) {
          callbacks.onAssistantMessage(
            result.response,
            [],
            undefined,
            buildAssistantMessageMetadata('final', {
              completionStatus: 'complete',
              finishReason: 'command_result',
            }),
          );
        }
        callbacks.onStateChange('idle');
        callbacks.onDone();
        return;
      }
    }
  }

  // ── Resolve persona ────────────────────────────────────────────────
  const persona: AgentPersona | undefined = personaId ? getPersona(personaId) : undefined;
  if (personaId && !persona) {
    logger.devWarn(`Persona '${personaId}' not found in registry, falling back to default`);
  }
  const personaRegistryId = persona?.id;
  const isSuperAgent =
    typeof personaRegistryId === 'string' && personaRegistryId === SUPER_AGENT_PERSONA_ID;
  const maxToolIterations = isSuperAgent ? MAX_TOOL_ITERATIONS_SUPERAGENT : MAX_TOOL_ITERATIONS;
  logger.debug(
    `conversationId=${conversationId}, persona=${persona?.name || 'none'} (superAgent=${isSuperAgent}), maxIterations=${maxToolIterations}`,
  );
  const resolvedPrompt = resolvePersonaSystemPrompt(persona, systemPrompt);
  const { providerId: resolvedProviderId, model: resolvedModel } = resolvePersonaModel(
    persona,
    provider.id,
    model,
  );

  // Use the resolved provider/model (persona might override them)
  let activeProvider = provider;
  let activeModel = resolveProviderModelSelection(activeProvider, resolvedModel, model);
  if (resolvedProviderId !== provider.id) {
    const found = allProviders?.find(
      (candidate) => candidate.id === resolvedProviderId && candidate.enabled,
    );
    if (found) {
      activeProvider = found;
      activeModel = resolveProviderModelSelection(
        activeProvider,
        resolvedModel,
        activeProvider.model,
      );
    } else {
      logger.devWarn(
        `Persona requested unavailable provider "${resolvedProviderId}". Continuing with provider "${provider.id}".`,
      );
      activeModel = resolveProviderModelSelection(activeProvider, model, activeProvider.model);
    }
  }
  const normalizedResolvedModel = typeof resolvedModel === 'string' ? resolvedModel.trim() : '';
  if (normalizedResolvedModel && activeModel !== normalizedResolvedModel) {
    logger.devWarn(
      `Persona requested unsupported model "${normalizedResolvedModel}" for provider "${activeProvider.id}". Falling back to "${activeModel}".`,
    );
  }
  activeProvider = await hydrateProviderApiKey(activeProvider);

  // ── Build full tool set (static + MCP + skills) ────────────────────
  const mcpTools = mcpManager.getAllToolDefinitions();
  const skillTools = getSkillToolDefinitions();
  const loadedSkills = getAllLoadedSkills();
  const mcpStatuses = mcpManager.getAllStatuses();
  const runtimeToolAvailability = getRuntimeToolAvailabilityContext();
  const allToolsUnfiltered = filterToolsByRuntimeAvailability(
    filterToolsByInvocationPolicy(buildToolDefinitions(mcpTools, skillTools)),
    runtimeToolAvailability,
  );
  const allTools = options.toolFilter
    ? allToolsUnfiltered.filter((tool) => options.toolFilter?.(tool.name) !== false)
    : allToolsUnfiltered;
  const availableToolNames = new Set(allTools.map((tool) => tool.name));
  const requestContextUserMessages = getRequestContextUserMessages(
    messages,
    internalUserMessageCount,
  );
  const requestContextLastUserMsg =
    requestContextUserMessages[requestContextUserMessages.length - 1];
  const requestContextUserTexts = requestContextUserMessages.map((message) =>
    getUserMessagePromptContent(message),
  );

  // ── Skill system prompts ───────────────────────────────────────────
  const requestedSkillsContext = requestContextUserMessages
    .map((message) => getUserMessagePromptContent(message))
    .join('\n');
  const skillPrompts = await getSkillSystemPrompts(conversationId, requestedSkillsContext);

  // ── Tool selection (provider-aware pruning) ────────────────────────
  // Select tools based on relevance to user messages and enforce provider limits.
  const userMessageTexts = requestContextUserTexts;
  const lastUserMessageText =
    userMessageTexts[userMessageTexts.length - 1] ||
    (lastUserMsg ? getUserMessagePromptContent(lastUserMsg) : '');
  const requestAssessment = assessUserRequest(lastUserMessageText, {
    hasAttachments: hasModelVisibleAttachments(requestContextLastUserMsg?.attachments),
    hasPriorContext: requestContextUserMessages.length > 1,
  });
  const requestGovernancePromptSection = buildRequestGovernancePromptSection(requestAssessment);
  const actionableRequest =
    requestAssessment.action === 'clarify'
      ? false
      : requestAssessment.action === 'direct'
        ? true
        : shouldRequireToolUse(lastUserMessageText, allTools);

  // ── LLM + state ───────────────────────────────────────────────────
  let llm = new LlmService(activeProvider);
  const toolCallHistory: ToolCallRecord[] = [];
  const discoveryState: ToolDiscoveryState = {
    discoveredToolNames: new Set<string>(),
    focusedToolNames: new Set<string>(),
    supportingFocusedToolNames: new Set<string>(),
    sawFullCatalog: false,
  };
  const trackedAsyncOperations = new Map<string, TrackedAsyncOperation>();
  for (const operation of options.initialPendingAsyncOperations ?? []) {
    const normalizedResourceId = operation.resourceId?.trim();
    const normalizedKey = operation.key?.trim();
    if (!normalizedResourceId || !normalizedKey) {
      continue;
    }

    trackedAsyncOperations.set(normalizedKey, {
      ...operation,
      key: normalizedKey,
      resourceId: normalizedResourceId,
      displayName: operation.displayName?.trim() || normalizedResourceId,
      lastUpdatedByTool: operation.lastUpdatedByTool?.trim() || 'recovered_async_state',
      updatedAt: Number.isFinite(operation.updatedAt) ? operation.updatedAt : Date.now(),
      monitorToolNames: Array.from(
        new Set(
          (operation.monitorToolNames ?? []).map((toolName) => toolName.trim()).filter(Boolean),
        ),
      ),
      ...(operation.statusArgs ? { statusArgs: { ...operation.statusArgs } } : {}),
      ...(operation.waitToolName?.trim() ? { waitToolName: operation.waitToolName.trim() } : {}),
      ...(operation.waitArgs ? { waitArgs: { ...operation.waitArgs } } : {}),
    });
  }
  const emitPendingAsyncOperationsChange = () => {
    callbacks.onPendingAsyncOperationsChange?.(
      clonePendingTrackedAsyncOperations(trackedAsyncOperations),
    );
  };
  if (trackedAsyncOperations.size > 0) {
    emitPendingAsyncOperationsChange();
  }
  let iteration = 0;
  let warningInjectedThisRound = false;
  let forceFinalTextNextTurn = false;
  let forceFinalTextReasonNextTurn: ForcedTextTurnReason | undefined;
  let forceDelegationToolChoiceNextTurn = false;
  let incompleteFinalTextRecoveryCount = 0;
  let incompleteFinalTextContinuationPrefix = '';
  let forceMaxTokensNextTurn: number | undefined;
  let lastPendingAsyncSignature = buildPendingAsyncOperationSignature(trackedAsyncOperations);

  // ── Failover chain ─────────────────────────────────────────────────
  let failoverState: FailoverState | null = null;
  if (enableFailover && allProviders && allProviders.length > 0) {
    const chain = buildFailoverChain(allProviders, {
      providerId: activeProvider.id,
      model: activeModel,
    });
    if (chain.length > 1) {
      failoverState = createFailoverState(chain, {
        providerId: activeProvider.id,
        model: activeModel,
      });
    }
  }

  // ── Thinking level params ──────────────────────────────────────────
  // ── Context compaction ─────────────────────────────────────────────
  const compactionEngine = enableCompaction ? new DefaultContextEngine() : null;

  // ── Memory ─────────────────────────────────────────────────────────
  const sharedConversationId = options.workspaceConversationId?.trim() || conversationId;
  const longTermMemoryEnabled = canReadLongTermMemory();
  const conversationMemory = null;
  const globalMemory = null;
  const runtimeContextNote = buildRuntimeContextNote();

  // Working message list that includes tool results as we iterate
  let workingMessages = messages.map((message) => {
    if (message.role !== 'user' || !message.enrichedContent) {
      return message;
    }

    const sanitizedEnrichedContent = stripRuntimeContextFromUserContent(message.enrichedContent);
    if (sanitizedEnrichedContent === message.enrichedContent) {
      return message;
    }

    return sanitizedEnrichedContent.length > 0 && sanitizedEnrichedContent !== message.content
      ? { ...message, enrichedContent: sanitizedEnrichedContent }
      : { ...message, enrichedContent: undefined };
  });

  // ── Link & Media Understanding (enrich last user message) ──────────
  const lastUserForEnrichment = workingMessages.findLast((m) => m.role === 'user');
  if (lastUserForEnrichment) {
    const initialPersistedEnrichedContent = getUserMessagePromptContent(lastUserForEnrichment);
    let persistedEnrichedContent = initialPersistedEnrichedContent;

    // Link understanding: extract and fetch URLs
    if (linkUnderstandingEnabled) {
      try {
        const linkResult = await runLinkUnderstanding(lastUserForEnrichment.content, {
          enabled: true,
          maxLinks,
        });
        persistedEnrichedContent = linkResult.enrichedBody;
      } catch {
        // Best-effort — don't block the conversation
      }
    }

    // Media understanding: analyze image/audio attachments
    if (mediaUnderstandingEnabled && lastUserForEnrichment.attachments?.length) {
      try {
        const mediaResult = await runMediaUnderstanding(
          persistedEnrichedContent,
          lastUserForEnrichment.attachments,
          {
            enabled: true,
            provider: activeProvider,
            model: activeModel,
          },
        );
        persistedEnrichedContent = mediaResult.enrichedBody;
      } catch {
        // Best-effort — don't block the conversation
      }
    }

    const requestScopedUserContent = appendRuntimeContextToUserContent(
      persistedEnrichedContent,
      runtimeContextNote,
    );

    // Replace content in working messages only (not the original persisted message)
    const currentWorkingUserContent =
      lastUserForEnrichment.enrichedContent || lastUserForEnrichment.content;
    if (requestScopedUserContent !== currentWorkingUserContent) {
      workingMessages = workingMessages.map((m) =>
        m.id === lastUserForEnrichment.id ? { ...m, enrichedContent: requestScopedUserContent } : m,
      );
    }

    if (persistedEnrichedContent !== initialPersistedEnrichedContent) {
      callbacks.onUserMessageEnriched?.(lastUserForEnrichment.id, persistedEnrichedContent);
    }
  }

  // ── Living memory bridge ───────────────
  // Builds memory blocks (L2) + focus block + recall facts (L3) once per
  // request and reuses across orchestrator iterations. The result is
  // appended to each iteration's system-prompt sections.
  let livingMemory: LivingMemoryBridgeOutput | null = null;
  try {
    livingMemory = await buildLivingMemorySections({
      messages,
      conversationId: sharedConversationId,
      disableLongTermMemory: !longTermMemoryEnabled,
    });
  } catch (livingMemoryError: unknown) {
    logger.devWarn(
      'Living memory bridge unavailable for this request:',
      livingMemoryError instanceof Error
        ? livingMemoryError.message
        : String(livingMemoryError),
    );
    livingMemory = null;
  }

  callbacks.onStateChange('thinking');
  await emitSessionEvent('start', { conversationId });

  try {
    orchestratorLoop: while (iteration < maxToolIterations) {
      iteration++;

      const hasRecentToolMessages = workingMessages
        .slice(-6)
        .some((message) => message.role === 'tool');
      const hasAttachments = workingMessages.some((message) =>
        hasModelVisibleAttachments(message.attachments),
      );
      const iterationPlan = planIterationModel({
        provider: activeProvider,
        primaryModel: activeModel,
        allowModelDowngrade,
        iteration,
        maxTokens,
        actionableRequest,
        hasRecentToolMessages,
        hasAttachments,
        thinkingLevel: persona?.thinkingLevel ?? thinkingLevel,
        responseBudgetProfile,
      });

      const requestModel = iterationPlan.model;
      let requestMaxTokens = iterationPlan.maxTokens;
      if (forceMaxTokensNextTurn != null) {
        requestMaxTokens = Math.max(requestMaxTokens, forceMaxTokensNextTurn);
        forceMaxTokensNextTurn = undefined;
      }
      const forceTextThisTurn = forceFinalTextNextTurn;
      const forceTextReasonThisTurn = forceTextThisTurn ? forceFinalTextReasonNextTurn : undefined;
      const requestGovernanceForceTextThisTurn = requestAssessment.action === 'clarify';
      const effectiveForceTextThisTurn = forceTextThisTurn || requestGovernanceForceTextThisTurn;
      const effectiveForceTextReasonThisTurn = forceTextThisTurn
        ? forceTextReasonThisTurn
        : requestGovernanceForceTextThisTurn
          ? 'request_governance'
          : undefined;
      forceFinalTextNextTurn = false;
      forceFinalTextReasonNextTurn = undefined;
      const requireDelegationThisTurn = forceDelegationToolChoiceNextTurn;
      forceDelegationToolChoiceNextTurn = false;
      const toolingEnabledForProvider =
        !isOnDeviceLlmProvider(activeProvider) ||
        supportsOnDeviceLlmTools(activeProvider, requestModel);
      const toolProviderFamily = resolveToolProviderFamily(
        activeProvider.name,
        activeProvider.baseUrl,
        requestModel,
        activeProvider.kind,
      );
      const modelGeminiTarget = toolProviderFamily === 'gemini';
      const narrowToolTarget = modelGeminiTarget || toolProviderFamily === 'on-device';
      const toolSelectionMessages = narrowToolTarget
        ? userMessageTexts.slice(-2)
        : userMessageTexts;
      const recentNarrowToolNames =
        toolingEnabledForProvider && narrowToolTarget
          ? collectRecentToolNames(workingMessages)
          : new Set<string>();
      const relevantCategories = toolingEnabledForProvider
        ? detectRelevantCategories(toolSelectionMessages)
        : new Set<string>();
      const discoveredCategories =
        toolingEnabledForProvider && discoveryState.sawFullCatalog
          ? relevantCategories
          : new Set<string>();
      // Merge parent-supplied preferred tools into discovered set so they're force-included
      const mergedDiscoveredToolNames = new Set(discoveryState.discoveredToolNames);
      if (preferredTools) {
        for (const toolName of preferredTools) {
          mergedDiscoveredToolNames.add(toolName);
        }
      }
      const pendingAsyncMonitorToolNames = new Set(
        getPendingTrackedAsyncOperationToolNames(trackedAsyncOperations),
      );
      const restrictToPendingAsyncMonitorTools = pendingAsyncMonitorToolNames.size > 0;
      const requestScopedTools =
        requestAssessment.action === 'direct'
          ? allTools.filter((tool) => !isSessionCoordinationToolCallName(tool.name))
          : allTools;
      const candidateSelectedTools = toolingEnabledForProvider
        ? selectToolsForRequest(
            requestScopedTools,
            toolSelectionMessages,
            activeProvider.name,
            activeProvider.baseUrl,
            toolProviderFamily === 'on-device' ? ON_DEVICE_TOOL_TOKEN_BUDGET : undefined,
            {
              model: requestModel,
              providerKind: activeProvider.kind,
              discoveredCategories,
              discoveredToolNames: mergedDiscoveredToolNames,
              recentToolNames: recentNarrowToolNames,
              preferredToolNames: requireDelegationThisTurn
                ? new Set(['sessions_spawn'])
                : restrictToPendingAsyncMonitorTools
                  ? pendingAsyncMonitorToolNames
                  : discoveryState.focusedToolNames,
              restrictToPreferredTools:
                requireDelegationThisTurn ||
                restrictToPendingAsyncMonitorTools ||
                discoveryState.focusedToolNames.size > 0,
              isSuperAgent,
            },
          )
        : [];
      const selectedTools = !toolingEnabledForProvider
        ? []
        : restrictToPendingAsyncMonitorTools
          ? candidateSelectedTools.filter((tool) => pendingAsyncMonitorToolNames.has(tool.name))
          : candidateSelectedTools;
      const deferredCatalog = buildDeferredToolCatalog(requestScopedTools, selectedTools);
      const capabilityDiscoveryPrompt = toolingEnabledForProvider
        ? buildCapabilityDiscoveryPrompt({
            skillNames: loadedSkills.map((skill) => skill.name || skill.id),
            mcpConnected: mcpStatuses
              .filter((status) => status.state === 'connected')
              .map((status) => ({
                name: status.name,
                toolCount: requestScopedTools.filter((tool) =>
                  tool.name.startsWith(`mcp__${status.id}__`),
                ).length,
              })),
            mcpPending: mcpStatuses
              .filter(
                (status) =>
                  status.authRequired ||
                  status.authState === 'unauthenticated' ||
                  status.state === 'error',
              )
              .map((status) => status.name),
            relevantCategories,
            focusedToolNames: discoveryState.focusedToolNames,
            supportingFocusedToolNames: discoveryState.supportingFocusedToolNames,
            focusedCategory: discoveryState.focusedCategory,
            focusedGuidance: discoveryState.focusedGuidance,
            focusedQuery: discoveryState.focusedQuery,
            narrowToolTarget,
          })
        : '';
      const canvasWorkflowPrompt = buildCanvasWorkflowPrompt(selectedTools, relevantCategories);
      const expoWorkflowPrompt = buildExpoWorkflowPrompt(selectedTools, relevantCategories);
      const toolsForIteration =
        toolingEnabledForProvider &&
        !effectiveForceTextThisTurn &&
        iteration <= maxToolIterations - 1
          ? selectedTools
          : undefined;
      const transportGeminiTarget = looksLikeGeminiProvider(activeProvider);
      const anthropicTarget = isDirectAnthropicProvider(activeProvider);
      const baseSystemPromptSections = buildSystemPromptSections(
        resolvedPrompt,
        conversationMemory,
        globalMemory,
        toolingEnabledForProvider ? skillPrompts : '',
        effectiveForceTextThisTurn || !toolingEnabledForProvider ? '' : deferredCatalog,
        effectiveForceTextThisTurn || !toolingEnabledForProvider
          ? ''
          : buildLoadedToolSummary(selectedTools, narrowToolTarget),
        canvasWorkflowPrompt,
        expoWorkflowPrompt,
        effectiveForceTextThisTurn ? '' : capabilityDiscoveryPrompt,
        isSuperAgent,
        toolingEnabledForProvider,
      );
      appendSystemPromptSection(baseSystemPromptSections, requestGovernancePromptSection);
      // Append living-memory sections (L2 blocks cacheable, L3 focus/facts dynamic).
      // Computed once per request; reused across iterations of the same user turn.
      if (livingMemory && livingMemory.sections.length > 0) {
        for (const memorySection of livingMemory.sections) {
          appendSystemPromptSection(baseSystemPromptSections, memorySection.text, {
            cacheable: memorySection.cacheable === true,
          });
        }
      }
      const baseSystemPrompt = joinSystemPromptSections(baseSystemPromptSections);
      const enrichedSystemPromptSections = effectiveForceTextThisTurn
        ? [
            ...baseSystemPromptSections,
            {
              text: buildForcedTextOnlyTurnPrompt(effectiveForceTextReasonThisTurn),
              cacheable: false,
            },
          ]
        : baseSystemPromptSections;
      const enrichedSystemPrompt = effectiveForceTextThisTurn
        ? joinSystemPromptSections(enrichedSystemPromptSections)
        : baseSystemPrompt;
      const canRetryIncompleteToolPlanning = Boolean(toolsForIteration?.length);

      let fullContent = '';
      let reasoning = '';
      let providerReplay: MessageProviderReplay | undefined;
      let completion: AssistantCompletionMetadata | undefined;
      let pendingToolCalls: Array<{
        id: string;
        name: string;
        arguments: string;
        raw?: Record<string, any>;
      }> = [];
      let latestUsage: TokenUsage | null = null;
      let usageReported = false;
      let turnWorkingMessages = workingMessages;
      let contextWindow = getWorkingContextWindow(requestModel);
      let compactionContextWindow = getCompactionWorkingContextWindow(requestModel);

      const compactWorkingMessages = async (
        currentMessages: Message[],
        params: {
          currentTokenCount?: number;
          tokenBudget?: number;
          forceTier?: ForcedCompactionTier;
          failureLabel: string;
        },
      ): Promise<{ messages: Message[]; compacted: boolean }> => {
        if (!compactionEngine) {
          return { messages: currentMessages, compacted: false };
        }

        try {
          const compactResult = await compactionEngine.compact({
            sessionId: conversationId,
            messages: currentMessages,
            ...(params.currentTokenCount != null
              ? { currentTokenCount: params.currentTokenCount }
              : {}),
            ...(params.tokenBudget != null ? { tokenBudget: params.tokenBudget } : {}),
            ...(params.forceTier ? { forceTier: params.forceTier } : {}),
            // Propagate living-memory context into the summary.
            ...(livingMemory && typeof livingMemory.idleSinceLastTurnMs === 'number'
              ? { idleSinceLastTurnMs: livingMemory.idleSinceLastTurnMs }
              : {}),
            ...(livingMemory && livingMemory.focusBlockText
              ? { focusBlock: livingMemory.focusBlockText }
              : {}),
            ...(livingMemory && livingMemory.openThreadLabels.length > 0
              ? { openThreads: livingMemory.openThreadLabels }
              : {}),
          });
          if (!compactResult.compacted || !compactResult.result) {
            return { messages: currentMessages, compacted: false };
          }

          const applied = applyCompactionResultToWorkingMessages(currentMessages, compactResult);
          callbacks.onCompaction?.(applied);
          return { messages: applied.messages, compacted: true };
        } catch (compactionError: unknown) {
          logger.devWarn(
            `${params.failureLabel}:`,
            compactionError instanceof Error ? compactionError.message : String(compactionError),
          );
          return { messages: currentMessages, compacted: false };
        }
      };

      let providerOverflowRetryCount = 0;

      attemptLoop: for (let toolPlanningRetryCount = 0; ; toolPlanningRetryCount += 1) {
        contextWindow = getWorkingContextWindow(requestModel);
        compactionContextWindow = getCompactionWorkingContextWindow(requestModel);
        turnWorkingMessages = workingMessages;

        const previewRequestBudget = async (candidateMessages: Message[]) => {
          const candidateApiMessages = await formatMessagesForApi(
            enrichedSystemPrompt,
            candidateMessages,
            {
              geminiTarget: transportGeminiTarget,
              anthropicTarget,
            },
          );
          const nonSystemCandidateApiMessages =
            candidateApiMessages[0]?.role === 'system'
              ? candidateApiMessages.slice(1)
              : candidateApiMessages;

          return {
            apiMessages: candidateApiMessages,
            nonSystemApiMessages: nonSystemCandidateApiMessages,
            pressure: inspectContextBudget(
              requestModel,
              enrichedSystemPrompt,
              toolsForIteration || [],
              nonSystemCandidateApiMessages,
              requestMaxTokens,
            ),
          };
        };

        // ── Tiered context compaction check ───────────────────────────
        // Anthropic-style graduated response: tool_clearing → selective → aggressive
        if (compactionEngine && turnWorkingMessages.length > 6) {
          const tokenCount = estimateWorkingMessageTokens(turnWorkingMessages);
          const tieredThresholds = getCompactionThresholds(requestModel);
          const lowestThreshold = tieredThresholds.toolClearing;
          if (tokenCount > lowestThreshold) {
            const softCompaction = await compactWorkingMessages(turnWorkingMessages, {
              tokenBudget: compactionContextWindow,
              currentTokenCount: tokenCount,
              failureLabel: 'Compaction failed, continuing without compaction',
            });
            turnWorkingMessages = softCompaction.messages;
          }
        }

        let budgetPreview = await previewRequestBudget(turnWorkingMessages);
        if (
          compactionEngine &&
          turnWorkingMessages.length > 1 &&
          budgetPreview.pressure.requiresMessageWindowing
        ) {
          for (const forceTier of ['tool_clearing', 'selective', 'aggressive'] as const) {
            if (!budgetPreview.pressure.requiresMessageWindowing) {
              break;
            }

            const budgetCompaction = await compactWorkingMessages(turnWorkingMessages, {
              currentTokenCount: estimateWorkingMessageTokens(turnWorkingMessages),
              forceTier,
              failureLabel: 'Pre-flight compaction failed, continuing without compaction',
            });
            if (!budgetCompaction.compacted) {
              continue;
            }

            turnWorkingMessages = budgetCompaction.messages;
            budgetPreview = await previewRequestBudget(turnWorkingMessages);
          }
        }

        const nonSystemApiMessages = budgetPreview.nonSystemApiMessages;

        // ── Pre-flight context budget enforcement ──────────────────────
        // Enforce tool count + total token budget BEFORE sending to the LLM,
        // preventing 400 errors and excessive costs.
        const toolLoopInProgress = isToolLoopInProgress(turnWorkingMessages);
        const hasPendingAsyncOperations =
          getPendingTrackedAsyncOperations(trackedAsyncOperations).length > 0;
        const forceToolChoiceCandidate = toolsForIteration
          ? requireDelegationThisTurn ||
            hasPendingAsyncOperations ||
            shouldForceToolChoice({
              iteration,
              actionableRequest,
              lastExecutedTool: getLastExecutedToolCall(turnWorkingMessages),
            })
          : false;
        const requestedThinkingParams = getThinkingParams(
          iterationPlan.thinkingLevel,
          requestModel,
          {
            maxTokens: requestMaxTokens,
          },
        );
        const anthropicToolLoopInProgress = anthropicTarget && toolLoopInProgress;
        const anthropicReplayableThinking =
          anthropicToolLoopInProgress && canContinueAnthropicThinking(turnWorkingMessages);
        const anthropicThinkingRequested =
          anthropicTarget &&
          Object.prototype.hasOwnProperty.call(requestedThinkingParams, 'thinking');
        // Anthropic extended thinking only supports tool_choice auto/none.
        // Keep tool choice optional whenever thinking can legally remain enabled.
        const forceToolChoice =
          anthropicThinkingRequested &&
          (!anthropicToolLoopInProgress || anthropicReplayableThinking)
            ? false
            : forceToolChoiceCandidate;
        const budgetResult = enforceContextBudget(
          requestModel,
          enrichedSystemPrompt,
          toolsForIteration || [],
          nonSystemApiMessages,
          requestMaxTokens,
          {
            pinnedToolNames: narrowToolTarget ? recentNarrowToolNames : undefined,
          },
        );

        const requestMessages = [
          { role: 'system', content: budgetResult.systemPrompt },
          ...budgetResult.messages,
        ];
        const promptCachingPlan = buildPromptCachingPlan({
          provider: activeProvider,
          model: requestModel,
          estimatedInputTokens: budgetResult.result.totalTokens,
          conversationId,
          systemPrompt: budgetResult.systemPrompt,
          tools: toolsForIteration ? budgetResult.tools : [],
        });

        if (budgetResult.result.adjustments.length > 0) {
          logger.devLog('Budget adjustments:', budgetResult.result.adjustments.join('; '));
        }

        fullContent = '';
        reasoning = '';
        providerReplay = undefined;
        completion = undefined;
        pendingToolCalls = [];
        latestUsage = null;
        usageReported = false;

        const mergeUsageSnapshot = (usage: Partial<TokenUsage>) => {
          const inputTokens = Math.max(latestUsage?.inputTokens ?? 0, usage.inputTokens ?? 0);
          const outputTokens = Math.max(latestUsage?.outputTokens ?? 0, usage.outputTokens ?? 0);
          const cacheReadTokens = Math.max(
            latestUsage?.cacheReadTokens ?? 0,
            usage.cacheReadTokens ?? 0,
          );
          const cacheWriteTokens = Math.max(
            latestUsage?.cacheWriteTokens ?? 0,
            usage.cacheWriteTokens ?? 0,
          );
          const totalTokens = Math.max(
            latestUsage?.totalTokens ?? 0,
            usage.totalTokens ?? 0,
            inputTokens + outputTokens,
          );

          latestUsage = {
            model: usage.model || latestUsage?.model || requestModel,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheWriteTokens,
            totalTokens,
          };
        };

        const flushUsageSnapshot = (allowFallback: boolean) => {
          if (usageReported) {
            return;
          }

          if (!latestUsage && allowFallback) {
            latestUsage = {
              model: requestModel,
              inputTokens:
                estimateMessageTokens(
                  requestMessages.map((message) => ({
                    role: message.role,
                    content:
                      typeof message.content === 'string'
                        ? message.content
                        : JSON.stringify(message.content),
                  })),
                ) + estimateAllToolTokens(budgetResult.tools || []),
              outputTokens: estimateTokens(fullContent) + estimateTokens(reasoning),
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              totalTokens: 0,
            };
            latestUsage.totalTokens = latestUsage.inputTokens + latestUsage.outputTokens;
          }

          if (!latestUsage) {
            return;
          }

          usageReported = true;
          callbacks.onUsage?.(latestUsage);
          recordUsage(usageConversationId, latestUsage);
        };

        // Gemini 3 models require temperature 1.0 — lower values cause looping
        // and degraded function-calling performance per Google's docs.
        const isGemini3 = modelGeminiTarget && /gemini[- ]?3/i.test(requestModel);
        const shouldDisableAnthropicThinking =
          anthropicThinkingRequested &&
          (forceToolChoice || (anthropicToolLoopInProgress && !anthropicReplayableThinking));
        const thinkingParams = shouldDisableAnthropicThinking ? {} : requestedThinkingParams;
        const anthropicThinkingEnabled =
          anthropicTarget && Object.prototype.hasOwnProperty.call(thinkingParams, 'thinking');
        const effectiveTemperature = anthropicThinkingEnabled
          ? undefined
          : isGemini3
            ? 1.0
            : (persona?.temperature ?? temperature);

        const streamOptions: Record<string, any> = {
          model: requestModel,
          conversationId,
          tools: toolsForIteration ? budgetResult.tools : undefined,
          toolChoice: forceToolChoice
            ? anthropicTarget && hasPendingAsyncOperations
              ? { type: 'required', disableParallelToolUse: true }
              : 'required'
            : undefined,
          maxTokens: requestMaxTokens,
          temperature: effectiveTemperature,
          signal: signal?.signal,
          enablePromptCaching: promptCachingPlan.enablePromptCaching,
          promptCacheKey: promptCachingPlan.promptCacheKey,
          ...thinkingParams,
        };

        if (promptCachingPlan.enablePromptCaching) {
          streamOptions.systemPromptSections = enrichedSystemPromptSections;
        }

        try {
          const stream = llm.streamMessage(requestMessages, streamOptions);

          callbacks.onStateChange('responding');

          for await (const event of stream) {
            if (signal?.signal.aborted) {
              throw new Error('Request cancelled');
            }

            switch (event.type) {
              case 'token': {
                const content = event.content || '';
                fullContent += content;
                callbacks.onToken(content);
                break;
              }
              case 'reasoning': {
                const content = event.content || '';
                reasoning += content;
                callbacks.onReasoning?.(content);
                break;
              }
              case 'tool_call':
                if (event.toolCall) {
                  const queuedToolCall = upsertPendingToolCall(pendingToolCalls, event.toolCall);
                  callbacks.onToolCallQueued?.({
                    id: queuedToolCall.id,
                    name: queuedToolCall.name,
                    arguments: queuedToolCall.arguments,
                    ...(queuedToolCall.raw ? { raw: queuedToolCall.raw } : {}),
                    status: 'pending',
                  });
                }
                break;
              case 'usage':
                if (event.usage) {
                  mergeUsageSnapshot({
                    inputTokens: event.usage.inputTokens,
                    outputTokens: event.usage.outputTokens,
                    cacheReadTokens: event.usage.cacheReadTokens,
                    cacheWriteTokens: event.usage.cacheWriteTokens,
                    totalTokens: event.usage.totalTokens,
                    model: requestModel,
                  });
                }
                break;
              case 'done':
                providerReplay = event.providerReplay;
                completion = event.completion;
                break;
            }
          }

          flushUsageSnapshot(true);

          // Record success for failover
          if (failoverState) {
            recordSuccess(failoverState, activeProvider.id, requestModel);
          }
        } catch (streamError: unknown) {
          flushUsageSnapshot(false);

          if (
            !signal?.signal.aborted &&
            compactionEngine &&
            providerOverflowRetryCount < MAX_PROVIDER_OVERFLOW_RETRIES &&
            isContextOverflowProviderError(streamError)
          ) {
            const overflowRecovery = await compactWorkingMessages(turnWorkingMessages, {
              currentTokenCount: estimateWorkingMessageTokens(turnWorkingMessages),
              forceTier: 'aggressive',
              failureLabel: 'Provider overflow recovery compaction failed',
            });
            const nextMaxTokens = getProviderOverflowRetryMaxTokens(requestMaxTokens, requestModel);

            if (overflowRecovery.compacted || nextMaxTokens < requestMaxTokens) {
              providerOverflowRetryCount += 1;
              workingMessages = overflowRecovery.messages;
              requestMaxTokens = nextMaxTokens;
              callbacks.onAssistantStreamReset?.();
              callbacks.onStateChange('thinking');
              await yieldToUiFrame();
              continue attemptLoop;
            }
          }

          // ── Failover on streaming error ────────────────────────────
          const streamErrorMsg =
            streamError instanceof Error ? streamError.message : String(streamError);
          if (
            failoverState &&
            streamErrorMsg !== 'Request cancelled' &&
            !signal?.signal.aborted &&
            shouldFailoverOnError(streamError)
          ) {
            recordFailure(failoverState, activeProvider.id, requestModel);
            const next = getNextAvailableModel(failoverState);
            if (next && allProviders) {
              const nextProvider = allProviders.find((p) => p.id === next.providerId);
              if (nextProvider) {
                activeProvider = await hydrateProviderApiKey(nextProvider);
                activeModel = next.model;
                llm = new LlmService(activeProvider);
                continue orchestratorLoop;
              }
            }
          }
          throw streamError instanceof Error ? streamError : new Error(String(streamError));
        }

        const shouldRetryIncompleteToolPlanning =
          canRetryIncompleteToolPlanning &&
          pendingToolCalls.length > 0 &&
          isIncompleteAssistantCompletion(completion) &&
          isTokenBudgetExhaustedCompletion(completion);

        if (shouldRetryIncompleteToolPlanning) {
          const nextMaxTokens = getEscalatedToolPlanningMaxTokens(requestMaxTokens, requestModel);
          if (
            toolPlanningRetryCount < MAX_INCOMPLETE_TOOL_PLANNING_RETRIES &&
            nextMaxTokens > requestMaxTokens
          ) {
            callbacks.onAssistantStreamReset?.();
            requestMaxTokens = nextMaxTokens;
            callbacks.onStateChange('thinking');
            await yieldToUiFrame();
            continue attemptLoop;
          }
        }

        workingMessages = turnWorkingMessages;
        break;
      }

      const turnAssistantContent = incompleteFinalTextContinuationPrefix
        ? mergeAssistantContinuationText(incompleteFinalTextContinuationPrefix, fullContent)
        : fullContent;

      // No tool calls → final response
      if (pendingToolCalls.length === 0) {
        const pendingAsyncOperations = getPendingTrackedAsyncOperations(trackedAsyncOperations);
        if (pendingAsyncOperations.length > 0) {
          incompleteFinalTextRecoveryCount = 0;
          incompleteFinalTextContinuationPrefix = '';
          if (turnAssistantContent.trim().length > 0) {
            const holdNote = [
              '[SYSTEM WORKFLOW HOLD]',
              'A draft answer was withheld because asynchronous work is still running.',
              'Do not reuse that draft verbatim.',
              'Re-evaluate the task only after every pending operation reaches a terminal state.',
            ].join('\n');
            const previousMessage = workingMessages[workingMessages.length - 1];
            if (previousMessage?.role !== 'system' || previousMessage.content !== holdNote) {
              workingMessages.push({
                id: `msg_${Date.now()}_background_hold_${iteration}`,
                role: 'system' as const,
                content: holdNote,
                timestamp: Date.now(),
              });
            }
          }

          const joinNote = buildPendingAsyncOperationJoinNote(trackedAsyncOperations);
          if (joinNote) {
            const previousMessage = workingMessages[workingMessages.length - 1];
            if (previousMessage?.role !== 'system' || previousMessage.content !== joinNote) {
              workingMessages.push({
                id: `msg_${Date.now()}_background_join_${iteration}`,
                role: 'system' as const,
                content: joinNote,
                timestamp: Date.now(),
              });
            }
          }

          callbacks.onStateChange('thinking');
          await yieldToUiFrame();
          continue;
        }

        const delegationEnforcementReason = getDelegationEnforcementReason({
          isSuperAgent,
          workingMessages,
          fullContent: turnAssistantContent,
          forceTextThisTurn: effectiveForceTextThisTurn,
          lastUserMessageText,
          requestAssessment,
        });
        if (delegationEnforcementReason) {
          incompleteFinalTextRecoveryCount = 0;
          incompleteFinalTextContinuationPrefix = '';
          const delegationCorrection = [
            '[SYSTEM AGENT MODE CORRECTION]',
            'The user explicitly requested delegated worker execution for this task, but no worker was launched.',
            'Do not finalize yet.',
            'Keep the current plan and evidence, then call sessions_spawn or sessions_send to complete the requested delegated work before delivering the final answer.',
          ].join('\n');
          const previousMessage = workingMessages[workingMessages.length - 1];
          if (
            previousMessage?.role !== 'system' ||
            previousMessage.content !== delegationCorrection
          ) {
            workingMessages.push({
              id: `msg_${Date.now()}_delegation_correction_${iteration}`,
              role: 'system' as const,
              content: delegationCorrection,
              timestamp: Date.now(),
            });
          }
          forceDelegationToolChoiceNextTurn = true;
          callbacks.onStateChange('thinking');
          await yieldToUiFrame();
          continue;
        }

        if (
          shouldResumeIncompleteFinalTextTurn({
            completion,
            fullContent: turnAssistantContent,
            recoveryCount: incompleteFinalTextRecoveryCount,
          })
        ) {
          incompleteFinalTextRecoveryCount += 1;
          incompleteFinalTextContinuationPrefix = turnAssistantContent;
          forceFinalTextNextTurn = true;
          forceFinalTextReasonNextTurn = 'incomplete_delivery_continuation';
          forceMaxTokensNextTurn = getEscalatedFinalizationMaxTokens(
            requestMaxTokens,
            requestModel,
          );
          workingMessages.push({
            id: `msg_${Date.now()}_incomplete_final_text_${iteration}`,
            role: 'assistant',
            content: turnAssistantContent,
            timestamp: Date.now(),
            ...(reasoning ? { reasoning } : {}),
            ...(providerReplay ? { providerReplay } : {}),
            assistantMetadata: buildAssistantMessageMetadata('intermediate', completion),
          });
          workingMessages.push({
            id: `msg_${Date.now()}_incomplete_final_text_note_${iteration}`,
            role: 'system' as const,
            content: buildIncompleteTextContinuationNote(completion?.finishReason),
            timestamp: Date.now(),
          });
          callbacks.onStateChange('thinking');
          await yieldToUiFrame();
          continue;
        }

        incompleteFinalTextRecoveryCount = 0;
        incompleteFinalTextContinuationPrefix = '';

        callbacks.onAssistantMessage(
          turnAssistantContent,
          [],
          providerReplay,
          buildAssistantMessageMetadata('final', completion),
        );
        callbacks.onStateChange('idle');
        await emitSessionEvent('end', { conversationId });
        callbacks.onDone();
        return;
      }

      incompleteFinalTextRecoveryCount = 0;
      incompleteFinalTextContinuationPrefix = '';

      if (isIncompleteAssistantCompletion(completion)) {
        callbacks.onAssistantStreamReset?.();
        const finishReason = completion?.finishReason || 'interrupted_tool_turn';
        throw new Error(
          `The model response ended before tool planning completed (${finishReason}). Partial tool calls were discarded to avoid executing incomplete actions.`,
        );
      }

      // ── Pre-execution loop detection ────────────
      // Check history BEFORE executing tools. On warning → inject guidance.
      // On critical → hard stop.
      const loopCheck = detectLoops(toolCallHistory, {
        pendingAsyncOperationToolNames: pendingAsyncMonitorToolNames,
      });
      if (loopCheck.loopDetected && loopCheck.level === 'critical') {
        callbacks.onAssistantMessage(
          turnAssistantContent ||
            `I noticed I was stuck in a loop (${loopCheck.type}). Here's what I can tell you based on what I've gathered so far — if you need something different, please rephrase your request or provide more details.`,
          [],
          providerReplay,
          buildAssistantMessageMetadata('final', {
            completionStatus: 'complete',
            finishReason: 'loop_detected',
          }),
        );
        callbacks.onStateChange('idle');
        await emitSessionEvent('end', { conversationId, reason: 'loop_detected' });
        callbacks.onDone();
        return;
      }

      const executableToolCalls = trimPendingToolCallsAfterYield(pendingToolCalls);

      // Create assistant message with tool calls
      const toolCallObjects: ToolCall[] = executableToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        ...(tc.raw ? { raw: tc.raw } : {}),
        status: 'pending' as const,
      }));

      callbacks.onAssistantMessage(
        turnAssistantContent,
        toolCallObjects,
        providerReplay,
        buildAssistantMessageMetadata('intermediate', completion),
      );
      await yieldToUiFrame();

      // Add assistant message to working set
      workingMessages.push({
        id: `msg_${Date.now()}_assistant_${iteration}`,
        role: 'assistant',
        content: turnAssistantContent,
        toolCalls: toolCallObjects,
        timestamp: Date.now(),
        reasoning: reasoning || undefined,
        providerReplay,
      });

      // If warning-level loop detected, inject guidance into working messages
      // so the LLM sees the warning in its next turn.
      // Fixed: previous logic had an oscillation bug where the flag reset in the
      // else branch even when a loop WAS detected, causing warnings to appear
      // only every other turn and giving the model mixed signals.
      if (loopCheck.loopDetected && loopCheck.level === 'warning') {
        const recoveryHint =
          loopCheck.type === 'ping_pong'
            ? 'You are alternating between two tools without progress. Stop both and give the user a direct answer with what you know so far.'
            : loopCheck.type === 'known_poll_no_progress'
              ? 'The tool keeps returning the same result. The data is not changing — report what you have to the user.'
              : 'You are repeating the same action. STOP immediately. Either answer with what you already have, or ask the user for clarification.';
        // Inject on first detection; on subsequent detections escalate the message
        const repeatedWarning = warningInjectedThisRound;
        const warningPrefix = warningInjectedThisRound
          ? `[SYSTEM WARNING — REPEATED — Iteration ${iteration}/${maxToolIterations}]`
          : `[SYSTEM WARNING — Iteration ${iteration}/${maxToolIterations}]`;
        workingMessages.push({
          id: `msg_${Date.now()}_loop_warning_${iteration}`,
          role: 'system' as const,
          content: `${warningPrefix} ${loopCheck.details}\n\n${recoveryHint}\n\nYour next response MUST be a final text answer to the user, not another tool call.`,
          timestamp: Date.now(),
        });
        if (repeatedWarning) {
          forceFinalTextNextTurn = true;
          forceFinalTextReasonNextTurn = 'loop_recovery';
        }
        warningInjectedThisRound = true;
      } else if (!loopCheck.loopDetected) {
        // Only reset when the loop is genuinely no longer detected
        warningInjectedThisRound = false;
      }

      // Execute each tool call with per-call guards.
      // Read-only / inspection batches run concurrently; mutating batches stay ordered.
      let yieldedTurnMessage: string | undefined;

      type ToolExecutionOutcome = {
        index: number;
        toolCallId: string;
        toolMessage: Message;
        yieldedMessage?: string;
        forceFinalTextNextTurn?: boolean;
        yieldCompletionNoteMessage?: string;
      };

      const executePendingToolCall = async (
        tc: { id: string; name: string; arguments: string; raw?: Record<string, any> },
        index: number,
      ): Promise<ToolExecutionOutcome> => {
        const resolvedToolName = resolveRuntimeFallbackToolName(tc.name, {
          availableToolNames,
          context: runtimeToolAvailability,
        });
        const effectiveToolCall = applyResolvedToolName(tc, resolvedToolName);
        const preCheck = shouldBlockToolCall(
          toolCallHistory,
          effectiveToolCall.name,
          effectiveToolCall.arguments,
          {
            pendingAsyncOperationToolNames: pendingAsyncMonitorToolNames,
          },
        );
        if (preCheck.loopDetected && preCheck.level === 'critical') {
          const blockedResult =
            preCheck.details || `Blocked: ${effectiveToolCall.name} repeated too many times.`;
          const blockedCall: ToolCall = {
            id: tc.id,
            name: effectiveToolCall.name,
            arguments: effectiveToolCall.arguments,
            status: 'failed',
            startedAt: Date.now(),
            updatedAt: Date.now(),
            completedAt: Date.now(),
            error: blockedResult,
          };
          callbacks.onToolCallStart(blockedCall);
          callbacks.onToolCallComplete(blockedCall);
          recordToolCall(toolCallHistory, {
            name: effectiveToolCall.name,
            arguments: effectiveToolCall.arguments,
            timestamp: Date.now(),
            result: blockedResult,
            resultHash: hashResult(blockedResult),
          });
          return {
            index,
            toolCallId: tc.id,
            toolMessage: {
              id: `msg_${Date.now()}_tool_blocked_${tc.id}`,
              role: 'tool',
              content: blockedResult,
              toolCallId: tc.id,
              toolCalls: [{ ...blockedCall }],
              timestamp: Date.now(),
              isError: true,
            },
          };
        }

        if (options.toolFilter && !options.toolFilter(effectiveToolCall.name)) {
          const filteredResult = `Tool "${effectiveToolCall.name}" is not allowed in this context.`;
          const filteredCall: ToolCall = {
            id: tc.id,
            name: effectiveToolCall.name,
            arguments: effectiveToolCall.arguments,
            status: 'failed',
            startedAt: Date.now(),
            updatedAt: Date.now(),
            completedAt: Date.now(),
            error: filteredResult,
          };
          callbacks.onToolCallStart(filteredCall);
          callbacks.onToolCallComplete(filteredCall);
          recordToolCall(toolCallHistory, {
            name: effectiveToolCall.name,
            arguments: effectiveToolCall.arguments,
            timestamp: Date.now(),
            result: filteredResult,
            resultHash: hashResult(filteredResult),
          });
          return {
            index,
            toolCallId: tc.id,
            toolMessage: {
              id: `msg_${Date.now()}_tool_filtered_${tc.id}`,
              role: 'tool',
              content: filteredResult,
              toolCallId: tc.id,
              toolCalls: [{ ...filteredCall }],
              timestamp: Date.now(),
              isError: true,
            },
          };
        }

        const toolCall: ToolCall = {
          id: tc.id,
          name: effectiveToolCall.name,
          arguments: effectiveToolCall.arguments,
          ...(effectiveToolCall.raw ? { raw: effectiveToolCall.raw } : {}),
          status: 'running',
          startedAt: Date.now(),
          updatedAt: Date.now(),
        };
        callbacks.onToolCallStart(toolCall);
        await yieldToUiFrame();

        if (signal?.signal.aborted) {
          toolCall.status = 'failed';
          toolCall.updatedAt = Date.now();
          toolCall.completedAt = toolCall.updatedAt;
          toolCall.error = 'Request cancelled';
          callbacks.onToolCallComplete(toolCall);
          return {
            index,
            toolCallId: tc.id,
            toolMessage: {
              id: `msg_${Date.now()}_tool_error_${tc.id}`,
              role: 'tool',
              content: 'Error: Request cancelled',
              toolCallId: tc.id,
              toolCalls: [{ ...toolCall }],
              timestamp: Date.now(),
              isError: true,
            },
          };
        }

        await emitAgentEvent('tool_start', {
          conversationId,
          toolName: effectiveToolCall.name,
          iteration,
        });
        try {
          let result = await executeTool(
            effectiveToolCall.name,
            effectiveToolCall.arguments,
            conversationId,
            {
              provider: activeProvider,
              allProviders,
              model: activeModel,
              workspaceConversationId: options.workspaceConversationId,
              workspaceReadFallbackConversationId: options.workspaceReadFallbackConversationId,
              availableToolNames: Array.from(availableToolNames),
            },
          );
          result = enforceToolResultBudget(result, contextWindow);
          applyTrackedAsyncToolResult(
            trackedAsyncOperations,
            effectiveToolCall.name,
            effectiveToolCall.arguments,
            result,
          );
          emitPendingAsyncOperationsChange();

          toolCall.status = 'completed';
          toolCall.updatedAt = Date.now();
          toolCall.completedAt = toolCall.updatedAt;
          toolCall.result = result;
          callbacks.onToolCallComplete(toolCall);
          await emitAgentEvent('tool_end', {
            conversationId,
            toolName: effectiveToolCall.name,
            iteration,
          });

          recordToolCall(toolCallHistory, {
            name: effectiveToolCall.name,
            arguments: effectiveToolCall.arguments,
            timestamp: Date.now(),
            result,
            resultHash: hashResult(result),
          });

          const yieldResult = parseYieldToolResult(effectiveToolCall.name, result);
          return {
            index,
            toolCallId: tc.id,
            toolMessage: {
              id: `msg_${Date.now()}_tool_${tc.id}`,
              role: 'tool',
              content: result,
              toolCallId: tc.id,
              toolCalls: [{ ...toolCall }],
              timestamp: Date.now(),
            },
            yieldedMessage: yieldResult.yielded
              ? yieldResult.message || 'Waiting for background agent results.'
              : undefined,
            forceFinalTextNextTurn: yieldResult.forceFinalTextNextTurn,
            yieldCompletionNoteMessage: yieldResult.message,
          };
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          toolCall.status = 'failed';
          toolCall.updatedAt = Date.now();
          toolCall.completedAt = toolCall.updatedAt;
          toolCall.error = errMsg;
          callbacks.onToolCallComplete(toolCall);

          const errorResult = `Error: ${errMsg}`;
          applyTrackedAsyncToolResult(
            trackedAsyncOperations,
            effectiveToolCall.name,
            effectiveToolCall.arguments,
            errorResult,
          );
          emitPendingAsyncOperationsChange();
          recordToolCall(toolCallHistory, {
            name: effectiveToolCall.name,
            arguments: effectiveToolCall.arguments,
            timestamp: Date.now(),
            result: errorResult,
            resultHash: hashResult(errorResult),
          });

          return {
            index,
            toolCallId: tc.id,
            toolMessage: {
              id: `msg_${Date.now()}_tool_error_${tc.id}`,
              role: 'tool',
              content: errorResult,
              toolCallId: tc.id,
              toolCalls: [{ ...toolCall }],
              timestamp: Date.now(),
              isError: true,
            },
          };
        }
      };

      const executeBatchInParallel = shouldExecuteToolBatchInParallel(executableToolCalls);
      let toolExecutionOutcomes: ToolExecutionOutcome[] = [];

      if (executeBatchInParallel) {
        // Use Promise.allSettled to ensure ALL tool calls produce results,
        // even if one or more reject unexpectedly. This prevents orphaned
        // tool_calls when Promise.all would discard all results on a single failure.
        const settled = await Promise.allSettled(
          executableToolCalls.map((tc, index) => executePendingToolCall(tc, index)),
        );
        toolExecutionOutcomes = settled.map((result, index) => {
          if (result.status === 'fulfilled') return result.value;
          // Should never happen since executePendingToolCall has its own try/catch,
          // but safety net: create a synthetic error outcome
          const tc = executableToolCalls[index];
          const errMsg =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          return {
            index,
            toolCallId: tc.id,
            toolMessage: {
              id: `msg_${Date.now()}_tool_rejected_${index}_${tc.id}`,
              role: 'tool' as const,
              content: `Error: Unexpected failure during parallel execution — ${errMsg}`,
              toolCallId: tc.id,
              toolCalls: [
                {
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                  status: 'failed' as const,
                  error: errMsg,
                },
              ],
              timestamp: Date.now(),
              isError: true,
            },
          };
        });
      } else {
        for (let index = 0; index < executableToolCalls.length; index += 1) {
          const outcome = await executePendingToolCall(executableToolCalls[index], index);
          toolExecutionOutcomes.push(outcome);
          if (outcome.yieldedMessage) {
            break;
          }
        }
      }

      let forceFinalTextFromYieldThisTurn = false;
      let yieldCompletionNoteMessage: string | undefined;
      for (const outcome of toolExecutionOutcomes.sort((left, right) => left.index - right.index)) {
        workingMessages.push(outcome.toolMessage);
        callbacks.onToolMessage(outcome.toolCallId, outcome.toolMessage.content);
        recordToolCatalogDiscovery(outcome.toolMessage, discoveryState);
        const executedToolName = outcome.toolMessage.toolCalls?.[0]?.name;
        if (
          executedToolName &&
          executedToolName !== 'tool_catalog' &&
          (discoveryState.focusedToolNames.has(executedToolName) ||
            discoveryState.supportingFocusedToolNames.has(executedToolName))
        ) {
          clearFocusedToolSelection(discoveryState);
        }
        if (!yieldedTurnMessage && outcome.yieldedMessage) {
          yieldedTurnMessage = outcome.yieldedMessage;
        }
        if (outcome.forceFinalTextNextTurn) {
          forceFinalTextFromYieldThisTurn = true;
          yieldCompletionNoteMessage =
            outcome.yieldCompletionNoteMessage || yieldCompletionNoteMessage;
        }
      }

      if (forceFinalTextFromYieldThisTurn) {
        forceFinalTextNextTurn = true;
        forceFinalTextReasonNextTurn = 'yield_finalization';
        workingMessages.push({
          id: `msg_${Date.now()}_sessions_yield_complete_${iteration}`,
          role: 'system',
          content: buildSessionsYieldCompletionNote(yieldCompletionNoteMessage),
          timestamp: Date.now(),
        });
      }

      const pendingAsyncSignature = buildPendingAsyncOperationSignature(trackedAsyncOperations);
      if (pendingAsyncSignature !== lastPendingAsyncSignature) {
        lastPendingAsyncSignature = pendingAsyncSignature;
        if (!forceFinalTextFromYieldThisTurn) {
          const joinNote = buildPendingAsyncOperationJoinNote(trackedAsyncOperations);
          if (joinNote) {
            workingMessages.push({
              id: `msg_${Date.now()}_async_join_${iteration}`,
              role: 'system',
              content: joinNote,
              timestamp: Date.now(),
            });
          }
        }
      }

      // ── Post-execution: Tool result pairing guard ────
      // Ensure every tool_call in the assistant message has a matching
      // tool_result. Create synthetic error results for orphaned tool calls
      // that never received a response (race condition, crash, etc.).
      workingMessages = ensureToolResultPairing(workingMessages);
      workingMessages = deduplicateToolResults(workingMessages);

      // ── Post-execution: context guard ───────────
      // 1. Compact old tool results to free context
      workingMessages = compactToolResults(workingMessages, contextWindow);

      // 2. Preemptive overflow check — if context > 90% of window,
      //    force compaction on next iteration
      if (compactionEngine && isApproachingContextOverflow(workingMessages, contextWindow)) {
        for (const forceTier of ['tool_clearing', 'selective', 'aggressive'] as const) {
          if (!isApproachingContextOverflow(workingMessages, contextWindow)) {
            break;
          }

          const overflowCompaction = await compactWorkingMessages(workingMessages, {
            currentTokenCount: estimateWorkingMessageTokens(workingMessages),
            forceTier,
            failureLabel: 'Preemptive compaction failed',
          });
          if (!overflowCompaction.compacted) {
            continue;
          }

          workingMessages = overflowCompaction.messages;
        }
      }

      if (yieldedTurnMessage) {
        callbacks.onAssistantMessage(
          yieldedTurnMessage,
          [],
          undefined,
          buildAssistantMessageMetadata('final', {
            completionStatus: 'complete',
            finishReason: 'yielded',
          }),
        );
        callbacks.onStateChange('idle');
        await emitSessionEvent('end', { conversationId, reason: 'yielded' });
        callbacks.onDone();
        return;
      }

      callbacks.onStateChange('thinking');
    }

    // Hit max iterations — provide a useful summary
    callbacks.onAssistantMessage(
      "I've reached the maximum number of tool iterations. Here's what I've accomplished so far with the tools I've used.",
      [],
      undefined,
      buildAssistantMessageMetadata('final', {
        completionStatus: 'complete',
        finishReason: 'max_iterations',
      }),
    );
    callbacks.onStateChange('idle');
    await emitSessionEvent('end', { conversationId, reason: 'max_iterations' });
    callbacks.onDone();
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg === 'Request cancelled' || signal?.signal.aborted) {
      callbacks.onStateChange('idle');
      await emitSessionEvent('end', { conversationId, reason: 'cancelled' });
      callbacks.onDone();
      return;
    }

    callbacks.onStateChange('error');
    await emitSessionEvent('end', { conversationId, reason: 'error' });
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    callbacks.onDone();
  }
}
