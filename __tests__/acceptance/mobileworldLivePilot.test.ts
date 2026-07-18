jest.mock('expo-sqlite', () => {
  const { makeExpoSqliteMock } = require('../helpers/expoSqliteShim');
  return makeExpoSqliteMock({ fileBacked: true });
});

import { createHash, randomBytes, randomUUID } from 'crypto';
import fs from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import path from 'path';

import { buildE2EProvider } from '../../src/acceptance/e2eAgent/providerConfig';
import { executeForegroundConversationRun } from '../../src/engine/graph/foregroundRun/execution';
import {
  createForegroundScenarioRuntime,
  createSeedConversation,
  ensureForegroundScenarioStoresHydrated,
} from '../../src/acceptance/e2eAgent/foregroundScenarioDriverRuntime';
import type {
  ForegroundScenarioDriverInput,
  ForegroundScenarioMemoryRecord,
} from '../../src/acceptance/e2eAgent/foregroundScenarioDriverTypes';
import {
  buildMobileWorldControllerCapability,
  buildMobileWorldControllerOutcome,
  buildMobileWorldObservationRef,
  resolveMobileWorldBridgeEvent,
  type MobileWorldBridgeEvent,
} from '../../benchmarks/mobileworld/controllerProtocol';
import {
  resetE2EMemorySandbox,
  teardownE2EMemorySandbox,
} from '../../src/acceptance/e2eAgent/sandboxMemory';
import {
  flushChatStorePersistenceNow,
  requestChatStorePersistenceCheckpoint,
} from '../../src/store/chatStorePersistence';
import { useChatStore } from '../../src/store/useChatStore';
import { useSettingsStore } from '../../src/store/useSettingsStore';
import type { MobileControllerPublishedHandoff } from '../../src/engine/mobileController/publication';
import type { ConversationUsageSummary } from '../../src/types/usage';
import { generateId } from '../../src/utils/id';
import {
  ensureAdbKeyboard,
  gitValue,
  prepareAlarmState,
  prepareLocalTaskSnapshot,
  runAdb,
  runPilotProcess,
  verifyAlarmState,
  type MobileWorldPilotProcessResult,
} from './mobileworldLivePilotProcess';

type JsonObject = Record<string, unknown>;

type BridgeSession = {
  agentRunId?: string;
  capability: Awaited<ReturnType<typeof buildMobileWorldControllerCapability>>;
  controllerAppIdentifiers: string[];
  instruction: string;
  lastEventKind?: MobileWorldBridgeEvent['kind'];
  lastRunDiagnostics?: JsonObject;
  pendingPublication?: MobileControllerPublishedHandoff;
  rootConversationId: string;
  runtime: ReturnType<typeof createForegroundScenarioRuntime>;
  turns: number;
  repairs: number;
};

type PriorEventObservation =
  | Readonly<{ eventKind: 'controller_action'; exactScreenMatch: boolean }>
  | Readonly<{ eventKind: 'ask_user'; userResponse: string }>;

const describeLivePilot = process.env.RUN_MOBILEWORLD_PILOT === '1' ? describe : describe.skip;
const MAX_BRIDGE_REQUEST_BYTES = 12_000_000;

function sendJson(response: ServerResponse, status: number, body: JsonObject): void {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(encoded),
  });
  response.end(encoded);
}

async function readJsonBody(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BRIDGE_REQUEST_BYTES) throw new Error('bridge_request_too_large');
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('bridge_request_must_be_object');
  }
  return parsed as JsonObject;
}

function requirePayloadText(payload: JsonObject, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`bridge_${field}_invalid`);
  return value.trim();
}

function requirePayloadInteger(payload: JsonObject, field: string): number {
  const value = payload[field];
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`bridge_${field}_invalid`);
  }
  return Number(value);
}

function requireControllerAppIdentifiers(payload: JsonObject): string[] {
  const value = payload.controller_app_identifiers;
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) {
    throw new Error('bridge_controller_app_identifiers_invalid');
  }
  const identifiers = value.map((entry) =>
    typeof entry === 'string' && entry.trim().length <= 100 ? entry.trim() : '',
  );
  if (identifiers.some((entry) => !entry) || new Set(identifiers).size !== identifiers.length) {
    throw new Error('bridge_controller_app_identifiers_invalid');
  }
  return identifiers;
}

