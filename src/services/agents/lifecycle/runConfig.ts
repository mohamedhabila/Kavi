import type { Message } from '../../../types/message';
import type { SubAgentConfig } from '../../../types/subAgent';
import { normalizeToolName } from '../../../engine/tools/toolNameNormalization';
import { generateId } from '../../../utils/id';
import {
  FINALIZATION_OUTPUT_TRUNCATION,
  normalizeFinalizationOutputText,
} from '../finalizationText';
import { MAX_SPAWN_DEPTH } from '../mobileSpawnPolicy';
import { PYTHON_EXTENSION_WHEN_NEEDED } from '../../python/guidance';
import {
  cloneStoredMessages,
  hasSeedUserInstruction,
  normalizeSubAgentPrompt,
} from './sessionContextMessages';

export { MAX_SPAWN_DEPTH };
export const OUTPUT_TRUNCATION = FINALIZATION_OUTPUT_TRUNCATION;

const MAX_ITERATIONS_DEFAULT = 25;
const MIN_SUB_AGENT_MAX_ITERATIONS = 25;
const MIN_TIMEOUT_MS = 1_000;

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
    return MAX_ITERATIONS_DEFAULT;
  }

  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return MAX_ITERATIONS_DEFAULT;
  }

  return Math.max(MIN_SUB_AGENT_MAX_ITERATIONS, normalized);
}

function coerceConfiguredToolNameInputs(tools: unknown): string[] {
  if (Array.isArray(tools)) {
    return tools.filter((toolName): toolName is string => typeof toolName === 'string');
  }

  if (typeof tools !== 'string') {
    return [];
  }

  const trimmed = tools.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed !== tools) {
      return coerceConfiguredToolNameInputs(parsed);
    }
  } catch {
    // Fall back to delimiter-based parsing below.
  }

  return trimmed
    .split(/[\n,;|]+/)
    .map((toolName) => toolName.trim())
    .filter((toolName) => toolName.length > 0);
}

export function normalizeConfiguredToolNames(tools?: unknown): string[] | undefined {
  const normalized = Array.from(
    new Set(
      coerceConfiguredToolNameInputs(tools)
        .map((toolName) => normalizeToolName(toolName))
        .filter((toolName) => toolName.length > 0),
    ),
  );

  return normalized.length ? normalized : undefined;
}

export function hasExplicitToolConfiguration(tools: unknown): boolean {
  if (Array.isArray(tools)) {
    return true;
  }
  if (typeof tools === 'string') {
    return tools.trim().length > 0;
  }
  return tools != null;
}

export function cloneSubAgentConfig(config: SubAgentConfig): SubAgentConfig {
  const normalizedTools = normalizeConfiguredToolNames(config.tools);
  const hasExplicitToolsConfig = hasExplicitToolConfiguration(config.tools);
  const prompt = normalizeSubAgentPrompt(config.prompt) || '';
  const workstreamId = config.workstreamId?.trim() || undefined;
  return {
    ...config,
    prompt,
    ...(workstreamId ? { workstreamId } : {}),
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
  config: Pick<SubAgentConfig, 'systemPrompt' | 'inheritMemory' | 'agentRunId' | 'workstreamId'>,
  depth: number,
): string {
  const workerContract = `## Worker Contract
- If the task can be completed from the prompt and visible context, answer directly without tools.
- Use tools only for required information, verification, or side effects.
- Support, catalog, memory, and coordination tools are not progress by themselves.
- Use tool results as your ground truth.
- Briefly state major tool phases only when it helps coordination.
- ${PYTHON_EXTENSION_WHEN_NEEDED}
- If the prompt or Expected output asks for an exact answer, return that exact answer and skip the report.
- Otherwise finish with a concise report: outcome, key verified findings, artifacts/actions, and any blocker.
- If interrupted, timed out, or cancelled, preserve the most useful verified findings in visible text.`;
  const structuredExecutionContract = config.workstreamId?.trim()
    ? `## Execution Evidence Contract
- This is graph-owned or run-owned execution work. Do not infer success from priors or typical project structure.
- If the task required inspection, verification, or side effects, use the available tools before concluding the work is complete.
- Use verified_success only when completed tool results or structured workflow records directly verify the requested work.
- If you could not inspect, verify, or complete the requested work, say so plainly instead of guessing.
- The runtime tracks completion state separately from the visible report; focus on the report itself.`
    : undefined;

  const rawSystemPrompt = config.systemPrompt?.trim();
  if (rawSystemPrompt) {
    return `${rawSystemPrompt.slice(0, 50_000)}

${structuredExecutionContract ? `${structuredExecutionContract}\n\n` : ''}
${workerContract}`;
  }

  if (config.inheritMemory) {
    return `You are a sub-agent (depth ${depth + 1}/${MAX_SPAWN_DEPTH}) performing a specific task. Use tools as needed.

${structuredExecutionContract ? `${structuredExecutionContract}\n\n` : ''}
${workerContract}`;
  }

  return `You are a sub-agent (depth ${depth + 1}/${MAX_SPAWN_DEPTH}). Complete the task and return the result.

${structuredExecutionContract ? `${structuredExecutionContract}\n\n` : ''}
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
