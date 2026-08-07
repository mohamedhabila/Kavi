import type { Message } from '../../../types/message';
import type { SubAgentConfig } from '../../../types/subAgent';
import { normalizeToolName } from '../../../engine/tools/toolNameNormalization';
import { generateId } from '../../../utils/id';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  normalizeFinalizationOutputText,
} from '../finalizationText';
import { MAX_SPAWN_DEPTH } from '../mobileSpawnPolicy';
import { PYTHON_EXTENSION_POLICY, PYTHON_EXTENSION_WHEN_NEEDED } from '../../python/guidance';
import {
  cloneStoredMessages,
  hasSeedUserInstruction,
  normalizeSubAgentPrompt,
} from './sessionContextMessages';
import {
  renderSubAgentMemoryBundle,
  sanitizeSubAgentMemoryBundle,
  sanitizeSubAgentMemorySelectionScope,
} from '../workerMemoryBundle';

export { MAX_SPAWN_DEPTH };
export const OUTPUT_TRUNCATION = FINALIZATION_OUTPUT_TRUNCATION;

export const DEFAULT_SUB_AGENT_MAX_ITERATIONS = 32;
export const MAX_SUB_AGENT_MAX_ITERATIONS = 96;
const MIN_SUB_AGENT_MAX_ITERATIONS = DEFAULT_SUB_AGENT_MAX_ITERATIONS;
const MIN_TIMEOUT_MS = 1_000;

export function hasExplicitSubAgentMaxIterations(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function normalizeSubAgentTimeoutMs(value?: number): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return undefined;
  }

  return Math.max(MIN_TIMEOUT_MS, normalized);
}

export function normalizeSubAgentMaxIterations(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_SUB_AGENT_MAX_ITERATIONS;
  }

  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return DEFAULT_SUB_AGENT_MAX_ITERATIONS;
  }

  return Math.min(MAX_SUB_AGENT_MAX_ITERATIONS, Math.max(MIN_SUB_AGENT_MAX_ITERATIONS, normalized));
}

/**
 * A graph turn may prepare a model response or settle its tools. Reserve enough
 * graph turns for every permitted worker action plus a final answer turn.
 */
export function resolveSubAgentGraphIterationBudget(maxIterations: number): number {
  return maxIterations * 2 + 1;
}

export function isValidSubAgentToolConfiguration(tools: unknown): tools is string[] | undefined {
  return (
    tools === undefined || (Array.isArray(tools) && tools.every((tool) => typeof tool === 'string'))
  );
}

export function normalizeConfiguredToolNames(tools?: unknown): string[] | undefined {
  if (!isValidSubAgentToolConfiguration(tools) || tools === undefined) return undefined;
  const normalized = Array.from(
    new Set(
      tools
        .map((toolName) => normalizeToolName(toolName))
        .filter((toolName) => toolName.length > 0),
    ),
  );

  return normalized.length ? normalized : undefined;
}

export function hasExplicitToolConfiguration(tools: unknown): boolean {
  return Array.isArray(tools);
}

export function cloneSubAgentConfig(config: SubAgentConfig): SubAgentConfig {
  if (!isValidSubAgentToolConfiguration(config.tools)) {
    throw new Error('sub_agent_tools_invalid');
  }
  const normalizedTools = normalizeConfiguredToolNames(config.tools);
  const hasExplicitToolsConfig = hasExplicitToolConfiguration(config.tools);
  const prompt = normalizeSubAgentPrompt(config.prompt) || '';
  const workstreamId = config.workstreamId?.trim() || undefined;
  const memorySelectionScope = sanitizeSubAgentMemorySelectionScope(config.memorySelectionScope);
  const memoryBundle = sanitizeSubAgentMemoryBundle(config.memoryBundle);
  return {
    ...config,
    prompt,
    ...(workstreamId ? { workstreamId } : {}),
    ...(memorySelectionScope ? { memorySelectionScope } : { memorySelectionScope: undefined }),
    ...(memoryBundle ? { memoryBundle } : { memoryBundle: undefined }),
    ...(hasExplicitToolsConfig
      ? { tools: normalizedTools ?? [] }
      : normalizedTools
        ? { tools: normalizedTools }
        : {}),
    initialMessages: undefined,
  };
}

