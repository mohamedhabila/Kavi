// ---------------------------------------------------------------------------
// Kavi — Claw-Anything: one task through Kavi's own conversation path
// ---------------------------------------------------------------------------
// A fresh profile per trial: empty sandboxes, the person's activity logs staged in the
// workspace, their apps connected as one MCP integration, and the task's request sent
// through the exact foreground chat path a person uses. What comes back is what the
// benchmark grades (the conversation and the final reply) plus Kavi's own cost numbers.
// The caller sets the clock to the task's day first (the mock services freeze it there).

import { installE2EScenarioEnvironment } from '../e2eAgent/e2eScenarioEnvironment';
import { resetAndVerifyE2EScenarioSandboxes } from '../e2eAgent/e2ePairedStateIsolation';
import { runForegroundScenario } from '../e2eAgent/foregroundScenarioDriver';
import type { DeepReadonly } from '../e2eAgent/foregroundScenarioDriverTypes';
import { buildE2EProviderWithDiscoveredCatalog } from '../e2eAgent/providerConfig';
import { seedE2EWorkspaceSandbox } from '../e2eAgent/sandboxWorkspace';
import { mapForegroundScenarioResult } from '../e2eAgent/scenarioResultMapper';
import { E2E_DEFAULT_MAX_TOKENS } from '../e2eAgent/thresholds';
import type { E2ETokenUsageSummary } from '../e2eAgent/types';
import { mcpManager } from '../../services/mcp/manager';
import { useApprovalStore } from '../../services/remote/approvalStore';
import type { Message } from '../../types/message';
import type { McpServerConfig } from '../../types/remote';
import type { ClawAnythingTaskSpec } from './clawAnythingSpec';
import { startClawAnythingToolServer, type ClawAnythingDispatch } from './clawAnythingToolServer';

/** The integration's id: its tools reach the model as mcp__apps__<tool>. */
export const CLAW_ANYTHING_SERVER_ID = 'apps';
const TOOL_PREFIX = `mcp__${CLAW_ANYTHING_SERVER_ID}__`;
/** Base instructions every E2E scenario runs with, as the person's own setting. */
const BASE_INSTRUCTIONS =
  'You are Kavi, a graph-controlled personal assistant. Use tools to complete tasks.';

export type ClawAnythingToolCallRecord = Readonly<{
  id: string;
  /** The benchmark's tool name for the task's tools; Kavi's own name for Kavi's tools. */
  name: string;
  input: Readonly<Record<string, unknown>>;
  result: string;
  isError: boolean;
}>;

export type ClawAnythingAssistantRecord = Readonly<{
  text: string;
  toolCalls: ReadonlyArray<ClawAnythingToolCallRecord>;
}>;

export type ClawAnythingRunRecord = Readonly<{
  taskId: string;
  completed: boolean;
  terminalReason: string | null;
  durationMs: number;
  finalText: string;
  /** Every model step in order: its text and the tool calls it made, with their results. */
  assistant: ReadonlyArray<ClawAnythingAssistantRecord>;
  usage: E2ETokenUsageSummary;
  costUsd: number | null;
  errors: ReadonlyArray<string>;
}>;

function parseArguments(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { unparsed: raw };
  }
}

/** The turn's assistant steps, each tool call joined with the result Kavi received. */
export function clawAnythingAssistantRecords(
  messages: ReadonlyArray<DeepReadonly<Message>>,
): ClawAnythingAssistantRecord[] {
  const toolMessages = new Map(
    messages
      .filter((message) => message.role === 'tool' && message.toolCallId)
      .map((message) => [message.toolCallId!, message]),
  );
  return messages
    .filter((message) => message.role === 'assistant')
    .map((message) => ({
      text: message.content,
      toolCalls: (message.toolCalls ?? []).map((call) => {
        const toolMessage = toolMessages.get(call.id);
        return {
          id: call.id,
          name: call.name.startsWith(TOOL_PREFIX) ? call.name.slice(TOOL_PREFIX.length) : call.name,
          input: parseArguments(call.arguments),
          result: call.result ?? toolMessage?.content ?? call.error ?? '',
          isError: call.status === 'failed' || toolMessage?.isError === true,
        };
      }),
    }));
}