function readPriorEventObservation(payload: JsonObject): PriorEventObservation | null {
  const candidate = payload.prior_event_observation;
  if (candidate === null || candidate === undefined) return null;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('bridge_prior_event_observation_invalid');
  }
  const observation = candidate as JsonObject;
  const eventKind = requirePayloadText(observation, 'event_kind');
  if (eventKind === 'controller_action') {
    if (typeof observation.exact_screen_match !== 'boolean') {
      throw new Error('bridge_exact_screen_match_invalid');
    }
    return {
      eventKind,
      exactScreenMatch: observation.exact_screen_match,
    };
  }
  if (eventKind === 'ask_user') {
    return {
      eventKind,
      userResponse: requirePayloadText(observation, 'ask_user_response'),
    };
  }
  throw new Error('bridge_prior_event_kind_invalid');
}

function decodePng(payload: JsonObject): { base64: string; bytes: number; digest: `sha256:${string}` } {
  const base64 = requirePayloadText(payload, 'screenshot_base64');
  const decoded = Buffer.from(base64, 'base64');
  if (
    decoded.length === 0 ||
    decoded.length > 8_000_000 ||
    !decoded.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    throw new Error('bridge_screenshot_invalid');
  }
  return {
    base64,
    bytes: decoded.length,
    digest: `sha256:${createHash('sha256').update(decoded).digest('hex')}`,
  };
}

function usagePayload(
  before: ConversationUsageSummary | undefined,
  after: ConversationUsageSummary | undefined,
) {
  const inputTokens = (after?.totalInput ?? 0) - (before?.totalInput ?? 0);
  const outputTokens = (after?.totalOutput ?? 0) - (before?.totalOutput ?? 0);
  return {
    input_tokens: Math.max(0, inputTokens),
    output_tokens: Math.max(0, outputTokens),
    total_tokens: Math.max(0, inputTokens + outputTokens),
  };
}

function eventPayload(event: MobileWorldBridgeEvent): JsonObject {
  if (event.kind === 'controller_action') {
    return { kind: event.kind, action: event.action };
  }
  if (event.kind === 'status') {
    return { kind: event.kind, goal_status: event.goalStatus };
  }
  return { kind: event.kind, text: event.text };
}