export function buildInitialSubAgentMessages(config: SubAgentConfig): Message[] {
  const normalizedPrompt = normalizeSubAgentPrompt(config.prompt);
  const initialMessages = cloneStoredMessages(config.initialMessages);

  if (initialMessages.length > 0) {
    if (initialMessages.some((message) => hasSeedUserInstruction(message))) {
      return initialMessages;
    }

    if (normalizedPrompt) {
      return [
        ...initialMessages,
        {
          id: generateId(),
          role: 'user',
          content: normalizedPrompt,
          timestamp: Date.now(),
        },
      ];
    }

    return initialMessages;
  }

  return [
    {
      id: generateId(),
      role: 'user',
      content: normalizedPrompt ?? '',
      timestamp: Date.now(),
    },
  ];
}

export function buildSubAgentSystemPrompt(
  config: Pick<
    SubAgentConfig,
    'systemPrompt' | 'memoryBundle' | 'agentRunId' | 'workstreamId' | 'deliverableKind'
  >,
  depth: number,
): string {
  const workerContract = `## Worker Contract
- If the task can be completed from the prompt and visible context, answer directly without tools.
- Use tools only for required information, verification, or side effects.
- Support, catalog, memory, and coordination tools are not progress by themselves.
- Use tool results as your ground truth.
- Time-dependent work, verification, side effects, and artifacts remain incomplete unless successful tool results prove them. Never fabricate execution evidence or claim completion when required operations did not succeed; report the blocker.
- Briefly state major tool phases only when it helps coordination.
- ${PYTHON_EXTENSION_WHEN_NEEDED}
- ${PYTHON_EXTENSION_POLICY}
- If the prompt or Expected output asks for an exact answer, return that exact answer and skip the report.
- Otherwise finish with a concise report: outcome, key verified findings, artifacts/actions, and any blocker.
- If interrupted, timed out, or cancelled, preserve the most useful verified findings in visible text.`;
  // The evidence clause is stated for the kind of deliverable this worker was given.
  // Held unconditionally it contradicted the Worker Contract above, which tells a worker
  // whose task needs no tools to answer directly: the worker did that, correctly, and was
  // then forbidden from reporting success because it had no tool results to point at. It
  // therefore never claimed verified_success, its goal never received worker evidence,
  // and the supervisor re-delegated until the run hit its ceiling. Proof is still demanded
  // wherever there is something to prove — the scoping goal decides which case this is.
  const requiresExecutionProof = config.deliverableKind !== 'information';
  const structuredExecutionContract = config.workstreamId?.trim()
    ? `## Execution Evidence Contract
- This is graph-owned or run-owned execution work. Do not infer success from priors or typical project structure.
- If the task required inspection, verification, or side effects, use the available tools before concluding the work is complete.
${
  requiresExecutionProof
    ? '- Use verified_success only when completed tool results or structured workflow records directly verify the requested work.'
    : '- This task asks for an answer rather than a change to anything. Use verified_success when you have actually produced the requested answer, and only then. If any part of it did require inspection, verification, or a side effect, that part still needs completed tool results.'
}
- If you could not inspect, verify, or complete the requested work, say so plainly instead of guessing.
- The runtime tracks completion state separately from the visible report; focus on the report itself.`
    : undefined;
  const taskMemoryEvidence = renderSubAgentMemoryBundle(config.memoryBundle);
  const scopedContext = [structuredExecutionContract, taskMemoryEvidence]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');

  const rawSystemPrompt = config.systemPrompt?.trim();
  if (rawSystemPrompt) {
    return `${rawSystemPrompt.slice(0, 50_000)}

${scopedContext ? `${scopedContext}\n\n` : ''}
${workerContract}`;
  }

  return `You are a sub-agent (depth ${depth + 1}/${MAX_SPAWN_DEPTH}). Complete the task and return the result.

${scopedContext ? `${scopedContext}\n\n` : ''}
${workerContract}`;
}

export function resolveCurrentTaskPrompt(messages: Message[], fallbackPrompt: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') {
      continue;
    }
    const normalized = normalizeFinalizationOutputText(message.content);
    if (normalized) {
      return normalized;
    }
  }

  return fallbackPrompt;
}