async function connectApps(
  spec: ClawAnythingTaskSpec,
  dispatch: ClawAnythingDispatch,
): Promise<() => Promise<void>> {
  const server = await startClawAnythingToolServer(spec.tools, dispatch);
  const config: McpServerConfig = {
    id: CLAW_ANYTHING_SERVER_ID,
    name: 'My apps',
    url: server.url,
    transport: 'streamable-http',
    enabled: true,
    tools: [],
    allowedTools: [],
    trust: { source: 'manual' },
    trustToolAnnotations: true,
  };
  try {
    await mcpManager.connectServer(config);
  } catch (error) {
    await server.close();
    throw new Error(
      `The task's apps did not connect: ${error instanceof Error ? error.message : String(error)}; ` +
        `server: ${server.errors.join(' | ') || 'no errors'}`,
    );
  }
  // The person connected these apps and allowed their tools, as every E2E scenario's tools
  // are allowed; whether to send or delete is Kavi's judgment, as it is the other harnesses'.
  const approvals = spec.tools
    .map((tool) => `${TOOL_PREFIX}${tool.name}`)
    .filter((key) => !useApprovalStore.getState().isAllowlisted(key));
  for (const key of approvals) useApprovalStore.getState().addToAllowlist(key);
  return async () => {
    for (const key of approvals) useApprovalStore.getState().removeFromAllowlist(key);
    mcpManager.disconnectServer(CLAW_ANYTHING_SERVER_ID);
    await server.close();
  };
}

export async function runClawAnythingTask(
  spec: ClawAnythingTaskSpec,
  dispatch: ClawAnythingDispatch,
): Promise<ClawAnythingRunRecord> {
  const startedAt = Date.now();
  const conversationId = `claw-anything-${spec.taskId}-${startedAt.toString(36)}`;
  resetAndVerifyE2EScenarioSandboxes();
  seedE2EWorkspaceSandbox(conversationId, spec.activityLogs);
  const provider = await buildE2EProviderWithDiscoveredCatalog();
  const uninstallEnvironment = installE2EScenarioEnvironment();
  let disconnect: (() => Promise<void>) | null = null;
  try {
    disconnect = await connectApps(spec, dispatch);
    const timeoutMs = spec.timeoutSeconds * 1_000;
    const driverResult = await runForegroundScenario({
      provider,
      conversationId,
      conversationTitle: spec.taskId,
      systemPrompt: [BASE_INSTRUCTIONS, spec.instructions].filter(Boolean).join('\n\n'),
      scenarioTimeoutMs: timeoutMs,
      turns: [{ content: spec.prompt, timeoutMs }],
      maxTokens: E2E_DEFAULT_MAX_TOKENS,
      // One request on a fresh profile: memory extracted after it could change nothing graded.
      disableLongTermMemory: true,
    });
    const result = mapForegroundScenarioResult({
      contentClass: 'synthetic_public',
      driverResult,
      durationMs: Date.now() - startedAt,
      fixtureId: spec.taskId,
      requestedUserTurnCount: 1,
    });
    const turn = driverResult.turns[0];
    return {
      taskId: spec.taskId,
      completed: result.completed,
      terminalReason: turn?.completion.runTerminalReason ?? null,
      durationMs: result.durationMs,
      finalText: turn?.finalAssistant?.text ?? '',
      assistant: clawAnythingAssistantRecords(turn?.messages ?? []),
      usage: result.usage,
      costUsd: result.estimatedCost.usd,
      errors: [...result.errors, ...(turn?.error ? [turn.error] : [])],
    };
  } finally {
    await disconnect?.();
    uninstallEnvironment();
  }
}