async function listenOnLoopback(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bridge_address_unavailable');
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describeLivePilot('MobileWorld — exact foreground-chat device pilot', () => {
  jest.setTimeout(21 * 60 * 1_000);

  afterAll(() => {
    teardownE2EMemorySandbox();
  });

  it('creates the requested alarm and verifies the device database state', async () => {
    resetE2EMemorySandbox();
    await ensureForegroundScenarioStoresHydrated();
    const chatSnapshot = useChatStore.getState();
    const settingsSnapshot = useSettingsStore.getState();
    const provider = buildE2EProvider();
    const systemPrompt = settingsSnapshot.systemPrompt;
    const projectRoot = path.resolve(__dirname, '../..');
    const upstreamDir = requirePayloadText(process.env as JsonObject, 'MOBILEWORLD_UPSTREAM_DIR');
    const outputDir = requirePayloadText(process.env as JsonObject, 'MOBILEWORLD_OUTPUT_DIR');
    const device = process.env.MOBILEWORLD_DEVICE?.trim() || 'emulator-5554';
    const hour = 8;
    const minute = 17;
    const goal = 'Create and enable an alarm for 8:17 AM.';
    const taskName = process.env.MOBILEWORLD_TASK?.trim() || null;
    const alarmDatabase = '/data/user_de/0/com.google.android.deskclock/databases/alarms.db';
    const bridgeToken = randomBytes(32).toString('hex');
    const sessions = new Map<string, BridgeSession>();

    await ensureAdbKeyboard(upstreamDir, device);
    if (taskName) {
      await prepareLocalTaskSnapshot(device);
    } else {
      await prepareAlarmState(device, alarmDatabase);
    }

    const server = createServer((request, response) => {
      void (async () => {
        try {
          if (
            request.method !== 'POST' ||
            request.socket.remoteAddress !== '127.0.0.1' ||
            request.headers.authorization !== `Bearer ${bridgeToken}`
          ) {
            sendJson(response, 403, { ok: false, error: 'bridge_access_denied' });
            return;
          }
          const payload = await readJsonBody(request);
          const action = requirePayloadText(payload, 'action');
          const sessionId = requirePayloadText(payload, 'session_id');
          if (!/^[A-Za-z0-9._-]{1,100}$/u.test(sessionId)) {
            throw new Error('bridge_session_id_invalid');
          }
          if (action === 'reset') {
            const controllerAppIdentifiers = requireControllerAppIdentifiers(payload);
            const instruction = requirePayloadText(payload, 'instruction');
            const scaleFactor = requirePayloadInteger(payload, 'scale_factor');
            if (scaleFactor !== 1_000) throw new Error('bridge_scale_factor_unsupported');
            if (sessions.size > 0 && !sessions.has(sessionId)) {
              throw new Error('bridge_concurrent_session_unsupported');
            }
            const rootConversationId = `mobileworld-${randomUUID()}`;
            const scenarioInput: ForegroundScenarioDriverInput = {
              provider,
              conversationId: rootConversationId,
              conversationTitle: 'MobileWorld device pilot',
              systemPrompt,
              defaultMode: 'agentic',
              scenarioTimeoutMs: 20 * 60 * 1_000,
              turns: [],
              maxTokens: 4_096,
              timeoutMs: 240_000,
              disableLongTermMemory: true,
              enableCompaction: true,
            };
            useSettingsStore.setState({
              providers: [{ ...provider }],
              activeProviderId: provider.id,
              activeModel: provider.model,
              systemPrompt,
              defaultConversationMode: 'agentic',
              thinkingLevel: 'medium',
              disableLongTermMemory: true,
              memoryConsolidationMode: 'active_provider',
              consolidationProvider: null,
            });
            useChatStore.setState({
              conversations: [createSeedConversation(scenarioInput)],
              activeConversationId: rootConversationId,
              isLoading: false,
            });
            requestChatStorePersistenceCheckpoint(0);
            await flushChatStorePersistenceNow();
            sessions.set(sessionId, {
              capability: await buildMobileWorldControllerCapability(
                controllerAppIdentifiers,
              ),
              controllerAppIdentifiers,
              instruction,
              rootConversationId,
              runtime: createForegroundScenarioRuntime(
                scenarioInput,
                [] as ForegroundScenarioMemoryRecord[],
              ),
              turns: 0,
              repairs: 0,
            });
            sendJson(response, 200, {
              ok: true,
              metadata: {
                provider: { family: provider.providerFamily, model: provider.model },
              },
            });
            return;
          }
          if (action !== 'advance') throw new Error('bridge_action_invalid');
          const session = sessions.get(sessionId);
          if (!session) throw new Error('bridge_session_unavailable');
          const screenshot = decodePng(payload);
          const stepIndex = requirePayloadInteger(payload, 'step_index');
          requirePayloadInteger(payload, 'screenshot_width');
          requirePayloadInteger(payload, 'screenshot_height');
          if (stepIndex !== session.turns + 1) throw new Error('bridge_step_index_out_of_order');
          const priorObservation = readPriorEventObservation(payload);
          if (session.lastEventKind === undefined && priorObservation !== null) {
            throw new Error('bridge_unexpected_prior_event_observation');
          }
          if (
            session.lastEventKind !== undefined &&
            priorObservation?.eventKind !== session.lastEventKind
          ) {
            throw new Error('bridge_prior_event_observation_mismatch');
          }
          if (session.lastEventKind === 'answer' || session.lastEventKind === 'status') {
            throw new Error('bridge_terminal_session_advanced');
          }

          const observation = buildMobileWorldObservationRef({
            observationId: `mobileworld-observation-${randomUUID()}`,
            screenshotDigest: screenshot.digest,
          });
          const image = {
            id: `mobileworld-screen-${stepIndex}`,
            type: 'image' as const,
            uri: `inline://mobileworld-screen-${stepIndex}.png`,
            name: `mobileworld-screen-${stepIndex}.png`,
            mimeType: 'image/png',
            size: screenshot.bytes,
            base64: screenshot.base64,
          };
          let publication: MobileControllerPublishedHandoff | undefined;
          const mobileController = {
            capability: session.capability,
            currentObservation: observation,
            currentObservationImage: image,
            publishHandoff: (candidate: MobileControllerPublishedHandoff) => {
              if (publication) throw new Error('bridge_multiple_controller_actions_published');
              publication = candidate;
            },
          };
          const conversationBefore = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === session.rootConversationId);
          if (!conversationBefore) throw new Error('bridge_conversation_unavailable');
          const priorRunIds = new Set(
            (conversationBefore.agentRuns ?? []).map((candidate) => candidate.id),
          );
          const usageBefore = conversationBefore.usage;
          const options = {
            maxTokens: 4_096,
            allowedToolNames: ['mobile_ui_action', 'request_clarification', 'update_goals'],
            enableCompaction: true,
            mobileController,
          } as const;

          session.runtime.resetChatError();
          session.runtime.setActiveTurnMaxTokens(options.maxTokens);
          if (session.lastEventKind === undefined) {
            useChatStore.getState().addMessage(session.rootConversationId, {
              id: generateId(),
              role: 'user',
              content: session.instruction,
              timestamp: Date.now(),
            });
            requestChatStorePersistenceCheckpoint(0);
            await executeForegroundConversationRun({
              conversationId: session.rootConversationId,
              context: session.runtime.context,
              options,
            });
          } else if (session.lastEventKind === 'controller_action') {
            if (
              !session.agentRunId ||
              !session.pendingPublication ||
              priorObservation?.eventKind !== 'controller_action'
            ) {
              throw new Error('bridge_pending_controller_action_unavailable');
            }
            const pendingPublication = session.pendingPublication;
            session.pendingPublication = undefined;
            await executeForegroundConversationRun({
              conversationId: session.rootConversationId,
              context: session.runtime.context,
              options: {
                ...options,
                reuseAgentRunId: session.agentRunId,
                mobileControllerOutcome: {
                  handoff: pendingPublication.handoff,
                  outcome: buildMobileWorldControllerOutcome({
                    outcomeId: `mco_${randomUUID().replaceAll('-', '')}`,
                    publication: pendingPublication,
                    afterObservation: observation,
                    observableDelta: priorObservation.exactScreenMatch
                      ? 'unchanged'
                      : 'changed',
                    observedAt: Date.now(),
                  }),
                },
              },
            });
          } else {
            if (!priorObservation || priorObservation.eventKind !== 'ask_user') {
              throw new Error('bridge_user_response_unavailable');
            }
            useChatStore.getState().addMessage(session.rootConversationId, {
              id: generateId(),
              role: 'user',
              content: priorObservation.userResponse,
              timestamp: Date.now(),
            });
            requestChatStorePersistenceCheckpoint(0);
            await executeForegroundConversationRun({
              conversationId: session.rootConversationId,
              context: session.runtime.context,
              options,
            });
          }

          const chatError = session.runtime.getChatError();
          if (chatError) throw new Error(`bridge_foreground_chat_failed:${chatError}`);
          const conversationAfter = useChatStore
            .getState()
            .conversations.find((candidate) => candidate.id === session.rootConversationId);
          if (!conversationAfter) throw new Error('bridge_conversation_unavailable');
          const resumedRunId =
            publication?.owner.agentRunId ??
            (session.lastEventKind === 'controller_action' ? session.agentRunId : undefined) ??
            [...(conversationAfter.agentRuns ?? [])]
              .reverse()
              .find((candidate) => !priorRunIds.has(candidate.id))?.id;
          if (!resumedRunId) throw new Error('bridge_agent_run_unavailable');
          const event = resolveMobileWorldBridgeEvent({
            conversation: conversationAfter,
            agentRunId: resumedRunId,
            ...(publication ? { publication } : {}),
          });
          session.agentRunId = resumedRunId;
          session.pendingPublication =
            event.kind === 'controller_action' ? event.publication : undefined;
          session.lastEventKind = event.kind;
          session.turns += 1;
          const run = conversationAfter.agentRuns?.find(
            (candidate) => candidate.id === resumedRunId,
          );
          session.lastRunDiagnostics = {
            status: run?.status ?? null,
            terminal_reason: run?.terminalReason ?? null,
            graph_status: run?.controlGraph?.status ?? null,
            graph_terminal_reason: run?.controlGraph?.terminalReason ?? null,
            expected_tool_calls: run?.controlGraph?.expectedToolCalls ?? [],
            observed_tool_results: run?.controlGraph?.observedToolResults ?? [],
            checkpoints: run?.checkpoints.slice(-20) ?? [],
            tool_messages: conversationAfter.messages
              .filter((message) => message.role === 'tool' || message.toolCalls?.length)
              .slice(-20)
              .map((message) => ({
                role: message.role,
                content: message.content.slice(0, 2_000),
                tool_call_id: message.toolCallId ?? null,
                tool_calls: message.toolCalls ?? [],
              })),
            conversation_logs: conversationAfter.logs.slice(-20),
          };
          sendJson(response, 200, {
            ok: true,
            event: eventPayload(event),
            usage: usagePayload(usageBefore, conversationAfter.usage),
            diagnostics: {
              graph_status: run?.controlGraph?.status ?? null,
              route: 'agentic',
              agent_run_id: resumedRunId,
              handoff_id:
                event.kind === 'controller_action' ? event.publication.handoff.handoffId : null,
            },
          });
        } catch (error) {
          sendJson(response, 500, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    });

    const bridgePort = await listenOnLoopback(server);
    let processResult: MobileWorldPilotProcessResult;
    try {
      processResult = await runPilotProcess({
        bridgeToken,
        bridgeUrl: `http://127.0.0.1:${bridgePort}`,
        device,
        goal,
        outputDir,
        taskName,
        upstreamDir,
      });
    } finally {
      await closeServer(server);
      useChatStore.setState(chatSnapshot, true);
      useSettingsStore.setState(settingsSnapshot, true);
      requestChatStorePersistenceCheckpoint(0);
      await flushChatStorePersistenceNow();
    }

    const resultPath = taskName ? path.join(outputDir, taskName, 'result.txt') : null;
    const officialResult =
      resultPath && fs.existsSync(resultPath) ? fs.readFileSync(resultPath, 'utf8') : '';
    const scoreMatch = officialResult.match(/^score:\s*([0-9.]+)$/mu);
    const officialScore = scoreMatch ? Number(scoreMatch[1]) : null;
    const verifiedRows = taskName ? [] : verifyAlarmState(device, alarmDatabase, hour, minute);
    const stateVerified = taskName ? officialScore === 1 : verifiedRows.length > 0;
    const session = [...sessions.values()][0];
    const appStatus = gitValue(['-C', projectRoot, 'status', '--porcelain']);
    const upstreamStatus = gitValue(['-C', upstreamDir, 'status', '--porcelain']);
    const summary = {
      kind: 'kavi_mobileworld_device_pilot_result',
      schema_version: 1,
      created_at: new Date().toISOString(),
      claim_status: taskName
        ? 'local_official_task_diagnostic_custom_avd'
        : 'non_official_ad_hoc_device_pilot',
      claim_eligible: processResult.code === 0 && stateVerified && !appStatus,
      app: {
        commit: gitValue(['-C', projectRoot, 'rev-parse', 'HEAD']),
        worktree_clean: !appStatus,
      },
      upstream: {
        repository: 'https://github.com/Tongyi-MAI/MobileWorld',
        commit: gitValue(['-C', upstreamDir, 'rev-parse', 'HEAD']),
        worktree_clean: !upstreamStatus,
      },
      provider: {
        family: provider.providerFamily,
        model: provider.model,
        base_url: provider.baseUrl,
      },
      protocol: {
        exact_foreground_chat: true,
        foreground_mode: 'agentic',
        internal_agentic_control_graph: true,
        persistent_graph_owned_session: true,
        benchmark_owned_action_loop: false,
        provider_enforced_external_action_contract: false,
        graph_owned_mobile_ui_action: true,
        correlated_controller_outcomes: true,
        legacy_free_form_action_parser: false,
        typed_post_action_outcome_ledger: false,
        bridge_claims_semantic_effect: false,
        advisory_recovery_signal: false,
        user_response_observation: true,
        external_tool_result_observation: false,
        upstream_action_parser: true,
        upstream_device_controller: true,
        official_task_initialization: Boolean(taskName),
        official_task_scorer: Boolean(taskName),
        official_environment_image: false,
      },
      device: {
        id: device,
        model: runAdb(device, ['shell', 'getprop', 'ro.product.model']),
        sdk: runAdb(device, ['shell', 'getprop', 'ro.build.version.sdk']),
      },
      task: {
        name: taskName,
        goal: session?.instruction ?? goal,
        max_steps: Number(process.env.MOBILEWORLD_PILOT_MAX_STEPS || (taskName ? 50 : 12)),
      },
      result: {
        process_exit_code: processResult.code,
        duration_ms: processResult.durationMs,
        bridge_turns: session?.turns ?? 0,
        repair_turns: session?.repairs ?? 0,
        official_score: officialScore,
        state_verified: stateVerified,
        verified_rows: verifiedRows,
        last_run_diagnostics: session?.lastRunDiagnostics ?? null,
      },
    };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, 'pilot-summary.json'),
      `${JSON.stringify(summary, null, 2)}\n`,
      'utf8',
    );

    expect(processResult.code).toBe(0);
    if (taskName) {
      expect(officialScore).toBe(1);
    } else {
      expect(verifiedRows).toContain(`${hour}|${minute}|1|`);
    }
    expect(session?.turns).toBeGreaterThan(0);
  });
});
